"""
Deterministic JSON Canonicalization (RFC 8785 / JCS) & Content Hashing Utility.
Used for computing immutable release and draft definition hashes: sha256:<hex>.
"""

import hashlib
import json
from typing import Any


def canonicalize_json(obj: Any) -> str:
    """
    Serialize any JSON-serializable Python data structure into a canonical RFC 8785 string:
    - Sorted dictionary keys
    - No unnecessary whitespace (separators=(',', ':'))
    - Strict UTF-8 serialization
    """
    return json.dumps(
        obj,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def compute_content_hash(obj: Any) -> str:
    """
    Computes deterministic SHA-256 hash formatted as 'sha256:<hex_digest>'
    over the canonical representation of the input object.
    """
    canonical_str = canonicalize_json(obj)
    digest = hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"

