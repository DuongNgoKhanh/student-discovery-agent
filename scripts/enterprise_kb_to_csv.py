"""Turn the enterprise knowledge-base Markdown into a CSV with one row per company, ready for the Studio CSV import.

Usage: python3 scripts/enterprise_kb_to_csv.py docs/operations/kb-doanh-nghiep-lien-ket
Reads doanh-nghiep-lien-ket-<province>.md and quyen-loi-theo-nganh.md; writes import.csv next to them.
A company listed in several province files becomes one document that lists every province. Metadata comes from
the Markdown itself (heading, the "Ngành học liên kết" bullets), so keep that format when editing the files.
"""
import re
import sys
from collections import OrderedDict
from pathlib import Path

from kb_metadata import SUPPORT_VALUES, slug, write_csv

PREFIX = "doanh-nghiep-lien-ket-"
BENEFITS_FILE = "quyen-loi-theo-nganh.md"
PROVINCE_BY_SUFFIX = {
    "hcm": "TP. Hồ Chí Minh", "dong-thap": "Đồng Tháp", "an-giang": "An Giang",
    "vinh-long": "Vĩnh Long", "dbscl": "Khu vực ĐBSCL", "toan-quoc": "Toàn quốc",
}
PROVINCES = list(PROVINCE_BY_SUFFIX.values())
SUPPORT_KEYWORDS = (("hoàn phí", "hoan_phi"), ("lương thực tập", "luong_thuc_tap"),
                    ("cam kết việc làm", "cam_ket_viec_lam"))
MAJORS_MARKER = "- **Ngành học liên kết và quyền lợi của học viên:**"
HEADING = re.compile(r"^(?P<name>.+?)\s+\((?:[^()]|\([^()]*\))*\)\s*$")  # the area may hold one nested "(...)"


def _province(filename: str) -> str:
    suffix = filename.removeprefix(PREFIX).removesuffix(".md")
    if not filename.startswith(PREFIX) or suffix not in PROVINCE_BY_SUFFIX:
        raise ValueError(f"cannot tell the province of {filename}; add its suffix to PROVINCE_BY_SUFFIX")
    return PROVINCE_BY_SUFFIX[suffix]


def _sections(text: str) -> list[tuple[str, str]]:
    """(heading, content) for every '## ' section; content has no heading line."""
    parts = re.split(r"^## (.+)$", text, flags=re.MULTILINE)
    return [(parts[i].strip(), parts[i + 1].strip()) for i in range(1, len(parts), 2)]


def _majors_and_support(content: str) -> tuple[list[str], list[str]]:
    majors: list[str] = []
    benefits: list[str] = []
    lines = content.splitlines()
    if MAJORS_MARKER not in lines:
        return majors, []
    for line in lines[lines.index(MAJORS_MARKER) + 1:]:
        if not line.startswith("  - "):
            break
        item = line[4:].strip()
        name, _, text = item.rpartition(": ")
        if not name:
            name, text = item, ""
        majors.append(name.strip())
        benefits.append(text.lower())
    joined = " ".join(benefits)
    support = [value for keyword, value in SUPPORT_KEYWORDS if keyword in joined]
    return majors, [value for value in SUPPORT_VALUES if value in support]


def _union(first: list[str], second: list[str]) -> list[str]:
    return list(OrderedDict.fromkeys([*first, *second]))


def enterprise_rows(files: dict[str, str]) -> list[dict]:
    companies: OrderedDict[str, dict] = OrderedDict()
    rows: list[dict] = []
    for filename, province in sorted(((name, _province(name)) for name in files if name != BENEFITS_FILE),
                                     key=lambda pair: PROVINCES.index(pair[1])):
        for heading, content in _sections(files[filename]):
            match = HEADING.match(heading)
            name = match["name"] if match else heading
            majors, support = _majors_and_support(content)
            section = f"## {heading}\n\n{content}"
            existing = companies.get(slug(name))
            if existing is None:
                companies[slug(name)] = {
                    "document_id": f"doanh-nghiep-{slug(name)}", "title": f"{name} — doanh nghiệp liên kết IHRD",
                    "body": f"# {heading}\n\n{content}", "source_url": "", "doc_type": "doanh_nghiep",
                    "enterprise": [name], "province": [province], "major": majors, "internship_support": support}
            else:
                existing["province"] = _union(existing["province"], [province])
                existing["major"] = _union(existing["major"], majors)
                existing["internship_support"] = [value for value in SUPPORT_VALUES
                                                  if value in {*existing["internship_support"], *support}]
                existing["body"] += f"\n\n{section}"
    rows.extend(companies.values())
    if BENEFITS_FILE in files:
        text = files[BENEFITS_FILE]
        heading = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
        rows.append({"document_id": "quyen-loi-theo-nganh", "title": heading[1].strip() if heading else "Quyền lợi theo ngành",
                     "body": text.strip(), "source_url": "", "doc_type": "quyen_loi_nganh"})
    return rows


def main(directory: str) -> int:
    folder = Path(directory)
    files = {path.name: path.read_text(encoding="utf-8")
             for path in sorted(folder.glob("*.md"))
             if path.name == BENEFITS_FILE or path.name.startswith(PREFIX)}
    rows = enterprise_rows(files)
    write_csv(folder / "import.csv", rows)
    print(f"wrote {len(rows)} documents to {folder / 'import.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(*sys.argv[1:2]))
