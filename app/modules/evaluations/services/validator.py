"""Experience Definition Schema Validator (M-EVL).

Implements deterministic validation for ExperienceDefinitionDocument:
- Supports Definition 1.0 (legacy branch tree) and Definition 2.0 (ADR-002 adaptive bank)
- Enforces house metadata completeness, question bank integrity, rating scale invariants,
  baseline order coverage, tie order policy, and template rules
- Verifies DEC-04 rule schema registration via CompatibilityChecker
- Outputs field-level and rule-level structured ValidationIssue items
- Produces ValidationReport matching OpenAPI specifications.
"""

from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import uuid

from app.modules.evaluations.schemas.experience import ExperienceDefinitionDocument
from app.modules.evaluations.schemas.validation import (
    ValidationIssue,
    ValidationReport,
    ValidationStatus,
)
from app.modules.evaluations.services.compatibility import (
    CompatibilityChecker,
    DEFAULT_ENGINE_REGISTRY,
)

EXPECTED_HOUSES = {"house_r", "house_i", "house_a", "house_s", "house_e", "house_c"}
ID_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")


def calculate_content_hash(doc: Dict[str, Any]) -> str:
    """Calculate deterministic canonical SHA256 content hash."""
    canonical_json = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


class ExperienceValidator:
    """Deterministic validator for experience definition documents."""

    def __init__(self, compatibility_checker: Optional[CompatibilityChecker] = None):
        self.compat_checker = compatibility_checker or CompatibilityChecker()

    def validate(
        self,
        doc_input: Any,
        experience_id: str = "exp_personality_v1",
        draft_revision: int = 1,
    ) -> ValidationReport:
        """Validate an experience definition document and return a full ValidationReport."""
        # Convert Pydantic model to dict if needed
        if isinstance(doc_input, ExperienceDefinitionDocument):
            doc = doc_input.model_dump()
        elif isinstance(doc_input, dict):
            doc = doc_input
        else:
            raise ValueError("Input must be a dict or ExperienceDefinitionDocument")

        content_hash = calculate_content_hash(doc)
        schema_version = str(doc.get("schema_version", ""))
        engine_version = str(doc.get("engine_version", ""))

        issues: List[ValidationIssue] = []

        # 1. Compatibility Check (DEC-04 & Engine registration)
        rule_schemas = {}
        for rule_key in ["selection_rules", "scoring_rules", "coverage_rules", "tie_policy"]:
            rule_doc = doc.get(rule_key)
            if isinstance(rule_doc, dict) and "rule_schema_ref" in rule_doc:
                rule_schemas[rule_key] = str(rule_doc["rule_schema_ref"])

        compat_status, compat_issues = self.compat_checker.check_compatibility(
            schema_version=schema_version,
            engine_version=engine_version,
            rule_schemas=rule_schemas,
        )
        issues.extend(compat_issues)

        # 2. Structural & Field-level Validation
        self._validate_root_fields(doc, issues)
        self._validate_houses(doc.get("houses"), issues)
        self._validate_templates(doc.get("templates"), schema_version, issues)
        self._validate_rule_documents(doc, issues)

        # 3. Version-specific Question & Rule Invariants
        if schema_version == "2.0":
            self._validate_definition_v2(doc, issues)
        elif schema_version == "1.0":
            self._validate_definition_v1(doc, issues)
        else:
            issues.append(
                ValidationIssue(
                    path="schema_version",
                    code="VAL_INVALID_SCHEMA_VERSION",
                    message=f"Unsupported schema_version '{schema_version}'. Supported: ['1.0', '2.0'].",
                    rule_id="SCHEMA_VERSION_SUPPORTED",
                )
            )

        # 4. Determine Status
        if compat_status == ValidationStatus.UNSUPPORTED:
            status = ValidationStatus.UNSUPPORTED
        elif issues:
            status = ValidationStatus.FAILED
        else:
            status = ValidationStatus.PASSED

        mandatory_passed = (status == ValidationStatus.PASSED) and (len(issues) == 0)

        report_id = f"val_{uuid.uuid4().hex[:16]}"
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        return ValidationReport(
            id=report_id,
            experience_id=experience_id,
            draft_revision=draft_revision,
            content_hash=content_hash,
            definition_schema_version=schema_version,
            engine_version=engine_version,
            status=status,
            mandatory_passed=mandatory_passed,
            issues=issues,
            created_at=now_utc,
        )

    def _validate_root_fields(self, doc: Dict[str, Any], issues: List[ValidationIssue]):
        """Validate top-level required fields and ID patterns."""
        required_fields = [
            "schema_version",
            "definition_id",
            "definition_version",
            "engine_version",
            "is_demo",
            "questions",
            "houses",
            "selection_rules",
            "scoring_rules",
            "coverage_rules",
            "tie_policy",
            "templates",
        ]
        for field in required_fields:
            if field not in doc or doc[field] is None:
                issues.append(
                    ValidationIssue(
                        path=field,
                        code="VAL_MISSING_REQUIRED_FIELD",
                        message=f"Missing required field '{field}'.",
                        rule_id="DOCUMENT_STRUCTURE",
                    )
                )

        def_id = doc.get("definition_id")
        if def_id and not ID_REGEX.match(str(def_id)):
            issues.append(
                ValidationIssue(
                    path="definition_id",
                    code="VAL_INVALID_IDENTIFIER_FORMAT",
                    message=f"definition_id '{def_id}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                    rule_id="IDENTIFIER_FORMAT",
                )
            )

    def _validate_houses(self, houses: Any, issues: List[ValidationIssue]):
        """Validate RIASEC 6 Houses metadata completeness (DEC-04 / Section 7.3)."""
        if not isinstance(houses, list):
            issues.append(
                ValidationIssue(
                    path="houses",
                    code="VAL_INVALID_TYPE",
                    message="houses must be a list of 6 house metadata objects.",
                    rule_id="HOUSE_METADATA_INTEGRITY",
                )
            )
            return

        if len(houses) != 6:
            issues.append(
                ValidationIssue(
                    path="houses",
                    code="VAL_INVALID_HOUSE_COUNT",
                    message=f"Assessment must declare exactly 6 Houses, found {len(houses)}.",
                    rule_id="HOUSE_METADATA_INTEGRITY",
                )
            )

        seen_house_ids: Set[str] = set()
        for i, house in enumerate(houses):
            path = f"houses[{i}]"
            if not isinstance(house, dict):
                issues.append(
                    ValidationIssue(
                        path=path,
                        code="VAL_INVALID_TYPE",
                        message="House element must be a dictionary object.",
                        rule_id="HOUSE_METADATA_INTEGRITY",
                    )
                )
                continue

            house_id = house.get("house_id")
            if not house_id or not isinstance(house_id, str):
                issues.append(
                    ValidationIssue(
                        path=f"{path}.house_id",
                        code="VAL_MISSING_HOUSE_ID",
                        message="House missing valid house_id string.",
                        rule_id="HOUSE_METADATA_INTEGRITY",
                    )
                )
            else:
                if house_id in seen_house_ids:
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.house_id",
                            code="VAL_DUPLICATE_HOUSE_ID",
                            message=f"Duplicate house_id '{house_id}' detected.",
                            rule_id="HOUSE_METADATA_INTEGRITY",
                        )
                    )
                seen_house_ids.add(house_id)

                if house_id not in EXPECTED_HOUSES:
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.house_id",
                            code="VAL_UNRECOGNIZED_HOUSE_ID",
                            message=f"house_id '{house_id}' is not in standard RIASEC houses {EXPECTED_HOUSES}.",
                            rule_id="HOUSE_METADATA_INTEGRITY",
                        )
                    )

            # Metadata fields check
            for req in ["name", "theme_ref", "mascot_ref", "quote"]:
                val = house.get(req)
                if not val or not isinstance(val, str) or not val.strip():
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.{req}",
                            code="VAL_INVALID_HOUSE_METADATA",
                            message=f"House '{house_id or i}' missing non-empty string for '{req}'.",
                            rule_id="HOUSE_METADATA_INTEGRITY",
                        )
                    )

            for list_field in ["strengths", "tendencies", "suggested_fields"]:
                items = house.get(list_field)
                if not isinstance(items, list) or len(items) == 0:
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.{list_field}",
                            code="VAL_INVALID_HOUSE_METADATA",
                            message=f"House '{house_id or i}' field '{list_field}' must be a non-empty list of strings.",
                            rule_id="HOUSE_METADATA_INTEGRITY",
                        )
                    )

    def _validate_templates(self, templates: Any, schema_version: str, issues: List[ValidationIssue]):
        """Validate UI prompt templates and check promises."""
        if not isinstance(templates, dict):
            issues.append(
                ValidationIssue(
                    path="templates",
                    code="VAL_INVALID_TYPE",
                    message="templates must be an object with intro_prompt, clarification_prompt, and completion_message.",
                    rule_id="TEMPLATE_INTEGRITY",
                )
            )
            return

        for key in ["intro_prompt", "clarification_prompt", "completion_message"]:
            text = templates.get(key)
            if not text or not isinstance(text, str) or not text.strip():
                issues.append(
                    ValidationIssue(
                        path=f"templates.{key}",
                        code="VAL_MISSING_TEMPLATE",
                        message=f"Template key '{key}' is missing or empty.",
                        rule_id="TEMPLATE_INTEGRITY",
                    )
                )

        # In Definition 2.0 (adaptive), templates must NOT promise a fixed number of questions (ADR-002 Section 7.2)
        if schema_version == "2.0":
            for key, val in templates.items():
                if isinstance(val, str) and ("6 câu hỏi" in val or "6 câu" in val):
                    issues.append(
                        ValidationIssue(
                            path=f"templates.{key}",
                            code="VAL_PROMISED_FIXED_QUESTIONS",
                            message=(
                                f"Template '{key}' promises a fixed question count ('6 câu/câu hỏi'). "
                                "Definition 2.0 adaptive assessment journeys vary between 12 and 30 items "
                                "and must not promise a fixed number of questions."
                            ),
                            rule_id="ADAPTIVE_TEMPLATE_HONESTY",
                        )
                    )

    def _validate_rule_documents(self, doc: Dict[str, Any], issues: List[ValidationIssue]):
        """Validate structure of the four rule documents."""
        rule_keys = ["selection_rules", "scoring_rules", "coverage_rules", "tie_policy"]
        for key in rule_keys:
            rule_doc = doc.get(key)
            if not isinstance(rule_doc, dict):
                issues.append(
                    ValidationIssue(
                        path=key,
                        code="VAL_INVALID_TYPE",
                        message=f"Rule document '{key}' must be an object with rule_schema_ref, engine_version, and payload.",
                        rule_id="RULE_DOCUMENT_STRUCTURE",
                    )
                )
                continue

            for field in ["rule_schema_ref", "engine_version", "payload"]:
                if field not in rule_doc or rule_doc[field] is None:
                    issues.append(
                        ValidationIssue(
                            path=f"{key}.{field}",
                            code="VAL_MISSING_RULE_FIELD",
                            message=f"Rule document '{key}' is missing required field '{field}'.",
                            rule_id="RULE_DOCUMENT_STRUCTURE",
                        )
                    )

    def _validate_definition_v1(self, doc: Dict[str, Any], issues: List[ValidationIssue]):
        """Validate Definition 1.0 specific invariants."""
        questions = doc.get("questions")
        if isinstance(questions, list):
            if len(questions) < 6:
                issues.append(
                    ValidationIssue(
                        path="questions",
                        code="VAL_INVALID_QUESTION_COUNT",
                        message=f"Definition 1.0 requires at least 6 questions, found {len(questions)}.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )

    def _validate_definition_v2(self, doc: Dict[str, Any], issues: List[ValidationIssue]):
        """Validate Definition 2.0 (ADR-002 Adaptive RIASEC Profile) invariants."""
        questions = doc.get("questions")
        if not isinstance(questions, list):
            issues.append(
                ValidationIssue(
                    path="questions",
                    code="VAL_INVALID_TYPE",
                    message="questions must be a list of 30 question objects.",
                    rule_id="QUESTION_BANK_INTEGRITY",
                )
            )
            return

        # 1. Total Bank Size: Exactly 30 questions
        if len(questions) != 30:
            issues.append(
                ValidationIssue(
                    path="questions",
                    code="VAL_INVALID_QUESTION_COUNT",
                    message=f"Definition 2.0 requires exactly 30 questions (5 items x 6 houses), found {len(questions)}.",
                    rule_id="QUESTION_BANK_INTEGRITY",
                )
            )

        seen_qids: Set[str] = set()
        house_item_orders: Dict[str, List[int]] = {h: [] for h in EXPECTED_HOUSES}

        for i, q in enumerate(questions):
            q_path = f"questions[{i}]"
            if not isinstance(q, dict):
                continue

            qid = q.get("question_id")
            if not qid or not isinstance(qid, str):
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.question_id",
                        code="VAL_MISSING_QUESTION_ID",
                        message=f"Question at index {i} missing valid question_id.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )
            else:
                if qid in seen_qids:
                    issues.append(
                        ValidationIssue(
                            path=f"{q_path}.question_id",
                            code="VAL_DUPLICATE_QUESTION_ID",
                            message=f"Duplicate question_id '{qid}' detected in question bank.",
                            rule_id="QUESTION_BANK_INTEGRITY",
                        )
                    )
                seen_qids.add(qid)

            house_id = q.get("house_id")
            if not house_id or house_id not in EXPECTED_HOUSES:
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.house_id",
                        code="VAL_INVALID_HOUSE_REF",
                        message=f"Question '{qid or i}' must declare a valid house_id from {EXPECTED_HOUSES}.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )

            item_order = q.get("item_order")
            if item_order is None or not isinstance(item_order, int) or item_order < 1 or item_order > 5:
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.item_order",
                        code="VAL_INVALID_ITEM_ORDER",
                        message=f"Question '{qid or i}' item_order must be an integer between 1 and 5.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )
            elif house_id in house_item_orders:
                house_item_orders[house_id].append(item_order)

            # Validate Choices: Exactly 5 choices with ratings 1..5
            choices = q.get("choices")
            if not isinstance(choices, list) or len(choices) != 5:
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.choices",
                        code="VAL_INVALID_CHOICE_COUNT",
                        message=f"Question '{qid or i}' must have exactly 5 Likert choices (ratings 1..5).",
                        rule_id="RATING_SCALE_INTEGRITY",
                    )
                )
            else:
                choice_ratings: Set[int] = set()
                seen_opt_ids: Set[str] = set()
                for j, opt in enumerate(choices):
                    opt_path = f"{q_path}.choices[{j}]"
                    if not isinstance(opt, dict):
                        continue
                    opt_id = opt.get("option_id")
                    if not opt_id or not isinstance(opt_id, str):
                        issues.append(
                            ValidationIssue(
                                path=f"{opt_path}.option_id",
                                code="VAL_MISSING_OPTION_ID",
                                message=f"Option in question '{qid or i}' missing valid option_id.",
                                rule_id="RATING_SCALE_INTEGRITY",
                            )
                        )
                    else:
                        if opt_id in seen_opt_ids:
                            issues.append(
                                ValidationIssue(
                                    path=f"{opt_path}.option_id",
                                    code="VAL_DUPLICATE_OPTION_ID",
                                    message=f"Duplicate option_id '{opt_id}' in question '{qid}'.",
                                    rule_id="RATING_SCALE_INTEGRITY",
                                )
                            )
                        seen_opt_ids.add(opt_id)

                    rating = opt.get("rating")
                    if rating is None or not isinstance(rating, int) or rating < 1 or rating > 5:
                        issues.append(
                            ValidationIssue(
                                path=f"{opt_path}.rating",
                                code="VAL_INVALID_RATING",
                                message=f"Option '{opt_id or j}' rating must be an integer in 1..5.",
                                rule_id="RATING_SCALE_INTEGRITY",
                            )
                        )
                    else:
                        choice_ratings.add(rating)

                if choice_ratings != {1, 2, 3, 4, 5}:
                    issues.append(
                        ValidationIssue(
                            path=f"{q_path}.choices",
                            code="VAL_INCOMPLETE_RATING_SCALE",
                            message=f"Question '{qid or i}' choices do not cover the complete Likert scale [1, 2, 3, 4, 5].",
                            rule_id="RATING_SCALE_INTEGRITY",
                        )
                    )

        # 2. Check 5 items per house and permutation [1, 2, 3, 4, 5]
        for h, orders in house_item_orders.items():
            if len(orders) != 5:
                issues.append(
                    ValidationIssue(
                        path="questions",
                        code="VAL_HOUSE_QUESTION_COUNT_MISMATCH",
                        message=f"House '{h}' must have exactly 5 questions, found {len(orders)}.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )
            if sorted(orders) != [1, 2, 3, 4, 5]:
                issues.append(
                    ValidationIssue(
                        path="questions",
                        code="VAL_HOUSE_ITEM_ORDER_MISMATCH",
                        message=f"House '{h}' item_order sequence must be exactly [1, 2, 3, 4, 5], found {sorted(orders)}.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )

        # 3. Selection Rules payload validation (baseline_order, selector, fallback)
        sel_rules = doc.get("selection_rules", {})
        if isinstance(sel_rules, dict):
            payload = sel_rules.get("payload", {})
            baseline = payload.get("baseline_order")
            if not isinstance(baseline, list) or len(baseline) != 12:
                issues.append(
                    ValidationIssue(
                        path="selection_rules.payload.baseline_order",
                        code="VAL_INVALID_BASELINE_COUNT",
                        message=f"baseline_order must contain exactly 12 question IDs, found {len(baseline) if isinstance(baseline, list) else 0}.",
                        rule_id="BASELINE_SELECTION_INTEGRITY",
                    )
                )
            else:
                # All baseline question IDs must exist in bank
                missing_in_bank = [qid for qid in baseline if qid not in seen_qids]
                if missing_in_bank:
                    issues.append(
                        ValidationIssue(
                            path="selection_rules.payload.baseline_order",
                            code="VAL_BASELINE_QUESTION_NOT_IN_BANK",
                            message=f"Baseline contains question IDs not found in question bank: {missing_in_bank}.",
                            rule_id="BASELINE_SELECTION_INTEGRITY",
                        )
                    )

            if payload.get("selector") != "widest_bound_gap":
                issues.append(
                    ValidationIssue(
                        path="selection_rules.payload.selector",
                        code="VAL_INVALID_SELECTOR_ALGORITHM",
                        message=f"Adaptive selection algorithm must be 'widest_bound_gap', found '{payload.get('selector')}'.",
                        rule_id="SELECTION_ALGORITHM_INTEGRITY",
                    )
                )

        # 4. Tie Policy payload validation (R/I/A/S/E/C permutation)
        tie_policy = doc.get("tie_policy", {})
        if isinstance(tie_policy, dict):
            tie_payload = tie_policy.get("payload", {})
            order = tie_payload.get("order")
            expected_tie_order = ["house_r", "house_i", "house_a", "house_s", "house_e", "house_c"]
            if order != expected_tie_order:
                issues.append(
                    ValidationIssue(
                        path="tie_policy.payload.order",
                        code="VAL_INVALID_TIE_ORDER",
                        message=(
                            f"Tie order policy must be the exact approved DEC-04 Holland permutation "
                            f"{expected_tie_order}, found {order}."
                        ),
                        rule_id="TIE_POLICY_INTEGRITY",
                    )
                )
            if tie_payload.get("apply_at") != "question_limit":
                issues.append(
                    ValidationIssue(
                        path="tie_policy.payload.apply_at",
                        code="VAL_INVALID_TIE_APPLY_CONDITION",
                        message=f"Tie order must apply at 'question_limit', found '{tie_payload.get('apply_at')}'.",
                        rule_id="TIE_POLICY_INTEGRITY",
                    )
                )

        # 5. Coverage Rules payload validation
        cov_rules = doc.get("coverage_rules", {})
        if isinstance(cov_rules, dict):
            cov_payload = cov_rules.get("payload", {})
            if cov_payload.get("items_per_house") != 5 or cov_payload.get("baseline_total") != 12 or cov_payload.get("max_total") != 30:
                issues.append(
                    ValidationIssue(
                        path="coverage_rules.payload",
                        code="VAL_INVALID_COVERAGE_CONFIG",
                        message="Coverage payload must specify items_per_house=5, baseline_total=12, max_total=30.",
                        rule_id="COVERAGE_RULES_INTEGRITY",
                    )
                )
            if cov_payload.get("stop") != "strict_bounds":
                issues.append(
                    ValidationIssue(
                        path="coverage_rules.payload.stop",
                        code="VAL_INVALID_STOP_POLICY",
                        message=f"Stopping policy must be 'strict_bounds', found '{cov_payload.get('stop')}'.",
                        rule_id="STOP_POLICY_INTEGRITY",
                    )
                )


def validate_experience_definition(
    doc: Any,
    experience_id: str = "exp_personality_v1",
    draft_revision: int = 1,
) -> ValidationReport:
    """Convenience helper to validate experience definition document."""
    validator = ExperienceValidator()
    return validator.validate(doc, experience_id=experience_id, draft_revision=draft_revision)
