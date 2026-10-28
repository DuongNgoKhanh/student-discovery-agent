"""sha256 over RFC 8785 canonical JSON, formatted like every other content hash in the runtime."""
from collections.abc import Mapping
from hashlib import sha256
from typing import Any

import jcs


def canonical_hash(value: Any) -> str:
    return "sha256:" + sha256(jcs.canonicalize(value)).hexdigest()


def content_hash(title: str, body: str, source_url: str | None, metadata: Mapping[str, Any]) -> str:
    return canonical_hash({"title": title, "body": body, "source_url": source_url, "metadata": dict(metadata)})


def chunk_hash(title: str, heading_path: str, text: str) -> str:
    """Covers everything sent to the embedding model, so a cached vector always matches its input."""
    return canonical_hash([title, heading_path, text])
