"""Local-only knowledge lab: serves index.html, signs retrieval calls to the runtime and drives authoring/indexing.

Studio has no knowledge API yet, so /lab/* runs the runtime's own Python code in-process:
  GET  /lab/state            knowledge base, fields, documents with active/latest revision and index status
  POST /lab/seed             load the fictional demo knowledge base (idempotent)
  POST /lab/documents        create or edit a document (a new revision when the content changes)
  POST /lab/archive          archive a document (immediately invisible to retrieval)
  POST /lab/index            drain the index queue once, as the least-privileged indexer role
  POST /lab/retry            requeue failed latest revisions
  POST /lab/search           in-process PgKnowledge with the lab's embedding (compare with the real endpoint)
  POST /rt/knowledge/retrieval  signed like Product's BFF and forwarded to the runtime's internal endpoint

Run with apps/agent-runtime/.venv/bin/python from apps/agent-runtime (start.sh does). Binds to 127.0.0.1; never
expose it: it signs for any caller and writes content with owner credentials.

Environment: LAB_KEYRING (JSON {kid: base64 key}; the first key signs), LAB_RUNTIME_URL, LAB_PORT (default 8788),
LAB_OWNER_DATABASE_URL (content writes), LAB_INDEXER_DATABASE_URL, LAB_RUNTIME_DATABASE_URL (in-process search).
"""
import base64
import hashlib
import hmac
import json
import os
import time
import traceback
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import text

from agent_runtime.cli.knowledge_indexer import drain
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.knowledge.authoring import KnowledgeWriter
from agent_runtime.knowledge.fake import FakeEmbedding
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.fixtures.ihrd_demo import IHRD_DEMO, load_dataset
from agent_runtime.knowledge.indexer import IndexerService
from agent_runtime.knowledge.metadata import MetadataError, named_metadata
from agent_runtime.knowledge.repository import load_fields
from agent_runtime.knowledge.retrieval import PgKnowledge
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, RetrievalRequest

HERE = Path(__file__).resolve().parent
PREFIX = "/api/v1/internal"
RUNTIME_URL = os.environ.get("LAB_RUNTIME_URL", "http://127.0.0.1:18101").rstrip("/")
PORT = int(os.environ.get("LAB_PORT", "8788"))
KID, KEY = next(iter(json.loads(os.environ["LAB_KEYRING"]).items()))
KEY = base64.b64decode(KEY)
KB_ID = IHRD_DEMO["knowledge_base"]["id"]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # the runtime is local

SETTINGS = Settings()
if SETTINGS.GOOGLE_API_KEY:
    from agent_runtime.infrastructure.llm.gemini_embedding import build_embedding_port
    EMBEDDING, MODE = build_embedding_port(SETTINGS), "gemini"
else:
    EMBEDDING, MODE = FakeEmbedding(), "fake"
OWNER_UOW = RuntimeUnitOfWork(build_engine(os.environ["LAB_OWNER_DATABASE_URL"]))
WRITER = KnowledgeWriter(OWNER_UOW)
INDEXER = IndexerService(RuntimeUnitOfWork(build_engine(os.environ["LAB_INDEXER_DATABASE_URL"])), EMBEDDING)
SEARCH = PgKnowledge(RuntimeUnitOfWork(build_engine(os.environ["LAB_RUNTIME_DATABASE_URL"])), EMBEDDING,
                     timeout_ms=SETTINGS.KNOWLEDGE_RETRIEVAL_TIMEOUT_MS)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign(method: str, target: str, body: bytes) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "sda-internal+jwt", "kid": KID}
    claims = {"iss": "sda-product-bff", "aud": "sda-agent-runtime", "caller_type": "student", "owner_id": "lab",
              "iat": now, "exp": now + 60, "method": method, "request_target": target,
              "body_sha256": hashlib.sha256(body).hexdigest()}
    signing_input = _b64(json.dumps(header, separators=(",", ":")).encode()) + "." + _b64(
        json.dumps(claims, separators=(",", ":")).encode())
    return signing_input + "." + _b64(hmac.new(KEY, signing_input.encode("ascii"), hashlib.sha256).digest())


