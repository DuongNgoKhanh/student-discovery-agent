"""Schemas for Adaptive Question Selector (M-ENG / Task C-02).

Conforms to:
- ADR-002 (§7.5 Scoring, §7.6 Stopping Condition, §7.7 Adaptive Selector, §7.9 Contract)
- OpenAPI: AssessmentProgress, ActivityAnswer, ActivityView
- Pydantic v2: ConfigDict(extra="forbid")
"""

from enum import Enum
from fractions import Fraction
from typing import Dict, List, Optional, Union
from pydantic import BaseModel, ConfigDict, Field

from agent_runtime.evaluations.schemas.experience import AssessmentDefinitionQuestion


class SelectionStatus(str, Enum):
    """Lifecycle status of the question selection."""

    NEXT_QUESTION = "next_question"
    COMPLETED = "completed"


class SelectionPhase(str, Enum):
    """Assessment execution phase per ADR-002 §7.9."""

    BASELINE = "baseline"
    ADAPTIVE = "adaptive"
    COMPLETED = "completed"
    FIXED = "fixed"  # For Definition 1.0


class StoppingReason(str, Enum):
    """Provable stopping reason per ADR-002 §7.6."""

    BOUNDED_WINNER = "bounded_winner"
    QUESTION_LIMIT = "question_limit"
    FIXED_COVERAGE = "fixed_coverage"  # Definition 1.0


class RationalScore(BaseModel):
    """Exact rational representation of scores/bounds (ADR-002 §7.5 & §8.3.3).

    Maintains numerator and denominator to ensure 100% exact comparisons
    without floating-point imprecision.
    """

    numerator: int = Field(..., description="Numerator of the rational fraction")
    denominator: int = Field(..., description="Denominator of the rational fraction (must be non-zero)")

    model_config = ConfigDict(extra="forbid")

    @classmethod
    def from_fraction(cls, frac: Fraction) -> "RationalScore":
        return cls(numerator=frac.numerator, denominator=frac.denominator)

    def to_fraction(self) -> Fraction:
        return Fraction(self.numerator, self.denominator)

    @property
    def value(self) -> float:
        return self.numerator / self.denominator if self.denominator != 0 else 0.0

    def __eq__(self, other: object) -> bool:
        if isinstance(other, RationalScore):
            return self.to_fraction() == other.to_fraction()
        if isinstance(other, (Fraction, int, float)):
            return self.to_fraction() == other
        return False

    def __lt__(self, other: object) -> bool:
        other_frac = other.to_fraction() if isinstance(other, RationalScore) else other
        return self.to_fraction() < other_frac

    def __le__(self, other: object) -> bool:
        other_frac = other.to_fraction() if isinstance(other, RationalScore) else other
        return self.to_fraction() <= other_frac

    def __gt__(self, other: object) -> bool:
        other_frac = other.to_fraction() if isinstance(other, RationalScore) else other
        return self.to_fraction() > other_frac

    def __ge__(self, other: object) -> bool:
        other_frac = other.to_fraction() if isinstance(other, RationalScore) else other
        return self.to_fraction() >= other_frac

    def __sub__(self, other: object) -> "RationalScore":
        other_frac = other.to_fraction() if isinstance(other, RationalScore) else other
        return RationalScore.from_fraction(self.to_fraction() - other_frac)

    def __add__(self, other: object) -> "RationalScore":
        other_frac = other.to_fraction() if isinstance(other, RationalScore) else other
        return RationalScore.from_fraction(self.to_fraction() + other_frac)

    def __repr__(self) -> str:
        return f"RationalScore({self.numerator}/{self.denominator})"


class HouseStatistics(BaseModel):
    """Statistical tracking snapshot for one Holland RIASEC house."""

    house_id: str = Field(..., description="House ID (e.g. house_r..house_c)")
    sum: int = Field(default=0, ge=0, description="Sum of active ratings")
    count: int = Field(default=0, ge=0, description="Number of active answers for this house")
    mean: Optional[RationalScore] = Field(
        default=None, description="Exact mean rating (s_h / n_h)"
    )
    lower: Optional[RationalScore] = Field(
        default=None, description="Provable lower bound: (s_h + (5 - n_h)) / 5"
    )
    upper: Optional[RationalScore] = Field(
        default=None, description="Provable upper bound: (s_h + 5 * (5 - n_h)) / 5"
    )
    gap: Optional[RationalScore] = Field(
        default=None, description="Uncertainty gap: upper - lower"
    )
    display_score: Optional[float] = Field(
        default=None, description="Linear display score 0..100: 100 * (mean - 1) / 4"
    )

    model_config = ConfigDict(extra="forbid")


class AssessmentProgressAdaptive(BaseModel):
    """Adaptive assessment progress structure conforming to ADR-002 §7.9."""

    completed: int = Field(..., ge=0, description="Number of active answered questions")
    min_total: int = Field(..., ge=0, description="Minimum questions budget (e.g. 12)")
    max_total: int = Field(..., ge=0, description="Maximum questions budget (e.g. 30)")
    total: Optional[int] = Field(
        default=None,
        description="Total questions (null during in_progress, int when completed)",
    )
    phase: str = Field(..., description="Current phase: baseline, adaptive, completed, fixed")

    model_config = ConfigDict(extra="forbid")


class AnswerInput(BaseModel):
    """Input representation of an answered question."""

    question_id: str = Field(..., pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    option_id: str = Field(..., pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    rating: Optional[int] = Field(
        default=None, ge=1, le=5, description="Explicit rating if provided"
    )

    # Allow extra fields (e.g. answer_id, ordinal, source from session ActivityAnswer)
    model_config = ConfigDict(extra="ignore")


class SelectionResult(BaseModel):
    """Authoritative outcome of question selection or assessment completion."""

    status: SelectionStatus = Field(..., description="next_question or completed")
    next_question_id: Optional[str] = Field(
        default=None, description="ID of the next question to ask"
    )
    next_question: Optional[AssessmentDefinitionQuestion] = Field(
        default=None, description="Full question definition object of next question"
    )
    stopping_reason: Optional[StoppingReason] = Field(
        default=None, description="Stopping reason if completed: bounded_winner, question_limit, fixed_coverage"
    )
    primary_house_id: Optional[str] = Field(
        default=None, description="Winning house ID if completed"
    )
    tie_applied: bool = Field(
        default=False, description="Whether tie policy was applied to break a tie"
    )
    phase: SelectionPhase = Field(..., description="Current phase of the assessment")
    progress: AssessmentProgressAdaptive = Field(..., description="Current progress snapshot")
    statistics: Dict[str, HouseStatistics] = Field(
        default_factory=dict, description="Statistics for each house"
    )
    candidate_houses: List[str] = Field(
        default_factory=list, description="Candidate houses considered during adaptive selection"
    )
    decision_log: List[str] = Field(
        default_factory=list, description="Step-by-step audit trail of selector decision"
    )

    model_config = ConfigDict(extra="forbid")
