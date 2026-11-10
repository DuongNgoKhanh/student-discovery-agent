"""Convert Data_TUYENSINH xlsx into one Markdown document per school for the knowledge base.

Usage: python3 scripts/xlsx_to_kb_md.py docs/operations/Data_TUYENSINH_v2.xlsx docs/operations/kb-tuyensinh
Requires openpyxl. Output file names are already slugs, so the knowledge lab keeps them as document_id.
Facts shared by every row of a school are written once at the top; each major then lists only what differs.
Also writes import.csv (one row per school with metadata) for the Studio CSV import; see kb_metadata.py.
"""
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

from kb_metadata import slug, write_csv

ENTRY_LABELS = {
    "THPT": "Đã tốt nghiệp THPT",
    "Trung cấp": "Đã tốt nghiệp Trung cấp",
    "Cao đẳng": "Đã tốt nghiệp Cao đẳng",
    "Đại học": "Đã có bằng Đại học (văn bằng 2)",
}
FIELD_LABELS = OrderedDict([
    ("loai_bang", "Văn bằng"),
    ("thoi_gian_dao_tao", "Thời gian đào tạo"),
    ("hoc_phi", "Học phí"),
    ("ghi_chu_hoc_phi", "Ghi chú học phí"),
    ("le_phi_xet_tuyen", "Lệ phí xét tuyển"),
    ("hinh_thuc_hoc", "Hình thức học"),
    ("hinh_thuc_thi", "Hình thức thi"),
    ("tram_thi", "Địa điểm/trạm thi"),
    ("ghi_chu", "Ghi chú"),
])
PER_ENTRY = {"thoi_gian_dao_tao", "hoc_phi"}  # always listed under each entry group, even when identical
DTHU_STATIONS = "14 trạm đào tạo từ xa – xem sheet TRAM_THI"


def clean(value) -> str:
    return re.sub(r"[ \t]*\n[ \t]*", "\n", str(value or "")).strip()


def sheet_rows(wb, name: str) -> list[dict]:
    rows = list(wb[name].iter_rows(values_only=True))
    header = [clean(h) for h in rows[0]]
    return [dict(zip(header, map(clean, row))) for row in rows[1:] if any(row)]


def bullet(label: str, value: str) -> str:
    lines = [line.strip(" ;") for line in value.split("\n") if line.strip(" ;")]
    if len(lines) == 1:
        return f"- **{label}:** {lines[0]}"
    return f"- **{label}:**\n" + "\n".join(f"  - {line}" for line in lines)


def common(rows: list[dict], fields) -> dict[str, str]:
    return {f: rows[0][f] for f in fields if f not in PER_ENTRY and len({r[f] for r in rows}) == 1}


def school_doc(school: dict, majors: dict[str, list[dict]], dthu_stations: list[dict]) -> str:
    name, code = school["ten_truong"], school["ten_viet_tat"]
    rows = [r for group in majors.values() for r in group]
    school_shared = common(rows, FIELD_LABELS)
    out = [f"# {name} ({code}) — Thông tin tuyển sinh", "",
           f"{name}, viết tắt {code}, tuyển sinh {len(majors)} ngành qua IHRD.", "",
           "## Thông tin chung của trường", ""]
    out += [bullet(FIELD_LABELS[f], v) for f, v in school_shared.items() if v and f != "tram_thi"]

    stations = [v for v in OrderedDict.fromkeys(r["tram_thi"] for r in rows) if v]
    if stations:
        out += ["", "## Địa điểm thi", ""]
        for value in stations:
            if value == DTHU_STATIONS:
                out += [f"- **{s['ten_tram']}** ({s['don_vi']}): {s['dia_chi']} — {s['tinh_thanh']}"
                        for s in dthu_stations]
            else:
                out.append(bullet("Địa điểm/trạm thi", value))

    # Names every major next to "đào tạo": list questions must match this chunk, not one per-major chunk.
    out += ["", "## Các ngành đào tạo", "",
            f"{name} ({code}) đang đào tạo {len(majors)} ngành qua IHRD: {', '.join(majors)}.", ""]
    out += [f"- {major}: " + ", ".join(ENTRY_LABELS.get(r["doi_tuong_dau_vao"], r["doi_tuong_dau_vao"])
                                       for r in group) for major, group in majors.items()]

    rest = [f for f in FIELD_LABELS if f not in school_shared and f != "tram_thi"]
    for major, group in majors.items():
        major_shared = common(group, rest)
        out += ["", f"## Ngành {major}", ""]
        out += [bullet(FIELD_LABELS[f], v) for f, v in major_shared.items() if v]
        for row in group:
            entry = ENTRY_LABELS.get(row["doi_tuong_dau_vao"], row["doi_tuong_dau_vao"])
            out += ["", f"### {major} — {entry}", ""]
            out += [bullet(FIELD_LABELS[f], row[f]) for f in rest if f not in major_shared and row[f]]
    return "\n".join(out) + "\n"


def school_metadata(school: dict, majors: dict[str, list[dict]]) -> dict:
    levels = list(OrderedDict.fromkeys(r["doi_tuong_dau_vao"] for group in majors.values() for r in group))
    return {"doc_type": "tuyen_sinh", "university": school["ten_viet_tat"], "major": list(majors),
            "entry_level": levels}


def school_row(school: dict, majors: dict[str, list[dict]], dthu_stations: list[dict]) -> dict:
    name, code = school["ten_truong"], school["ten_viet_tat"]
    return {"document_id": f"tuyen-sinh-{slug(code)}", "title": f"{name} ({code}) — Thông tin tuyển sinh",
            "body": school_doc(school, majors, dthu_stations).strip(), "source_url": ""} | school_metadata(school, majors)


def main(source: str, target: str) -> int:
    import openpyxl

    wb = openpyxl.load_workbook(source, data_only=True)
    schools = {s["ten_viet_tat"]: s for s in sheet_rows(wb, "TRUONG")}
    dthu_stations = [s for s in sheet_rows(wb, "TRAM_THI") if s["ten_tram"].startswith("Trạm số")]
    programs: dict[str, OrderedDict[str, list[dict]]] = defaultdict(OrderedDict)
    for row in sheet_rows(wb, "MASTER_TU_VAN"):
        programs[row["university_id"]].setdefault(row["ten_nganh"], []).append(row)

    out_dir = Path(target)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for code, majors in programs.items():
        body = school_doc(schools[code], majors, dthu_stations)
        (out_dir / f"tuyen-sinh-{slug(code)}.md").write_text(body, encoding="utf-8")
        rows.append(school_row(schools[code], majors, dthu_stations))
    write_csv(out_dir / "import.csv", rows)
    print(f"wrote {len(programs)} documents and import.csv to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(*sys.argv[1:3]))