def state() -> dict:
    with OWNER_UOW.begin() as session:
        kb = session.execute(text("SELECT id, name, embedding_model FROM knowledge.knowledge_bases WHERE id = :id"),
                             {"id": KB_ID}).mappings().first()
        fields = load_fields(session, KB_ID)
        rows = session.execute(text("""
            SELECT d.id, d.status, d.revision AS latest_revision, a.revision AS active_revision,
                   l.index_status, l.error, l.title, l.body, l.source_url, l.metadata
            FROM knowledge.documents d
            LEFT JOIN knowledge.document_revisions a ON a.id = d.active_revision_id
            LEFT JOIN knowledge.document_revisions l ON l.id = d.latest_revision_id
            WHERE d.kb_id = :kb ORDER BY d.id"""), {"kb": KB_ID}).mappings().all()
        chunks = session.execute(text(
            "SELECT count(*) FROM knowledge.chunks c JOIN knowledge.documents d ON d.active_revision_id = c.revision_id "
            "WHERE d.kb_id = :kb"), {"kb": KB_ID}).scalar_one()
    documents = [{**{key: row[key] for key in ("id", "status", "latest_revision", "active_revision", "index_status",
                                                "error", "title", "body", "source_url")},
                  "metadata": named_metadata(fields, row["metadata"] or {})} for row in rows]
    return {"mode": MODE, "lab_embedding_model": EMBEDDING.model, "runtime_url": RUNTIME_URL,
            "knowledge_base": dict(kb) if kb else None, "active_chunks": chunks,
            "fields": [field.model_dump() for field in fields], "documents": documents}


def lab_action(path: str, data: dict) -> tuple[int, dict]:
    if path == "/lab/seed":
        return 200, {"created": load_dataset(WRITER, IHRD_DEMO, embedding_model=EMBEDDING.model)}
    if path == "/lab/documents":
        try:
            result = WRITER.put_document(KB_ID, data["document_id"], title=data["title"], body=data.get("body", ""),
                                         metadata=data.get("metadata") or {}, source_url=data.get("source_url") or None)
        except (MetadataError, KeyError) as error:
            return 422, {"error": str(error)}
        return 200, {"document_id": result.document_id, "revision": result.revision, "created": result.created}
    if path == "/lab/archive":
        WRITER.archive(data["document_id"])
        return 200, {"archived": data["document_id"]}
    if path == "/lab/index":
        report = drain(INDEXER, 20)
        return 200, {name: getattr(report, name) for name in report.__dataclass_fields__}
    if path == "/lab/retry":
        return 200, {"retried": INDEXER.retry_errors(KB_ID)}
    if path == "/lab/search":
        try:
            result = SEARCH.retrieve(RetrievalRequest.model_validate(data))
        except ValidationError as error:
            return 422, {"error": "invalid request", "details": json.loads(error.json())}
        except FilterError as error:
            return 422, {"error": str(error)}
        if isinstance(result, KnowledgeUnavailable):
            return (404 if result.reason == "not_found" else 503), {"error": result.reason}
        return 200, result.model_dump(mode="json")
    return 404, {"error": "unknown lab action"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[lab] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    def _send(self, status: int, body: bytes, content_type: str = "application/json", extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict):
        self._send(status, json.dumps(payload, ensure_ascii=False, default=str).encode())

    def _forward(self, body: bytes):
        target = PREFIX + self.path[len("/rt"):]
        headers = {"X-Caller-Context": sign(self.command, target, body), "X-Internal-Caller": "sda-product-bff",
                   "Content-Type": "application/json"}
        request = urllib.request.Request(RUNTIME_URL + target, data=body, method=self.command, headers=headers)
        try:
            with OPENER.open(request, timeout=30) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
        except OSError as error:
            status, payload = 502, json.dumps({"error": f"runtime unreachable: {error}"}).encode()
        self._send(status, payload)

    def do_GET(self):
        if self.path in {"/", "/index.html"}:
            return self._send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if self.path == "/lab/state":
            return self._run(lambda: (200, state()))
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/rt/knowledge/retrieval":
            return self._forward(body)
        if self.path.startswith("/lab/"):
            try:
                data = json.loads(body or b"{}")
            except ValueError:
                return self._json(400, {"error": "body is not JSON"})
            return self._run(lambda: lab_action(self.path, data))
        self._send(404, b"not found", "text/plain")

    def _run(self, action):
        try:
            status, payload = action()
        except Exception as error:  # a lab tool: show the failure instead of hanging the page
            traceback.print_exc()
            status, payload = 500, {"error": f"{type(error).__name__}: {error}"}
        self._json(status, payload)


if __name__ == "__main__":
    print(f"Knowledge lab: http://127.0.0.1:{PORT}  (runtime {RUNTIME_URL}, embedding {MODE}:{EMBEDDING.model})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
