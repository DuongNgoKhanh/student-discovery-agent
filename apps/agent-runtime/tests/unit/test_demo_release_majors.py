"""Majors suggested by the demo release are ones IHRD actually recruits for (the admissions KB)."""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
RELEASE = ROOT / "infra/local-releases/experiences/exp_riasec.json"
KB = ROOT / "docs/operations/kb-tuyensinh"
# Each school document lists its majors in one sentence: "… đào tạo N ngành qua IHRD: A, B, C."
_MAJORS = re.compile(r"đào tạo \d+ ngành qua IHRD: (.+?)\.\n")


def kb_majors() -> set[str]:
    majors = set()
    for document in KB.glob("*.md"):
        found = _MAJORS.search(document.read_text(encoding="utf-8"))
        if found:
            majors.update(name.strip() for name in found.group(1).split(", "))
    return majors


@pytest.mark.skipif(not KB.is_dir(), reason="admissions KB export not present in this checkout")
def test_every_suggested_major_is_in_the_admissions_kb():
    majors = kb_majors()
    houses = json.loads(RELEASE.read_text(encoding="utf-8"))["houses"]
    missing = {house["name"]: [field for field in house["suggested_fields"] if field not in majors]
               for house in houses}
    assert not any(missing.values()), missing
