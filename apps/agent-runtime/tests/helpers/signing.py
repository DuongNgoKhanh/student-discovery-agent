"""Product-style signing fixtures. Never imported by runtime code."""

from datetime import datetime
from hashlib import sha256

import jwt

from agent_runtime.infrastructure.auth.caller import RawRequestContext


def sign_request(
    request: RawRequestContext,
    *,
    owner_id: str,
    now: datetime,
    key: bytes,
    kid: str,
    ttl_seconds: int = 60,
) -> str:
    issued_at = int(now.timestamp())
    return jwt.encode(
        {
            "iss": "sda-product-bff",
            "aud": "sda-agent-runtime",
            "caller_type": "student",
            "owner_id": owner_id,
            "iat": issued_at,
            "exp": issued_at + ttl_seconds,
            "method": request.method.upper(),
            "request_target": request.request_target,
            "body_sha256": sha256(request.body).hexdigest(),
        },
        key,
        algorithm="HS256",
        headers={"typ": "sda-internal+jwt", "kid": kid},
    )
