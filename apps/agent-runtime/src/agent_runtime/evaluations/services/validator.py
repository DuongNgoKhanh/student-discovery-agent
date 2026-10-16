"""Experience Definition Schema Validator (M-EVL).

Implements deterministic validation for ExperienceDefinitionDocument:
- Supports Definition 1.0 (legacy branch tree) and Definition 2.0 (ADR-002 adaptive bank).
- Strict adherence to OpenAPI specs: additionalProperties: false enforced on all schemas.
- Crash-proof handling of unhashable types, None, lists, non-dict payloads, and invalid caller parameters.
- Validates 6 RIASEC houses metadata completeness, 30-item Likert 1-5 rating bank,
  exact 12-item baseline sequence (R1, I1, A1, S1, E1, C1, R2, I2, A2, S2, E2, C2),
  Holland tie-break order, template honesty, and evaluation golden cases integrity.
- Enforces DEC-04 rule schemas registration via CompatibilityChecker.
- Produces deterministic canonical JSON SHA-256 content hash (RFC 8785 principles).
- Outputs field-level and rule-level structured ValidationIssue items and ValidationReport.
"""

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import re
from typing import Any, Dict, List, Optional, Set, Tuple
import uuid

from pydantic import BaseModel

from agent_runtime.evaluations.schemas.experience import ExperienceDefinitionDocument
from agent_runtime.evaluations.schemas.validation import (
    ValidationIssue,
    ValidationReport,
    ValidationStatus,
)
from agent_runtime.evaluations.services.compatibility import (
    CompatibilityChecker,
    DEFAULT_ENGINE_REGISTRY,
)

EXPECTED_HOUSES = {"house_r", "house_i", "house_a", "house_s", "house_e", "house_c"}
ID_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
REPORT_ID_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MAX_REVISION = 9007199254740991

# Allowed root keys (OpenAPI additionalProperties: false)
ROOT_ALLOWED_KEYS = {
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
    "evaluation_cases",
    "approval_refs",
}

HOUSE_ALLOWED_KEYS = {
    "house_id",
    "name",
    "theme_ref",
    "mascot_ref",
    "strengths",
    "tendencies",
    "suggested_fields",
    "quote",
}

TEMPLATE_ALLOWED_KEYS = {"intro_prompt", "clarification_prompt", "completion_message"}
RULE_DOC_ALLOWED_KEYS = {"rule_schema_ref", "engine_version", "payload"}

# Baseline sequence specification (ADR-002 §7.4)
EXPECTED_BASELINE_SEQUENCE = [
    ("house_r", 1),
    ("house_i", 1),
    ("house_a", 1),
    ("house_s", 1),
    ("house_e", 1),
    ("house_c", 1),
    ("house_r", 2),
    ("house_i", 2),
    ("house_a", 2),
    ("house_s", 2),
    ("house_e", 2),
    ("house_c", 2),
]


def is_strict_int(val: Any) -> bool:
    """Check if value is an integer and strictly not a boolean."""
    return isinstance(val, int) and not isinstance(val, bool)


