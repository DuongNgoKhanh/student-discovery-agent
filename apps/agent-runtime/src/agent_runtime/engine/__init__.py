"""Engine module for Student Discovery Agent (M-ENG).

Provides:
- Adaptive Question Selector (Task C-02)
- Deterministic Scoring & 6 House Contributions (Task C-03)
"""

from agent_runtime.engine.exceptions import (
    BankExhaustedError,
    EngineError,
    InvalidPrefixError,
    MissingMappingError,
    UnsupportedDefinitionError,
)
from agent_runtime.engine.schemas.selector import (
    AnswerInput,
    AssessmentProgressAdaptive,
    HouseStatistics,
    RationalScore,
    SelectionPhase,
    SelectionResult,
    SelectionStatus,
    StoppingReason,
)
from agent_runtime.engine.services.selector import (
    AdaptiveQuestionSelector,
    select_next_question,
)

__all__ = [
    "AdaptiveQuestionSelector",
    "select_next_question",
    "AnswerInput",
    "AssessmentProgressAdaptive",
    "HouseStatistics",
    "RationalScore",
    "SelectionPhase",
    "SelectionResult",
    "SelectionStatus",
    "StoppingReason",
    "EngineError",
    "InvalidPrefixError",
    "BankExhaustedError",
    "UnsupportedDefinitionError",
    "MissingMappingError",
]
