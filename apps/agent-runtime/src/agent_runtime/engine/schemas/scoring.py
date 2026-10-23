"""Data schemas for Scoring, Contributions & Classification Engine (Task C-03 / M-ENG).

Conforms to:
- ADR-002: §7.3 (Holland RIASEC 6 Houses Metadata & Order)
- ADR-002: §7.5 (Exact Rational Scoring, Mean Ratings & Display Score 0..100)
- ADR-002: §7.5 (Answer Contribution Mathematical Invariants)
- ADR-002: §7.6 (Stopping bounds & winner resolution)
- DEC-04: Holland Hexagonal Tie-Breaking Order (R -> I -> A -> S -> E -> C)
- Pydantic v2: ConfigDict(extra="forbid")
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from agent_runtime.engine.schemas.selector import HouseStatistics, RationalScore, StoppingReason


class AnswerContribution(BaseModel):
    """Individual answer contribution to a House's score and mean.

    Conforms to ADR-002 §7.5:
    - mean_contribution: rating / n_h (exact; sums to the house mean)
    - display_contribution: 25 * (rating - 1) / n_h (rounded to 6 decimals; sums to the
      house display_score within its 2-decimal rounding)
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


class HouseScoreDetail(HouseStatistics):
    """Selector house statistics extended with ranking and the per-answer breakdown.

    lower/upper bound the house mean once all items_per_house items are answered.
    """

    house_name: Optional[str] = Field(default=None, description="Display name from the definition's house metadata")
    rank: Optional[StrictInt] = Field(
        default=None,
        ge=1,
        le=6,
        description="Ordinal rank among 6 houses (1 = primary/highest); unset before baseline coverage",
    )
    contributions: List[AnswerContribution] = Field(
        default_factory=list, description="List of contributions from each active answer for this house"
    )

    model_config = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def _validate_contributions(self) -> "HouseScoreDetail":
        if len(self.contributions) != self.count:
            raise ValueError(f"{self.house_id}: {len(self.contributions)} contributions for count {self.count}")
        if any(c.house_id != self.house_id for c in self.contributions):
            raise ValueError(f"{self.house_id}: contribution belongs to another house")
        if (self.count == 0) != (self.mean is None):
            raise ValueError(f"{self.house_id}: mean must be set exactly when count > 0")
        return self


class AssessmentScoringResult(BaseModel):
    """Authoritative outcome of assessment scoring, RIASEC classification and contributions breakdown.

    Ranking and classification stay unset until every house has baseline coverage
    (ADR-002 §7.5); after that and before is_complete they are provisional.
    """

    schema_version: Literal["1.0", "2.0"] = Field(..., description="Experience definition schema version")
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
        default=None,
        pattern=r"^[RIASEC]{3}$",
        description="3-letter Holland code of the top three ranked houses",
    )
    tie_applied: bool = Field(
        default=False,
        description="True when the primary house was chosen by tie order at question_limit (top two means equal)",
    )
    house_scores: Dict[str, HouseScoreDetail] = Field(
        default_factory=dict, description="Detailed scores and contributions per house (empty for Definition 1.0)"
    )
    ranked_houses: List[str] = Field(
        default_factory=list,
        description="House IDs ordered from Rank 1 (Primary) to Rank 6; empty before baseline coverage",
    )
    all_contributions: List[AnswerContribution] = Field(
        default_factory=list, description="All answer contributions in the order questions were answered"
    )
    is_complete: bool = Field(
        default=False, description="Whether the assessment has reached a stopping condition"
    )
    stopping_reason: Optional[StoppingReason] = Field(
        default=None, description="Stopping reason if complete (bounded_winner, question_limit, fixed_coverage)"
    )
    total_answers: int = Field(default=0, ge=0, description="Total number of active answered questions")

    model_config = ConfigDict(extra="forbid", frozen=True)

    @model_validator(mode="after")
    def _validate_ranking_consistency(self) -> "AssessmentScoringResult":
        """Verify that ranking, classification and completion fields are internally consistent."""
        if self.is_complete != (self.stopping_reason is not None):
            raise ValueError("stopping_reason must be set exactly when is_complete")
        if self.tie_applied and self.stopping_reason != StoppingReason.QUESTION_LIMIT:
            raise ValueError("tie policy is only applied at question_limit")

        if self.ranked_houses and sorted(self.ranked_houses) != sorted(self.house_scores):
            raise ValueError("ranked_houses must be empty or list exactly the house_scores keys")
        rank_of = {house_id: rank for rank, house_id in enumerate(self.ranked_houses, start=1)}
        for house_id, detail in self.house_scores.items():
            if detail.house_id != house_id or detail.rank != rank_of.get(house_id):
                raise ValueError(f"house_scores['{house_id}'] does not match its rank")

        top = [self.primary_house_id, self.secondary_house_id, self.tertiary_house_id]
        for idx, house_id in enumerate(top):
            if house_id is None:
                if any(later is not None for later in top[idx + 1:]):
                    raise ValueError("secondary/tertiary house set without the houses ranked above it")
                break
            if idx >= len(self.ranked_houses) or self.ranked_houses[idx] != house_id:
                raise ValueError(f"top house '{house_id}' does not match ranked_houses[{idx}]")

        if (self.holland_code is None) != (self.tertiary_house_id is None):
            raise ValueError("holland_code is set exactly when the top three houses are ranked")
        return self