def calculate_content_hash(doc_input: Any) -> str:
    """Calculate deterministic canonical SHA256 content hash.

    Follows RFC 8785 principles: sorted keys, no whitespace separators, allow_nan=False.
    Guarantees identical hash whether input is a dict or a Pydantic model.
    """
    if isinstance(doc_input, BaseModel):
        doc = doc_input.model_dump(exclude_unset=True, mode="json")
    elif isinstance(doc_input, dict):
        doc = doc_input
    else:
        doc = {"raw": str(doc_input)}

    canonical_json = json.dumps(
        doc,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )
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
        """Validate an experience definition document and return a full ValidationReport.

        Guaranteed crash-proof: handles malformed types, None, unhashable structures,
        and invalid caller parameters cleanly.
        """
        issues: List[ValidationIssue] = []

        # 1. Sanitize caller inputs to guarantee ValidationReport construction cannot fail
        rep_exp_id = "unknown_experience"
        if isinstance(experience_id, str) and REPORT_ID_REGEX.fullmatch(experience_id):
            rep_exp_id = experience_id
        else:
            issues.append(
                ValidationIssue(
                    path="experience_id",
                    code="VAL_INVALID_EXPERIENCE_ID",
                    message=f"Caller experience_id '{experience_id}' is invalid or does not match ID pattern.",
                    rule_id="INPUT_SANITY",
                )
            )

        rep_draft_revision = 0
        if is_strict_int(draft_revision) and 0 <= draft_revision <= MAX_REVISION:
            rep_draft_revision = draft_revision
        else:
            issues.append(
                ValidationIssue(
                    path="draft_revision",
                    code="VAL_INVALID_DRAFT_REVISION",
                    message=f"Caller draft_revision '{draft_revision}' must be an integer in 0..{MAX_REVISION}.",
                    rule_id="INPUT_SANITY",
                )
            )

        # 2. Check top-level document type
        if isinstance(doc_input, BaseModel):
            doc = doc_input.model_dump(exclude_unset=True, mode="json")
        elif isinstance(doc_input, dict):
            doc = deepcopy(doc_input)
        else:
            issues.append(
                ValidationIssue(
                    path="root",
                    code="VAL_INVALID_TYPE",
                    message=f"Document must be an object (dictionary), got '{type(doc_input).__name__}'.",
                    rule_id="DOCUMENT_STRUCTURE",
                )
            )
            return ValidationReport(
                id=f"val_{uuid.uuid4().hex[:16]}",
                experience_id=rep_exp_id,
                draft_revision=rep_draft_revision,
                content_hash=calculate_content_hash(doc_input),
                definition_schema_version="unknown",
                engine_version="unknown",
                status=ValidationStatus.FAILED,
                mandatory_passed=False,
                issues=issues,
                created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )

        content_hash = calculate_content_hash(doc)

        raw_schema_ver = doc.get("schema_version")
        raw_engine_ver = doc.get("engine_version")

        rep_schema_version = raw_schema_ver if (isinstance(raw_schema_ver, str) and raw_schema_ver.strip()) else "unknown"
        rep_engine_version = raw_engine_ver if (isinstance(raw_engine_ver, str) and raw_engine_ver.strip()) else "unknown"

        # 3. Check unexpected root fields (additionalProperties: false)
        for key in list(doc.keys()):
            if key not in ROOT_ALLOWED_KEYS:
                issues.append(
                    ValidationIssue(
                        path=key,
                        code="VAL_UNEXPECTED_FIELD",
                        message=f"Unexpected field '{key}' not permitted by ExperienceDefinitionDocument schema.",
                        rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                    )
                )

        # 4. Check compatibility (DEC-04 & Engine registration)
        rule_docs = {}
        for rule_key in ["selection_rules", "scoring_rules", "coverage_rules", "tie_policy"]:
            val = doc.get(rule_key)
            if isinstance(val, dict):
                rule_docs[rule_key] = val

        compat_status, compat_issues = self.compat_checker.check_compatibility(
            schema_version=raw_schema_ver if isinstance(raw_schema_ver, str) else "",
            engine_version=raw_engine_ver if isinstance(raw_engine_ver, str) else "",
            rule_docs=rule_docs,
        )
        issues.extend(compat_issues)

        # 5. Structural & Field-level Validation
        self._validate_root_fields(doc, issues)
        self._validate_houses(doc.get("houses"), issues)
        self._validate_templates(doc.get("templates"), raw_schema_ver, issues)
        self._validate_rule_documents(doc, issues)
        self._validate_approval_refs(doc.get("approval_refs"), issues)

        # 6. Version-specific Question & Rule Invariants
        if raw_schema_ver == "2.0":
            self._validate_definition_v2(doc, issues)
        elif raw_schema_ver == "1.0":
            self._validate_definition_v1(doc, issues)
            # Legacy payload schemas differ from the adaptive pilot and have not
            # been registered with semantic validators. Structural checks alone
            # must never certify a legacy definition for execution/publication.
            compat_status = ValidationStatus.UNSUPPORTED
            issues.append(
                ValidationIssue(
                    path="schema_version",
                    code="VAL_UNSUPPORTED_RULE_PAYLOAD",
                    message="Definition 1.0 rule payload validation is not registered; only structural diagnostics are available.",
                    rule_id="RULE_SCHEMA_COMPATIBILITY",
                )
            )
        else:
            if "schema_version" in doc and doc["schema_version"] is not None:
                issues.append(
                    ValidationIssue(
                        path="schema_version",
                        code="VAL_INVALID_SCHEMA_VERSION",
                        message=f"Unsupported schema_version '{raw_schema_ver}'. Supported: ['1.0', '2.0'].",
                        rule_id="SCHEMA_VERSION_SUPPORTED",
                    )
                )

        # 7. Validate Evaluation Cases
        self._validate_evaluation_cases(doc.get("evaluation_cases"), doc, raw_schema_ver, issues)

        # 8. Determine Status
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
            experience_id=rep_exp_id,
            draft_revision=rep_draft_revision,
            content_hash=content_hash,
            definition_schema_version=rep_schema_version,
            engine_version=rep_engine_version,
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
            "evaluation_cases",
            "approval_refs",
        ]
        for field in required_fields:
            val = doc.get(field)
            if field not in doc or val is None or (isinstance(val, str) and not val.strip()):
                issues.append(
                    ValidationIssue(
                        path=field,
                        code="VAL_MISSING_REQUIRED_FIELD",
                        message=f"Missing or empty required field '{field}'.",
                        rule_id="DOCUMENT_STRUCTURE",
                    )
                )

        def_id = doc.get("definition_id")
        if def_id is not None:
            if not isinstance(def_id, str):
                issues.append(
                    ValidationIssue(
                        path="definition_id",
                        code="VAL_INVALID_TYPE",
                        message=f"definition_id must be a string, got '{type(def_id).__name__}'.",
                        rule_id="IDENTIFIER_FORMAT",
                    )
                )
            elif not ID_REGEX.match(def_id):
                issues.append(
                    ValidationIssue(
                        path="definition_id",
                        code="VAL_INVALID_IDENTIFIER_FORMAT",
                        message=f"definition_id '{def_id}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                        rule_id="IDENTIFIER_FORMAT",
                    )
                )

        def_ver = doc.get("definition_version")
        if def_ver is not None and (not isinstance(def_ver, str) or not def_ver.strip()):
            issues.append(
                ValidationIssue(
                    path="definition_version",
                    code="VAL_INVALID_FIELD",
                    message="definition_version must be a non-empty string.",
                    rule_id="DOCUMENT_STRUCTURE",
                )
            )

        is_demo = doc.get("is_demo")
        if is_demo is not None and not isinstance(is_demo, bool):
            issues.append(
                ValidationIssue(
                    path="is_demo",
                    code="VAL_INVALID_TYPE",
                    message="is_demo must be a boolean.",
                    rule_id="DOCUMENT_STRUCTURE",
                )
            )

    def _validate_houses(self, houses: Any, issues: List[ValidationIssue]):
        """Validate RIASEC 6 Houses metadata completeness (DEC-04 / Section 7.3)."""
        if houses is None:
            return

        if not isinstance(houses, list):
            issues.append(
                ValidationIssue(
                    path="houses",
                    code="VAL_INVALID_TYPE",
                    message=f"houses must be a list of 6 house metadata objects, got '{type(houses).__name__}'.",
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
                        message=f"House element must be a dictionary object, got '{type(house).__name__}'.",
                        rule_id="HOUSE_METADATA_INTEGRITY",
                    )
                )
                continue

            # Check extra keys in house dict
            for k in house:
                if k not in HOUSE_ALLOWED_KEYS:
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.{k}",
                            code="VAL_UNEXPECTED_FIELD",
                            message=f"Unexpected field '{k}' in house definition.",
                            rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                        )
                    )

            house_id = house.get("house_id")
            if "house_id" not in house or house_id is None:
                issues.append(
                    ValidationIssue(
                        path=f"{path}.house_id",
                        code="VAL_MISSING_HOUSE_ID",
                        message="House missing valid house_id string.",
                        rule_id="HOUSE_METADATA_INTEGRITY",
                    )
                )
            elif not isinstance(house_id, str):
                issues.append(
                    ValidationIssue(
                        path=f"{path}.house_id",
                        code="VAL_INVALID_TYPE",
                        message=f"house_id must be a string, got '{type(house_id).__name__}'.",
                        rule_id="HOUSE_METADATA_INTEGRITY",
                    )
                )
            elif not house_id.strip():
                issues.append(
                    ValidationIssue(
                        path=f"{path}.house_id",
                        code="VAL_MISSING_HOUSE_ID",
                        message="House house_id cannot be blank.",
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

                if not ID_REGEX.match(house_id):
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.house_id",
                            code="VAL_INVALID_IDENTIFIER_FORMAT",
                            message=f"house_id '{house_id}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                            rule_id="IDENTIFIER_FORMAT",
                        )
                    )

            # Metadata string fields check
            for req in ["name", "theme_ref", "mascot_ref", "quote"]:
                val = house.get(req)
                if not isinstance(val, str) or not val.strip():
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.{req}",
                            code="VAL_INVALID_HOUSE_METADATA",
                            message=f"House '{house_id or i}' missing non-empty string for '{req}'.",
                            rule_id="HOUSE_METADATA_INTEGRITY",
                        )
                    )
                elif req in ["theme_ref", "mascot_ref"] and not ID_REGEX.match(val):
                    issues.append(
                        ValidationIssue(
                            path=f"{path}.{req}",
                            code="VAL_INVALID_IDENTIFIER_FORMAT",
                            message=f"House '{req}' '{val}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                            rule_id="IDENTIFIER_FORMAT",
                        )
                    )

            # Metadata list fields check
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
                else:
                    for idx, item in enumerate(items):
                        if not isinstance(item, str) or not item.strip():
                            issues.append(
                                ValidationIssue(
                                    path=f"{path}.{list_field}[{idx}]",
                                    code="VAL_INVALID_HOUSE_METADATA",
                                    message=f"House '{house_id or i}' {list_field}[{idx}] must be a non-empty string.",
                                    rule_id="HOUSE_METADATA_INTEGRITY",
                                )
                            )

    def _validate_templates(self, templates: Any, schema_version: Any, issues: List[ValidationIssue]):
        """Validate UI prompt templates and check promises."""
        if templates is None:
            return

        if not isinstance(templates, dict):
            issues.append(
                ValidationIssue(
                    path="templates",
                    code="VAL_INVALID_TYPE",
                    message=f"templates must be an object with intro_prompt, clarification_prompt, and completion_message, got '{type(templates).__name__}'.",
                    rule_id="TEMPLATE_INTEGRITY",
                )
            )
            return

        # Check unexpected keys
        for k in templates:
            if k not in TEMPLATE_ALLOWED_KEYS:
                issues.append(
                    ValidationIssue(
                        path=f"templates.{k}",
                        code="VAL_UNEXPECTED_FIELD",
                        message=f"Unexpected field '{k}' in templates.",
                        rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                    )
                )

        for key in ["intro_prompt", "clarification_prompt", "completion_message"]:
            text = templates.get(key)
            if not isinstance(text, str) or not text.strip():
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
            if key not in doc:
                continue

            rule_doc = doc.get(key)
            if not isinstance(rule_doc, dict):
                issues.append(
                    ValidationIssue(
                        path=key,
                        code="VAL_INVALID_TYPE",
                        message=f"Rule document '{key}' must be an object with rule_schema_ref, engine_version, and payload, got '{type(rule_doc).__name__}'.",
                        rule_id="RULE_DOCUMENT_STRUCTURE",
                    )
                )
                continue

            # Check extra keys
            for k in rule_doc:
                if k not in RULE_DOC_ALLOWED_KEYS:
                    issues.append(
                        ValidationIssue(
                            path=f"{key}.{k}",
                            code="VAL_UNEXPECTED_FIELD",
                            message=f"Unexpected field '{k}' in rule document '{key}'.",
                            rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                        )
                    )

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

            for field in ["rule_schema_ref", "engine_version"]:
                value = rule_doc.get(field)
                if value is not None and (not isinstance(value, str) or not value.strip()):
                    issues.append(
                        ValidationIssue(
                            path=f"{key}.{field}",
                            code="VAL_INVALID_TYPE",
                            message=f"{field} must be a non-empty string.",
                            rule_id="RULE_DOCUMENT_STRUCTURE",
                        )
                    )

            payload = rule_doc.get("payload")
            if payload is not None and not isinstance(payload, dict):
                issues.append(
                    ValidationIssue(
                        path=f"{key}.payload",
                        code="VAL_INVALID_TYPE",
                        message=f"Rule document '{key}.payload' must be an object dictionary, got '{type(payload).__name__}'.",
                        rule_id="RULE_DOCUMENT_STRUCTURE",
                    )
                )

    def _validate_approval_refs(self, refs: Any, issues: List[ValidationIssue]):
        """Validate audit approval references."""
        if refs is None:
            return

        if not isinstance(refs, list):
            issues.append(
                ValidationIssue(
                    path="approval_refs",
                    code="VAL_INVALID_TYPE",
                    message=f"approval_refs must be a list of string identifiers, got '{type(refs).__name__}'.",
                    rule_id="APPROVAL_REFS_INTEGRITY",
                )
            )
            return

        if len(refs) == 0:
            issues.append(
                ValidationIssue(
                    path="approval_refs",
                    code="VAL_MISSING_REQUIRED_FIELD",
                    message="approval_refs must contain at least one audit reference string.",
                    rule_id="APPROVAL_REFS_INTEGRITY",
                )
            )
            return

        for idx, ref in enumerate(refs):
            if not isinstance(ref, str) or not ref.strip():
                issues.append(
                    ValidationIssue(
                        path=f"approval_refs[{idx}]",
                        code="VAL_INVALID_IDENTIFIER_FORMAT",
                        message=f"approval_refs[{idx}] must be a non-empty string.",
                        rule_id="APPROVAL_REFS_INTEGRITY",
                    )
                )
            elif not ID_REGEX.match(ref):
                issues.append(
                    ValidationIssue(
                        path=f"approval_refs[{idx}]",
                        code="VAL_INVALID_IDENTIFIER_FORMAT",
                        message=f"approval_refs[{idx}] '{ref}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                        rule_id="APPROVAL_REFS_INTEGRITY",
                    )
                )

    def _validate_definition_v1(self, doc: Dict[str, Any], issues: List[ValidationIssue]):
        """Validate Definition 1.0 specific invariants."""
        questions = doc.get("questions")
        if questions is None:
            return

        if not isinstance(questions, list):
            issues.append(
                ValidationIssue(
                    path="questions",
                    code="VAL_INVALID_TYPE",
                    message=f"questions must be a list of question objects, got '{type(questions).__name__}'.",
                    rule_id="QUESTION_BANK_INTEGRITY",
                )
            )
            return

        if len(questions) < 6:
            issues.append(
                ValidationIssue(
                    path="questions",
                    code="VAL_INVALID_QUESTION_COUNT",
                    message=f"Definition 1.0 requires at least 6 questions, found {len(questions)}.",
                    rule_id="QUESTION_BANK_INTEGRITY",
                )
            )

        seen_qids: Set[str] = set()
        V1_Q_ALLOWED = {"question_id", "prompt", "choices"}
        V1_OPT_ALLOWED = {"option_id", "label"}

        for i, q in enumerate(questions):
            q_path = f"questions[{i}]"
            if not isinstance(q, dict):
                issues.append(
                    ValidationIssue(
                        path=q_path,
                        code="VAL_INVALID_TYPE",
                        message=f"Question at index {i} must be an object dictionary, got '{type(q).__name__}'.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )
                continue

            for k in q:
                if k not in V1_Q_ALLOWED:
                    issues.append(
                        ValidationIssue(
                            path=f"{q_path}.{k}",
                            code="VAL_UNEXPECTED_FIELD",
                            message=f"Unexpected field '{k}' in Definition 1.0 question.",
                            rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                        )
                    )

            qid = q.get("question_id")
            if not isinstance(qid, str) or not qid.strip():
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

                if not ID_REGEX.match(qid):
                    issues.append(
                        ValidationIssue(
                            path=f"{q_path}.question_id",
                            code="VAL_INVALID_IDENTIFIER_FORMAT",
                            message=f"question_id '{qid}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                            rule_id="IDENTIFIER_FORMAT",
                        )
                    )

            prompt = q.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.prompt",
                        code="VAL_INVALID_FIELD",
                        message=f"Question '{qid or i}' prompt must be a non-empty string.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )

            choices = q.get("choices")
            if not isinstance(choices, list) or len(choices) < 2:
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.choices",
                        code="VAL_INVALID_CHOICE_COUNT",
                        message=f"Question '{qid or i}' choices must be a list of at least 2 options.",
                        rule_id="CHOICE_INTEGRITY",
                    )
                )
            else:
                seen_opt_ids: Set[str] = set()
                for j, opt in enumerate(choices):
                    opt_path = f"{q_path}.choices[{j}]"
                    if not isinstance(opt, dict):
                        issues.append(
                            ValidationIssue(
                                path=opt_path,
                                code="VAL_INVALID_TYPE",
                                message=f"Choice at {opt_path} must be an object dictionary, got '{type(opt).__name__}'.",
                                rule_id="CHOICE_INTEGRITY",
                            )
                        )
                        continue

                    for k in opt:
                        if k not in V1_OPT_ALLOWED:
                            issues.append(
                                ValidationIssue(
                                    path=f"{opt_path}.{k}",
                                    code="VAL_UNEXPECTED_FIELD",
                                    message=f"Unexpected field '{k}' in Definition 1.0 choice.",
                                    rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                                )
                            )

                    opt_id = opt.get("option_id")
                    if not isinstance(opt_id, str) or not opt_id.strip():
                        issues.append(
                            ValidationIssue(
                                path=f"{opt_path}.option_id",
                                code="VAL_MISSING_OPTION_ID",
                                message=f"Choice at index {j} in question '{qid or i}' missing option_id.",
                                rule_id="CHOICE_INTEGRITY",
                            )
                        )
                    else:
                        if opt_id in seen_opt_ids:
                            issues.append(
                                ValidationIssue(
                                    path=f"{opt_path}.option_id",
                                    code="VAL_DUPLICATE_OPTION_ID",
                                    message=f"Duplicate option_id '{opt_id}' in question '{qid}'.",
                                    rule_id="CHOICE_INTEGRITY",
                                )
                            )
                        if not ID_REGEX.fullmatch(opt_id):
                            issues.append(
                                ValidationIssue(
                                    path=f"{opt_path}.option_id",
                                    code="VAL_INVALID_IDENTIFIER_FORMAT",
                                    message="option_id must match the identifier pattern.",
                                    rule_id="IDENTIFIER_FORMAT",
                                )
                            )
                        seen_opt_ids.add(opt_id)

                    label = opt.get("label")
                    if not isinstance(label, str) or not label.strip():
                        issues.append(
                            ValidationIssue(
                                path=f"{opt_path}.label",
                                code="VAL_INVALID_FIELD",
                                message=f"Choice '{opt_id or j}' label must be a non-empty string.",
                                rule_id="CHOICE_INTEGRITY",
                            )
                        )

        # Validate V1 rule payloads
        for r_key in ["selection_rules", "scoring_rules", "coverage_rules", "tie_policy"]:
            r_doc = doc.get(r_key)
            if isinstance(r_doc, dict):
                r_payload = r_doc.get("payload")
                if isinstance(r_payload, dict) and len(r_payload) == 0:
                    issues.append(
                        ValidationIssue(
                            path=f"{r_key}.payload",
                            code="VAL_MISSING_RULE_FIELD",
                            message=f"Rule document '{r_key}' payload cannot be empty.",
                            rule_id="RULE_DOCUMENT_STRUCTURE",
                        )
                    )

        sel_rules = doc.get("selection_rules")
        if isinstance(sel_rules, dict) and isinstance(sel_rules.get("payload"), dict) and sel_rules["payload"]:
            init_qid = sel_rules["payload"].get("initial_question_id")
            if not isinstance(init_qid, str) or init_qid not in seen_qids:
                issues.append(
                    ValidationIssue(
                        path="selection_rules.payload.initial_question_id",
                        code="VAL_INVALID_INITIAL_QUESTION",
                        message=f"initial_question_id '{init_qid}' must be a valid question_id from the bank.",
                        rule_id="SELECTION_INTEGRITY",
                    )
                )

        cov_rules = doc.get("coverage_rules")
        if isinstance(cov_rules, dict) and isinstance(cov_rules.get("payload"), dict) and cov_rules["payload"]:
            req_count = cov_rules["payload"].get("required_question_count")
            if not is_strict_int(req_count) or req_count != 6:
                issues.append(
                    ValidationIssue(
                        path="coverage_rules.payload.required_question_count",
                        code="VAL_INVALID_COVERAGE_CONFIG",
                        message=f"Definition 1.0 required_question_count must be 6, found '{req_count}'.",
                        rule_id="COVERAGE_RULES_INTEGRITY",
                    )
                )

    def _validate_definition_v2(self, doc: Dict[str, Any], issues: List[ValidationIssue]):
        """Validate Definition 2.0 (ADR-002 Adaptive RIASEC Profile) invariants."""
        questions = doc.get("questions")
        if questions is None:
            return

        if not isinstance(questions, list):
            issues.append(
                ValidationIssue(
                    path="questions",
                    code="VAL_INVALID_TYPE",
                    message=f"questions must be a list of 30 question objects, got '{type(questions).__name__}'.",
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
        V2_Q_ALLOWED = {"question_id", "prompt", "choices", "house_id", "item_order"}
        V2_OPT_ALLOWED = {"option_id", "label", "rating"}

        for i, q in enumerate(questions):
            q_path = f"questions[{i}]"
            if not isinstance(q, dict):
                issues.append(
                    ValidationIssue(
                        path=q_path,
                        code="VAL_INVALID_TYPE",
                        message=f"Question at index {i} must be an object dictionary, got '{type(q).__name__}'.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )
                continue

            for k in q:
                if k not in V2_Q_ALLOWED:
                    issues.append(
                        ValidationIssue(
                            path=f"{q_path}.{k}",
                            code="VAL_UNEXPECTED_FIELD",
                            message=f"Unexpected field '{k}' in Definition 2.0 question.",
                            rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                        )
                    )

            qid = q.get("question_id")
            if not isinstance(qid, str) or not qid.strip():
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

                if not ID_REGEX.match(qid):
                    issues.append(
                        ValidationIssue(
                            path=f"{q_path}.question_id",
                            code="VAL_INVALID_IDENTIFIER_FORMAT",
                            message=f"question_id '{qid}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                            rule_id="IDENTIFIER_FORMAT",
                        )
                    )

            prompt = q.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.prompt",
                        code="VAL_INVALID_FIELD",
                        message=f"Question '{qid or i}' prompt must be a non-empty string.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )

            house_id = q.get("house_id")
            if not isinstance(house_id, str) or house_id not in EXPECTED_HOUSES:
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.house_id",
                        code="VAL_INVALID_HOUSE_REF",
                        message=f"Question '{qid or i}' must declare a valid house_id from {EXPECTED_HOUSES}.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )

            item_order = q.get("item_order")
            if not is_strict_int(item_order) or item_order < 1 or item_order > 5:
                issues.append(
                    ValidationIssue(
                        path=f"{q_path}.item_order",
                        code="VAL_INVALID_ITEM_ORDER",
                        message=f"Question '{qid or i}' item_order must be an integer between 1 and 5, got '{item_order}'.",
                        rule_id="QUESTION_BANK_INTEGRITY",
                    )
                )
            elif isinstance(house_id, str) and house_id in house_item_orders:
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
                        issues.append(
                            ValidationIssue(
                                path=opt_path,
                                code="VAL_INVALID_TYPE",
                                message=f"Choice at {opt_path} must be an object dictionary, got '{type(opt).__name__}'.",
                                rule_id="RATING_SCALE_INTEGRITY",
                            )
                        )
                        continue

                    for k in opt:
                        if k not in V2_OPT_ALLOWED:
                            issues.append(
                                ValidationIssue(
                                    path=f"{opt_path}.{k}",
                                    code="VAL_UNEXPECTED_FIELD",
                                    message=f"Unexpected field '{k}' in Definition 2.0 choice.",
                                    rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                                )
                            )

                    opt_id = opt.get("option_id")
                    if not isinstance(opt_id, str) or not opt_id.strip():
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
                        if not ID_REGEX.fullmatch(opt_id):
                            issues.append(
                                ValidationIssue(
                                    path=f"{opt_path}.option_id",
                                    code="VAL_INVALID_IDENTIFIER_FORMAT",
                                    message="option_id must match the identifier pattern.",
                                    rule_id="IDENTIFIER_FORMAT",
                                )
                            )
                        seen_opt_ids.add(opt_id)

                    label = opt.get("label")
                    if not isinstance(label, str) or not label.strip():
                        issues.append(
                            ValidationIssue(
                                path=f"{opt_path}.label",
                                code="VAL_INVALID_FIELD",
                                message=f"Option '{opt_id or j}' label must be a non-empty string.",
                                rule_id="RATING_SCALE_INTEGRITY",
                            )
                        )

                    rating = opt.get("rating")
                    if not is_strict_int(rating) or rating < 1 or rating > 5:
                        issues.append(
                            ValidationIssue(
                                path=f"{opt_path}.rating",
                                code="VAL_INVALID_RATING",
                                message=f"Option '{opt_id or j}' rating must be an integer in 1..5, got '{rating}'.",
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
        sel_rules = doc.get("selection_rules")
        if isinstance(sel_rules, dict):
            payload = sel_rules.get("payload")
            if isinstance(payload, dict):
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
                    # Check each item is string and check for duplicates
                    has_invalid_type = False
                    for b_idx, b_item in enumerate(baseline):
                        if not isinstance(b_item, str):
                            has_invalid_type = True
                            issues.append(
                                ValidationIssue(
                                    path=f"selection_rules.payload.baseline_order[{b_idx}]",
                                    code="VAL_INVALID_TYPE",
                                    message=f"baseline_order item must be a string question ID, got '{type(b_item).__name__}'.",
                                    rule_id="BASELINE_SELECTION_INTEGRITY",
                                )
                            )

                    if not has_invalid_type:
                        if len(set(baseline)) != 12:
                            issues.append(
                                ValidationIssue(
                                    path="selection_rules.payload.baseline_order",
                                    code="VAL_DUPLICATE_BASELINE_QUESTION",
                                    message="baseline_order must not contain duplicate question IDs.",
                                    rule_id="BASELINE_SELECTION_INTEGRITY",
                                )
                            )

                        missing_in_bank = [
                            (b_idx, qid) for b_idx, qid in enumerate(baseline)
                            if qid not in seen_qids
                        ]
                        if missing_in_bank:
                            for b_idx, qid in missing_in_bank:
                                issues.append(
                                    ValidationIssue(
                                        path=f"selection_rules.payload.baseline_order[{b_idx}]",
                                        code="VAL_BASELINE_QUESTION_NOT_IN_BANK",
                                        message=f"Baseline contains question ID '{qid}' not found in question bank.",
                                        rule_id="BASELINE_SELECTION_INTEGRITY",
                                    )
                                )
                        else:
                            # Map question ID to its (house_id, item_order) in bank
                            qid_to_house_order = {
                                q.get("question_id"): (q.get("house_id"), q.get("item_order"))
                                for q in questions if isinstance(q, dict) and "question_id" in q
                            }
                            actual_seq = [qid_to_house_order.get(qid) for qid in baseline]
                            for b_idx, (actual_item, exp_item) in enumerate(zip(actual_seq, EXPECTED_BASELINE_SEQUENCE)):
                                if actual_item != exp_item:
                                    issues.append(
                                        ValidationIssue(
                                            path=f"selection_rules.payload.baseline_order[{b_idx}]",
                                            code="VAL_INVALID_BASELINE_SEQUENCE",
                                            message=(
                                                f"baseline_order[{b_idx}] expected ({exp_item[0]}, item_order={exp_item[1]}), "
                                                f"got ({actual_item[0] if actual_item else 'None'}, item_order={actual_item[1] if actual_item else 'None'}). "
                                                "Sequence must strictly follow R1, I1, A1, S1, E1, C1, R2, I2, A2, S2, E2, C2 per ADR-002 §7.4."
                                            ),
                                            rule_id="BASELINE_SELECTION_INTEGRITY",
                                        )
                                    )
                                    break

                if payload.get("selector") != "widest_bound_gap":
                    issues.append(
                        ValidationIssue(
                            path="selection_rules.payload.selector",
                            code="VAL_INVALID_SELECTOR_ALGORITHM",
                            message=f"Adaptive selection algorithm must be 'widest_bound_gap', found '{payload.get('selector')}'.",
                            rule_id="SELECTION_ALGORITHM_INTEGRITY",
                        )
                    )

                if payload.get("fallback") != "tie_order_then_item_order":
                    issues.append(
                        ValidationIssue(
                            path="selection_rules.payload.fallback",
                            code="VAL_INVALID_SELECTION_FALLBACK",
                            message=f"Selection fallback policy must be 'tie_order_then_item_order' per ADR-002 §7.2, found '{payload.get('fallback')}'.",
                            rule_id="SELECTION_ALGORITHM_INTEGRITY",
                        )
                    )

        # 4. Tie Policy payload validation (R/I/A/S/E/C permutation)
        tie_policy = doc.get("tie_policy")
        if isinstance(tie_policy, dict):
            tie_payload = tie_policy.get("payload")
            if isinstance(tie_payload, dict):
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
        cov_rules = doc.get("coverage_rules")
        if isinstance(cov_rules, dict):
            cov_payload = cov_rules.get("payload")
            if isinstance(cov_payload, dict):
                items_ph = cov_payload.get("items_per_house")
                base_tot = cov_payload.get("baseline_total")
                min_ans = cov_payload.get("min_answers_per_house")
                max_tot = cov_payload.get("max_total")

                if not is_strict_int(items_ph) or items_ph != 5:
                    issues.append(
                        ValidationIssue(
                            path="coverage_rules.payload.items_per_house",
                            code="VAL_INVALID_COVERAGE_CONFIG",
                            message=f"items_per_house must be 5, found '{items_ph}'.",
                            rule_id="COVERAGE_RULES_INTEGRITY",
                        )
                    )
                if not is_strict_int(base_tot) or base_tot != 12:
                    issues.append(
                        ValidationIssue(
                            path="coverage_rules.payload.baseline_total",
                            code="VAL_INVALID_COVERAGE_CONFIG",
                            message=f"baseline_total must be 12, found '{base_tot}'.",
                            rule_id="COVERAGE_RULES_INTEGRITY",
                        )
                    )
                if not is_strict_int(min_ans) or min_ans != 2:
                    issues.append(
                        ValidationIssue(
                            path="coverage_rules.payload.min_answers_per_house",
                            code="VAL_INVALID_MIN_ANSWERS",
                            message=f"min_answers_per_house must be 2, found '{min_ans}'.",
                            rule_id="COVERAGE_RULES_INTEGRITY",
                        )
                    )
                if not is_strict_int(max_tot) or max_tot != 30:
                    issues.append(
                        ValidationIssue(
                            path="coverage_rules.payload.max_total",
                            code="VAL_INVALID_COVERAGE_CONFIG",
                            message=f"max_total must be 30, found '{max_tot}'.",
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

        # 6. Scoring Rules payload validation
        scoring_rules = doc.get("scoring_rules")
        if isinstance(scoring_rules, dict):
            scoring_payload = scoring_rules.get("payload")
            if isinstance(scoring_payload, dict):
                scale = scoring_payload.get("rating_scale")
                if scale != [1, 5]:
                    issues.append(
                        ValidationIssue(
                            path="scoring_rules.payload.rating_scale",
                            code="VAL_INVALID_RATING_SCALE",
                            message=f"rating_scale must be [1, 5], found '{scale}'.",
                            rule_id="SCORING_CONFIG_INTEGRITY",
                        )
                    )
                algo = scoring_payload.get("algorithm")
                if algo != "mean_rating":
                    issues.append(
                        ValidationIssue(
                            path="scoring_rules.payload.algorithm",
                            code="VAL_INVALID_SCORING_CONFIG",
                            message=f"Scoring algorithm must be 'mean_rating', found '{algo}'.",
                            rule_id="SCORING_CONFIG_INTEGRITY",
                        )
                    )

    def _validate_evaluation_cases(
        self,
        cases: Any,
        doc: Dict[str, Any],
        schema_version: Any,
        issues: List[ValidationIssue],
    ):
        """Validate evaluation golden test cases."""
        if cases is None:
            return

        if not isinstance(cases, list):
            issues.append(
                ValidationIssue(
                    path="evaluation_cases",
                    code="VAL_INVALID_TYPE",
                    message=f"evaluation_cases must be a list of golden cases, got '{type(cases).__name__}'.",
                    rule_id="EVALUATION_CASES_INTEGRITY",
                )
            )
            return

        if len(cases) == 0:
            issues.append(
                ValidationIssue(
                    path="evaluation_cases",
                    code="VAL_MISSING_REQUIRED_FIELD",
                    message="evaluation_cases must contain at least one golden case.",
                    rule_id="EVALUATION_CASES_INTEGRITY",
                )
            )
            return

        # Build bank lookup: question_id -> set of option_ids
        q_bank: Dict[str, Set[str]] = {}
        raw_questions = doc.get("questions")
        if isinstance(raw_questions, list):
            for q in raw_questions:
                if isinstance(q, dict) and isinstance(q.get("question_id"), str):
                    qid = q["question_id"]
                    choices = q.get("choices")
                    opt_ids = set()
                    if isinstance(choices, list):
                        for c in choices:
                            if isinstance(c, dict) and isinstance(c.get("option_id"), str):
                                opt_ids.add(c["option_id"])
                    q_bank[qid] = opt_ids

        CASE_ALLOWED_KEYS = {"case_id", "mandatory", "answers", "expected"}
        EXPECTED_ALLOWED_KEYS = {"question_ids", "house_id", "scores", "stopping_reason", "tie_applied"}

        for k, case in enumerate(cases):
            case_path = f"evaluation_cases[{k}]"
            if not isinstance(case, dict):
                issues.append(
                    ValidationIssue(
                        path=case_path,
                        code="VAL_INVALID_TYPE",
                        message=f"Golden case at {case_path} must be an object dictionary, got '{type(case).__name__}'.",
                        rule_id="EVALUATION_CASES_INTEGRITY",
                    )
                )
                continue

            for field in case:
                if field not in CASE_ALLOWED_KEYS:
                    issues.append(
                        ValidationIssue(
                            path=f"{case_path}.{field}",
                            code="VAL_UNEXPECTED_FIELD",
                            message=f"Unexpected field '{field}' in golden case.",
                            rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                        )
                    )

            case_id = case.get("case_id")
            if not isinstance(case_id, str) or not ID_REGEX.match(case_id):
                issues.append(
                    ValidationIssue(
                        path=f"{case_path}.case_id",
                        code="VAL_INVALID_IDENTIFIER_FORMAT",
                        message=f"case_id '{case_id}' does not match pattern ^[A-Za-z0-9][A-Za-z0-9._:-]*$",
                        rule_id="EVALUATION_CASES_INTEGRITY",
                    )
                )

            mandatory = case.get("mandatory")
            if not isinstance(mandatory, bool):
                issues.append(
                    ValidationIssue(
                        path=f"{case_path}.mandatory",
                        code="VAL_INVALID_TYPE",
                        message="Golden case field 'mandatory' must be a boolean.",
                        rule_id="EVALUATION_CASES_INTEGRITY",
                    )
                )

            answers = case.get("answers")
            if not isinstance(answers, list) or len(answers) == 0:
                issues.append(
                    ValidationIssue(
                        path=f"{case_path}.answers",
                        code="VAL_INVALID_GOLDEN_ANSWERS_COUNT",
                        message="answers must be a non-empty list of question-option answer objects.",
                        rule_id="EVALUATION_CASES_INTEGRITY",
                    )
                )
            else:
                if schema_version == "2.0":
                    if len(answers) < 12 or len(answers) > 30:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.answers",
                                code="VAL_INVALID_GOLDEN_ANSWERS_COUNT",
                                message=f"Definition 2.0 evaluation case must have between 12 and 30 answers, found {len(answers)}.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )
                elif schema_version == "1.0":
                    if len(answers) != 6:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.answers",
                                code="VAL_INVALID_GOLDEN_ANSWERS_COUNT",
                                message=f"Definition 1.0 evaluation case must have exactly 6 answers, found {len(answers)}.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )

                # Validate each answer against the bank
                for a_idx, ans in enumerate(answers):
                    ans_path = f"{case_path}.answers[{a_idx}]"
                    if not isinstance(ans, dict):
                        issues.append(
                            ValidationIssue(
                                path=ans_path,
                                code="VAL_INVALID_TYPE",
                                message="Answer element must be an object dictionary with question_id and option_id.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )
                        continue

                    qid = ans.get("question_id")
                    opt_id = ans.get("option_id")

                    for field in ans:
                        if field not in {"question_id", "option_id"}:
                            issues.append(
                                ValidationIssue(
                                    path=f"{ans_path}.{field}",
                                    code="VAL_UNEXPECTED_FIELD",
                                    message=f"Unexpected field '{field}' in golden answer.",
                                    rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                                )
                            )

                    if not isinstance(qid, str) or qid not in q_bank:
                        issues.append(
                            ValidationIssue(
                                path=f"{ans_path}.question_id",
                                code="VAL_INVALID_GOLDEN_ANSWER",
                                message=f"Answer question_id '{qid}' does not exist in question bank.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )
                    elif not isinstance(opt_id, str) or opt_id not in q_bank[qid]:
                        issues.append(
                            ValidationIssue(
                                path=f"{ans_path}.option_id",
                                code="VAL_EVALUATION_ANSWER_OPTION_MISMATCH",
                                message=f"Answer option_id '{opt_id}' does not belong to question '{qid}'.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )

            # Validate expected outcome
            expected = case.get("expected")
            if not isinstance(expected, dict):
                issues.append(
                    ValidationIssue(
                        path=f"{case_path}.expected",
                        code="VAL_INVALID_TYPE",
                        message="expected outcome must be an object dictionary.",
                        rule_id="EVALUATION_CASES_INTEGRITY",
                    )
                )
            else:
                for field in expected:
                    if field not in EXPECTED_ALLOWED_KEYS:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.expected.{field}",
                                code="VAL_UNEXPECTED_FIELD",
                                message=f"Unexpected field '{field}' in golden case expected outcome.",
                                rule_id="SCHEMA_NO_ADDITIONAL_PROPERTIES",
                            )
                        )

                for exp_req in ["question_ids", "house_id", "scores"]:
                    if exp_req not in expected or expected[exp_req] is None:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.expected.{exp_req}",
                                code="VAL_MISSING_REQUIRED_FIELD",
                                message=f"Golden case expected outcome missing required field '{exp_req}'.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )

                qids = expected.get("question_ids")
                if qids is not None and (not isinstance(qids, list) or len(qids) == 0):
                    issues.append(
                        ValidationIssue(
                            path=f"{case_path}.expected.question_ids",
                            code="VAL_INVALID_TYPE",
                            message="expected.question_ids must be a non-empty list of string question IDs.",
                            rule_id="EVALUATION_CASES_INTEGRITY",
                        )
                    )

                elif isinstance(qids, list):
                    for idx, qid in enumerate(qids):
                        if not isinstance(qid, str) or not ID_REGEX.fullmatch(qid) or qid not in q_bank:
                            issues.append(
                                ValidationIssue(
                                    path=f"{case_path}.expected.question_ids[{idx}]",
                                    code="VAL_INVALID_GOLDEN_ANSWER",
                                    message="Expected question ID must identify a question in the bank.",
                                    rule_id="EVALUATION_CASES_INTEGRITY",
                                )
                            )
                    if isinstance(answers, list) and qids != [a.get("question_id") if isinstance(a, dict) else None for a in answers]:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.expected.question_ids",
                                code="VAL_INVALID_GOLDEN_ANSWERS_COUNT",
                                message="Expected question sequence must match the supplied golden answers.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )

                scores = expected.get("scores")
                if scores is not None and not isinstance(scores, dict):
                    issues.append(
                        ValidationIssue(
                            path=f"{case_path}.expected.scores",
                            code="VAL_INVALID_TYPE",
                            message="expected.scores must be a dictionary mapping house IDs to scores.",
                            rule_id="EVALUATION_CASES_INTEGRITY",
                        )
                    )
                elif isinstance(scores, dict):
                    if set(scores) != EXPECTED_HOUSES:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.expected.scores",
                                code="VAL_INVALID_TYPE",
                                message="expected.scores must map exactly the six RIASEC house IDs to numbers.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )
                    for house_id, score in scores.items():
                        if isinstance(score, bool) or not isinstance(score, (int, float)) or (isinstance(score, float) and not math.isfinite(score)):
                            issues.append(
                                ValidationIssue(
                                    path=f"{case_path}.expected.scores.{house_id}",
                                    code="VAL_INVALID_TYPE",
                                    message="Expected score must be a finite number, not a boolean.",
                                    rule_id="EVALUATION_CASES_INTEGRITY",
                                )
                            )

                exp_house = expected.get("house_id")
                if exp_house is not None and (not isinstance(exp_house, str) or exp_house not in EXPECTED_HOUSES):
                    issues.append(
                        ValidationIssue(
                            path=f"{case_path}.expected.house_id",
                            code="VAL_INVALID_HOUSE_REF",
                            message=f"expected.house_id '{exp_house}' must be one of {EXPECTED_HOUSES}.",
                            rule_id="EVALUATION_CASES_INTEGRITY",
                        )
                    )

                if schema_version == "2.0":
                    stopping_reason = expected.get("stopping_reason")
                    if not isinstance(stopping_reason, str) or stopping_reason not in {"bounded_winner", "question_limit"}:
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.expected.stopping_reason",
                                code="VAL_INVALID_STOPPING_REASON",
                                message=f"stopping_reason must be 'bounded_winner' or 'question_limit', found '{stopping_reason}'.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )

                    tie_applied = expected.get("tie_applied")
                    if not isinstance(tie_applied, bool):
                        issues.append(
                            ValidationIssue(
                                path=f"{case_path}.expected.tie_applied",
                                code="VAL_INVALID_TYPE",
                                message="tie_applied must be a boolean in Definition 2.0 evaluation case.",
                                rule_id="EVALUATION_CASES_INTEGRITY",
                            )
                        )


def validate_experience_definition(
    doc: Any,
    experience_id: str = "exp_personality_v1",
    draft_revision: int = 1,
    compatibility_checker: Optional[CompatibilityChecker] = None,
) -> ValidationReport:
    """Convenience helper to validate experience definition document."""
    validator = ExperienceValidator(compatibility_checker=compatibility_checker)
    return validator.validate(doc, experience_id=experience_id, draft_revision=draft_revision)
