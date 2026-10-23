"""Engine module for Student Discovery Agent (M-ENG).

Provides:
- Adaptive Question Selector (Task C-02)
- Deterministic Scoring, Contributions & Classification Engine (Task C-03)
"""

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import (
    BankExhaustedError,
    EngineError,
    InvalidPrefixError,
    MissingMappingError,
    UnsupportedDefinitionError,
)
from agent_runtime.engine.schemas.scoring import (
    AnswerContribution,
    AssessmentScoringResult,
    HouseScoreDetail,
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
from agent_runtime.engine.services.scorer import (
    ScoringEngine,
    calculate_scores,
)
from agent_runtime.engine.services.selector import (
    AdaptiveQuestionSelector,
    select_next_question,
)

__all__ = [
    "AdaptiveQuestionSelector",
    "AnswerContribution",
    "AnswerInput",
    "AssessmentProgressAdaptive",
    "AssessmentScoringResult",
    "BankExhaustedError",
    "EngineError",
    "EngineErrorCode",
    "HouseScoreDetail",
    "HouseStatistics",
    "InvalidPrefixError",
    "MissingMappingError",
    "RationalScore",
    "ScoringEngine",
    "SelectionPhase",
    "SelectionResult",
    "SelectionStatus",
    "StoppingReason",
    "UnsupportedDefinitionError",
    "calculate_scores",
    "select_next_question",
]
