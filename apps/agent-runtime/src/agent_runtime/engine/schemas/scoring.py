"""Data schemas for Scoring, Contributions & Classification Engine (Task C-03 / M-ENG).

Conforms to:
- ADR-002: §7.3 (Holland RIASEC 6 Houses Metadata & Order)
- ADR-002: §7.5 (Exact Rational Scoring, Mean Ratings & Display Score 0..100)
- ADR-002: §7.5 (Answer Contribution Mathematical Invariants)
- ADR-002: §7.6 (Stopping bounds & winner resolution)
- DEC-04: Holland Hexagonal Tie-Breaking Order (R -> I -> A -> S -> E -> C)
- Pydantic v2: ConfigDict(extra="forbid")
"""

from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from agent_runtime.engine.schemas.selector import RationalScore, StoppingReason


class AnswerContribution(BaseModel):
    """Individual answer contribution to a House's score and mean.

    Conforms to ADR-002 §7.5:
    - mean_contribution: rating / n_h (Exact rational representation)
    - display_contribution: 25 * (rating - 1) / n_h
    """

    question_id: str = Field(..., description="ID of the answered question")
    option_id: str = Field(..., description="ID of the selected option")
    house_id: str = Field(..., description="Holland House ID (e.g. house_r..house_c)")
    rating: StrictInt = Field(..., ge=1, le=5, description="Selected rating 1..5")
    ordinal: StrictInt = Field(..., ge=1, description="1-based position in student's answer sequence")
    mean_contribution: RationalScore = Field(
        ..., description="Exact rational contribution to the house mean: rating / n_h"
    )
    display_contribution: float = Field(
        ..., ge=0.0, le=100.0, description="Linear contribution to 0..100 display score: 25 * (rating - 1) / n_h"
    )

    model_config = ConfigDict(extra="forbid", frozen=True)

    @property
    def mean_value(self) -> float:
        """Float value of the exact mean contribution."""
        return self.mean_contribution.value


class HouseScoreDetail(BaseModel):
    """Detailed score report and statistical breakdown for one Holland RIASEC house."""

    house_id: str = Field(..., description="House ID (e.g. house_r..house_c)")
    house_name: Optional[str] = Field(default=None, description="Vietnamese localized display name")
    sum: int = Field(default=0, ge=0, description="Sum of active ratings (s_h)")
    count: int = Field(default=0, ge=0, description="Number of active answers for this house (n_h)")
    mean: Optional[RationalScore] = Field(
        default=None, description="Exact mean rating (s_h / n_h) in rational canonical form"
    )
    display_score: Optional[float] = Field(
        default=None, ge=0.0, le=100.0, description="Normalized linear display score: 100 * (mean - 1) / 4"
    )
    lower: Optional[RationalScore] = Field(
        default=None, description="Provable lower bound: (s_h + 1 * (5 - n_h)) / 5"
    )
    upper: Optional[RationalScore] = Field(
        default=None, description="Provable upper bound: (s_h + 5 * (5 - n_h)) / 5"
    )
    gap: Optional[RationalScore] = Field(
        default=None, description="Uncertainty bound gap: upper - lower"
    )
    rank: Optional[StrictInt] = Field(
        default=None, ge=1, le=6, description="Ordinal rank among 6 houses (1 = primary/highest)"
    )
    share_percentage: Optional[float] = Field(
        default=None, ge=0.0, le=100.0, description="Relative share percentage of total interest profile"
    )
    contributions: List[AnswerContribution] = Field(
        default_factory=list, description="List of contributions from each active answer for this house"
    )

    model_config = ConfigDict(extra="forbid")

    @property
    def mean_value(self) -> Optional[float]:
        """Float value of exact mean rating."""
        return self.mean.value if self.mean is not None else None


class AssessmentScoringResult(BaseModel):
    """Authoritative outcome of assessment scoring, RIASEC classification and contributions breakdown."""

    schema_version: str = Field(..., description="Experience definition schema version (e.g. '2.0', '1.0')")
    primary_house_id: Optional[str] = Field(
        default=None, description="Winning house ID with highest exact mean rating"
    )
    secondary_house_id: Optional[str] = Field(
        default=None, description="Second highest house ID (secondary personality trait)"
    )
    tertiary_house_id: Optional[str] = Field(
        default=None, description="Third highest house ID (tertiary personality trait)"
    )
    holland_code: Optional[str] = Field(
        default=None, description="3-letter Holland RIASEC code (e.g. 'RIA', 'SEC', 'ASI')"
    )
    tie_applied: bool = Field(
        default=False, description="Whether Holland hexagonal tie policy was applied to resolve a tie"
    )
    house_scores: Dict[str, HouseScoreDetail] = Field(
        default_factory=dict, description="Detailed scores and contributions for all 6 RIASEC houses"
    )
    ranked_houses: List[str] = Field(
        default_factory=list, description="House IDs ordered from Rank 1 (Primary) to Rank 6"
    )
    all_contributions: List[AnswerContribution] = Field(
        default_factory=list, description="All answer contributions in the order questions were answered"
    )
    is_complete: bool = Field(
        default=False, description="Whether the assessment has reached completion (early stop or limit)"
    )
    stopping_reason: Optional[StoppingReason] = Field(
        default=None, description="Stopping reason if complete (bounded_winner, question_limit, fixed_coverage)"
    )
    total_answers: int = Field(default=0, ge=0, description="Total number of active answered questions")

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _validate_ranking_consistency(self) -> "AssessmentScoringResult":
        """Verify that ranking fields and primary/secondary houses are internally consistent."""
        if self.ranked_houses:
            if self.primary_house_id and self.ranked_houses[0] != self.primary_house_id:
                raise ValueError(
                    f"primary_house_id '{self.primary_house_id}' does not match ranked_houses[0] '{self.ranked_houses[0]}'"
                )
            if len(self.ranked_houses) >= 2 and self.secondary_house_id:
                if self.ranked_houses[1] != self.secondary_house_id:
                    raise ValueError("secondary_house_id does not match ranked_houses[1]")
            if len(self.ranked_houses) >= 3 and self.tertiary_house_id:
                if self.ranked_houses[2] != self.tertiary_house_id:
                    raise ValueError("tertiary_house_id does not match ranked_houses[2]")
        return self
