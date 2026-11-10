"""Metadata contract of the IHRD advisory knowledge base (DEC-27) and the CSV the Studio importer reads.

Field names and types cannot change once a knowledge base has them, so this table is the single source: create the
fields in Studio with exactly these names and types (filterable on), then import the CSV mapping every metadata column
to the field of the same name. string_list cells use ';' as the separator, the way the importer splits them.
Tuition fields (tuition_total_vnd, tuition_text) are decided but created later, together with per-program documents.
"""
import csv
import re
import unicodedata
from pathlib import Path

FIELDS = (
    ("doc_type", "string"),
    ("university", "string"),
    ("major", "string_list"),
    ("entry_level", "string_list"),
    ("province", "string_list"),
    ("enterprise", "string_list"),
    ("internship_support", "string_list"),
)
FIELD_NAMES = tuple(name for name, _ in FIELDS)
LIST_FIELDS = frozenset(name for name, kind in FIELDS if kind == "string_list")
CSV_COLUMNS = ("document_id", "title", "body", "source_url", *FIELD_NAMES)
DOC_TYPES = frozenset({"tuyen_sinh", "doanh_nghiep", "quyen_loi_nganh"})
SUPPORT_VALUES = ("hoan_phi", "luong_thuc_tap", "cam_ket_viec_lam")


def slug(text: str) -> str:
    text = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    text = "".join(c for c in text if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _cell(name: str, value) -> str:
    if value is None:
        return ""
    if name in LIST_FIELDS:
        items = [str(item).strip() for item in value if str(item).strip()]
        if any(";" in item for item in items):
            raise ValueError(f"{name}: a list item contains ';', the importer's separator: {items}")
        return ";".join(items)
    return str(value).strip()


def write_csv(path: Path, rows: list[dict]) -> None:
    with Path(path).open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(CSV_COLUMNS)
        for row in rows:
            unknown = set(row) - set(CSV_COLUMNS)
            if unknown:
                raise ValueError(f"unknown columns: {sorted(unknown)}")
            if row.get("doc_type") not in DOC_TYPES:
                raise ValueError(f"doc_type must be one of {sorted(DOC_TYPES)}, got {row.get('doc_type')!r}")
            writer.writerow([_cell(column, row.get(column)) for column in CSV_COLUMNS])
