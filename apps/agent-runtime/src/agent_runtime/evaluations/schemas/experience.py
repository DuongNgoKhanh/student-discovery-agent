"""Experience Definition Schemas matching OpenAPI & ADR-002 specifications.

Supports:
- Definition 1.0 (PR #13 baseline legacy format)
- Definition 2.0 (ADR-002 adaptive RIASEC bank, stopping bounds, rating 1..5)
All models strictly enforce extra='forbid' per OpenAPI additionalProperties: false.
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class AssessmentDefinitionOption(BaseModel):
    """Option choice within an assessment question (general)."""

    option_id: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Unique identifier for the option within the question",
    )
    label: str = Field(..., min_length=1, description="Display label for the option")
    rating: Optional[int] = Field(
        default=None,
        ge=1,
        le=5,
        description="Rating value 1-5 for Likert scale (Definition 2.0)",
    )

    model_config = ConfigDict(extra="forbid")


class AssessmentDefinitionOptionV1(BaseModel):
    """Option choice for Definition 1.0 (strictly option_id and label)."""

    option_id: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Unique identifier for the option within the question",
    )
    label: str = Field(..., min_length=1, description="Display label for the option")

    model_config = ConfigDict(extra="forbid")


class AssessmentDefinitionOptionV2(BaseModel):
    """Option choice for Definition 2.0 (strictly option_id, label, rating)."""

    option_id: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Unique identifier for the option within the question",
    )
    label: str = Field(..., min_length=1, description="Display label for the option")
    rating: int = Field(
        ...,
        ge=1,
        le=5,
        description="Rating value 1-5 for Likert scale (ADR-002 §7.4)",
    )

    model_config = ConfigDict(extra="forbid")


class AssessmentDefinitionQuestion(BaseModel):
    """Question item within an assessment definition (general)."""

    question_id: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Unique identifier for the question",
    )
    prompt: str = Field(..., min_length=1, description="Question text prompt presented to student")
    choices: List[AssessmentDefinitionOption] = Field(
        ..., min_length=2, description="Available answer choices"
    )
    house_id: Optional[str] = Field(
        default=None,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Associated RIASEC house dimension (Definition 2.0: house_r..house_c)",
    )
    item_order: Optional[int] = Field(
        default=None,
        ge=1,
        le=5,
        description="Sequential item order (1..5) within the house (Definition 2.0)",
    )

    model_config = ConfigDict(extra="forbid")


class AssessmentHouseMetadata(BaseModel):
    """Personality House metadata (Holland RIASEC 6 Houses)."""

    house_id: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="House ID (e.g. house_r, house_i, house_a, house_s, house_e, house_c)",
    )
    name: str = Field(..., min_length=1, description="Localized display name of the House")
    theme_ref: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Visual theme reference for frontend rendering",
    )
    mascot_ref: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Mascot reference asset key",
    )
    strengths: List[str] = Field(
        ..., min_length=1, description="Core strengths characterising the House"
    )
    tendencies: List[str] = Field(
        ..., min_length=1, description="Behavioral tendencies characterising the House"
    )
    suggested_fields: List[str] = Field(
        ..., min_length=1, description="Suggested fields of study and careers"
    )
    quote: str = Field(..., min_length=1, description="Signature motivational quote for the House")

    model_config = ConfigDict(extra="forbid")


class AssessmentRuleDocument(BaseModel):
    """Transport document for registered rule schemas (DEC-04)."""

    rule_schema_ref: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Identifier of registered rule schema (e.g. rule.schema.localis.selection.adaptive_bounds:v1)",
    )
    engine_version: str = Field(
        ..., min_length=1, description="Target engine version compatibility"
    )
    payload: Dict[str, Any] = Field(
        ..., description="Rule-specific configuration payload"
    )

    model_config = ConfigDict(extra="forbid")


class AssessmentGoldenAnswer(BaseModel):
    """Answer pairing question_id to option_id in evaluation case."""

    question_id: str = Field(..., pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    option_id: str = Field(..., pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")

    model_config = ConfigDict(extra="forbid")


class AssessmentGoldenExpected(BaseModel):
    """Expected outcome for golden evaluation case."""

    question_ids: Optional[List[str]] = Field(
        default=None, description="Expected sequence of question IDs asked"
    )
    house_id: str = Field(
        ...,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Expected primary winning house ID",
    )
    scores: Optional[Dict[str, float]] = Field(
        default=None, description="Expected score map or mean values"
    )
    stopping_reason: Optional[str] = Field(
        default=None, description="Expected stopping reason (bounded_winner, question_limit)"
    )
    tie_applied: Optional[bool] = Field(
        default=None, description="Whether tie-breaking policy was applied"
    )

    model_config = ConfigDict(extra="forbid")


class AssessmentGoldenCase(BaseModel):
    """Golden evaluation test case (AT-20 / DEC-04 independent verification)."""

    case_id: str = Field(..., pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
    mandatory: bool = Field(default=True, description="Whether passing this case is mandatory")
    answers: List[AssessmentGoldenAnswer] = Field(
        ..., min_length=1, description="Input answer sequence"
    )
    expected: AssessmentGoldenExpected = Field(
        ..., description="Expected deterministic evaluation outcome"
    )

    model_config = ConfigDict(extra="forbid")


class ExperienceDefinitionDocument(BaseModel):
    """Full Experience Definition Document conforming to OpenAPI & ADR-002."""

    schema_version: str = Field(
        ..., description="Definition schema version ('1.0' or '2.0')"
    )
    definition_id: str = Field(
        ..., pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$", description="Unique definition ID"
    )
    definition_version: str = Field(
        ..., min_length=1, description="Semantic version of this definition"
    )
    engine_version: str = Field(
        ..., min_length=1, description="Compatible engine version"
    )
    is_demo: bool = Field(default=False, description="Flag indicating demo configuration")
    questions: List[AssessmentDefinitionQuestion] = Field(
        ..., min_length=6, description="Bank of questions"
    )
    houses: List[AssessmentHouseMetadata] = Field(
        ..., min_length=6, max_length=6, description="Exactly 6 RIASEC houses metadata"
    )
    selection_rules: AssessmentRuleDocument = Field(..., description="Item selection policy")
    scoring_rules: AssessmentRuleDocument = Field(..., description="Scoring & rating policy")
    coverage_rules: AssessmentRuleDocument = Field(..., description="Coverage & stopping policy")
    tie_policy: AssessmentRuleDocument = Field(..., description="Tie breaking order policy")
    templates: Dict[str, str] = Field(
        ..., description="Prompt templates (intro_prompt, clarification_prompt, completion_message)"
    )
    evaluation_cases: List[AssessmentGoldenCase] = Field(
        ..., min_length=1, description="Independent golden test cases (required by OpenAPI)"
    )
    approval_refs: List[str] = Field(
        ..., min_length=1, description="Audit approval references (required by OpenAPI)"
    )

    model_config = ConfigDict(extra="forbid")
