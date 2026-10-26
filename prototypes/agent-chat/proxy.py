"""Local-only signing proxy for the agent chat prototype. Standard library only.

Serves index.html and forwards /rt/<path> to the runtime's /api/v1/internal/<path>, signing each request the way
Product's BFF does (HS256 X-Caller-Context bound to method, raw target and body hash). The student identity is
the X-Dev-Owner header the page sends. Server-sent event streams (POST /messages with Accept: text/event-stream)
are relayed chunk by chunk. Binds to 127.0.0.1; never expose it: it signs for any owner.

Environment: SDA_CHAT_KEYRING (JSON {kid: base64 key}; the first key signs), SDA_CHAT_RUNTIME_URL
(default http://127.0.0.1:18100), SDA_CHAT_PORT (default 8787).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PREFIX = "/api/v1/internal"
RUNTIME_URL = os.environ.get("SDA_CHAT_RUNTIME_URL", "http://127.0.0.1:18100").rstrip("/")
PORT = int(os.environ.get("SDA_CHAT_PORT", "8787"))
KID, KEY = next(iter(json.loads(os.environ["SDA_CHAT_KEYRING"]).items()))
KEY = base64.b64decode(KEY)
OWNER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
# The runtime is local: never route through http_proxy/https_proxy from the shell.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign(method: str, target: str, body: bytes, owner: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "sda-internal+jwt", "kid": KID}
    claims = {"iss": "sda-product-bff", "aud": "sda-agent-runtime", "caller_type": "student", "owner_id": owner,
              "iat": now, "exp": now + 60, "method": method, "request_target": target,
              "body_sha256": hashlib.sha256(body).hexdigest()}
    signing_input = _b64(json.dumps(header, separators=(",", ":")).encode()) + "." + _b64(
        json.dumps(claims, separators=(",", ":")).encode())
    signature = hmac.new(KEY, signing_input.encode("ascii"), hashlib.sha256).digest()
    return signing_input + "." + _b64(signature)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[proxy] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _forward(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path in {"/healthz", "/ready"}:
            target, headers = self.path, {}
        else:
            owner = self.headers.get("X-Dev-Owner", "")
            if not OWNER.fullmatch(owner):
                return self._send(400, b'{"error":"X-Dev-Owner missing or invalid"}', "application/json")
            target = PREFIX + self.path[len("/rt"):]
            headers = {"X-Caller-Context": sign(self.command, target, body, owner),
                       "X-Internal-Caller": "sda-product-bff"}
        if body:
            headers["Content-Type"] = "application/json"
        if self.headers.get("Accept"):
            headers["Accept"] = self.headers["Accept"]
        request = urllib.request.Request(RUNTIME_URL + target, data=body or None, method=self.command,
                                         headers=headers)
        started = time.monotonic()
        try:
            with OPENER.open(request, timeout=60) as response:  # streams ping every 15 s, well inside the timeout
                if response.headers.get("Content-Type", "").startswith("text/event-stream"):
                    return self._relay(response)
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
        except OSError as error:
            status, payload = 502, json.dumps({"error": f"runtime unreachable: {error}"}).encode()
        elapsed = f"{(time.monotonic() - started) * 1000:.0f}"
        self._send(status, payload, "application/json", {"X-Proxy-Elapsed-Ms": elapsed})

    def _relay(self, response):
        """Pass SSE frames through as they arrive. A closed browser tab only stops the relay; the runtime still
        finishes and commits the turn, which GET /rt/responses/{id} then returns."""
        self.send_response(response.status)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        for name in ("X-Request-ID", "X-Trace-ID"):
            if response.headers.get(name):
                self.send_header(name, response.headers[name])
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            while chunk := response.read1(8192):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path in {"/", "/index.html"}:
            return self._send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        if self.path.startswith("/rt/") or self.path in {"/healthz", "/ready"}:
            return self._forward()
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path.startswith("/rt/"):
            return self._forward()
        self._send(404, b"not found", "text/plain")


if __name__ == "__main__":
    print(f"Agent chat prototype: http://127.0.0.1:{PORT}  (runtime {RUNTIME_URL})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
