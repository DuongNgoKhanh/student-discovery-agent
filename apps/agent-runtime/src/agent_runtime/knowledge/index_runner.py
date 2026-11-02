"""On-demand knowledge indexing: at most one short-lived daemon thread drains the queue, never a LISTEN loop."""
import logging
import threading
from collections.abc import Callable

from agent_runtime.knowledge.indexer import IndexReport

logger = logging.getLogger(__name__)
FAKE_MODEL = "fake-embedding"
# A run never outlives its process for long on a free host: reclaim a dead run's claims after two minutes.
AUTO_STALE_AFTER_SECONDS = 120


def fake_embedding_enabled(settings) -> bool:
    """Offline demo embedding: the explicit flag, or `fake-embedding` listed among the knowledge models."""
    return bool(settings.RUNTIME_KNOWLEDGE_FAKE_EMBEDDING) or FAKE_MODEL in settings.KNOWLEDGE_EMBEDDING_MODEL_IDS


def build_embeddings(settings, fake: bool):
    """Ports by model id; empty when real embeddings are required but none is configured."""
    if fake:
        from agent_runtime.knowledge.embedding import by_model
        from agent_runtime.knowledge.fake import FakeEmbedding
        return by_model(FakeEmbedding())
    from agent_runtime.infrastructure.llm.embedding_registry import build_embedding_ports
    return build_embedding_ports(settings)


class KnowledgeIndexRunner:
    def __init__(self, run_pass: Callable[[], IndexReport]):
        self._run_pass = run_pass
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._rerun = False

    @property
    def running(self) -> bool:
        with self._lock:
            return self._thread is not None

    def request(self) -> str:
        with self._lock:
            if self._thread is not None:
                self._rerun = True
                return "already_running"
            thread = threading.Thread(target=self._run, name="knowledge-index-run", daemon=True)
            thread.start()  # may raise; the runner stays idle so a later request can try again
            self._thread = thread  # the new thread blocks on the lock until this assignment is done
            return "started"

    def join(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _run(self) -> None:
        try:
            while True:
                with self._lock:
                    self._rerun = False
                report = self._run_pass()
                if report.indexed + report.failed:
                    continue
                with self._lock:
                    if not self._rerun:
                        self._thread = None
                        return
        except BaseException as error:
            logger.error("knowledge index run failed: %s", type(error).__name__)  # never the message or URL
            with self._lock:
                self._thread = None

