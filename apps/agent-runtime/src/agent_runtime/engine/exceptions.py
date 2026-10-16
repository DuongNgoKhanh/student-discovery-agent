"""Typed exceptions for Engine module (M-ENG / Task C-02).

Conforms to DEC-04 & ADR-002 §7.7 failure specifications:
- InvalidPrefixError: item lặp, câu sai đường, option sai item, invalid rating
- BankExhaustedError: hết ngân hàng câu hỏi nhưng chưa có valid stop
- UnsupportedDefinitionError: schema_version hoặc rule_schema_ref chưa được đăng ký
- MissingMappingError: thiếu rating, house_id hoặc item_order mapping
"""


class EngineError(Exception):
    """Base exception for all engine errors."""

    def __init__(self, message: str, code: str = "ENGINE_ERROR"):
        super().__init__(message)
        self.message = message
        self.code = code

    def __str__(self) -> str:
        return f"[{self.code}] {self.message}"


class InvalidPrefixError(EngineError):
    """Raised when the answer prefix is invalid.

    Covers:
    - Duplicate question in answers (anti-repeat violation)
    - Question ID not in question bank
    - Option ID not belonging to question
    - Option rating out of range or malformed
    - Sequence mismatch (question was not chosen by selector at that step)
    """

    def __init__(self, message: str, code: str = "INVALID_ANSWER_PREFIX"):
        super().__init__(message, code=code)


class BankExhaustedError(EngineError):
    """Raised when question bank has no further available questions but stop condition is not met."""

    def __init__(self, message: str, code: str = "BANK_EXHAUSTED"):
        super().__init__(message, code=code)


class UnsupportedDefinitionError(EngineError):
    """Raised when experience definition version or rule schema ref is unsupported by the engine."""

    def __init__(self, message: str, code: str = "UNSUPPORTED_DEFINITION"):
        super().__init__(message, code=code)


class MissingMappingError(EngineError):
    """Raised when question bank or choices miss required metadata (house_id, item_order, rating)."""

    def __init__(self, message: str, code: str = "MISSING_MAPPING"):
        super().__init__(message, code=code)
