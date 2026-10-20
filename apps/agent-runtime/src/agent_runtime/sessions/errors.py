"""Safe service errors: messages contain an error code, never request content."""
from .schemas.common import JsonObject


class RuntimeSessionError(Exception):
    def __init__(self, status: int, code: str, details: JsonObject | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.details = details
