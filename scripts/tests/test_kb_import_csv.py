"""CSV import files for the IHRD advisory knowledge base (DEC-27): format and metadata rules."""
import csv
import filecmp
from pathlib import Path

import enterprise_kb_to_csv as enterprise
import pytest
import xlsx_to_kb_md as xlsx
from kb_metadata import CSV_COLUMNS, FIELDS, LIST_FIELDS, slug, write_csv

REPO = Path(__file__).resolve().parents[2]


def read(path):
    with open(path, encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def row(**changes):
    return {"document_id": "d1", "title": "T", "body": "# T", "source_url": "", "doc_type": "tuyen_sinh"} | changes


def test_fields_are_the_seven_agreed_names_and_types():
    assert FIELDS == (("doc_type", "string"), ("university", "string"), ("major", "string_list"),
                      ("entry_level", "string_list"), ("province", "string_list"),
                      ("enterprise", "string_list"), ("internship_support", "string_list"))
    assert LIST_FIELDS == {"major", "entry_level", "province", "enterprise", "internship_support"}
    assert CSV_COLUMNS == ("document_id", "title", "body", "source_url", "doc_type", "university", "major",
                           "entry_level", "province", "enterprise", "internship_support")


def test_slug_removes_accents_and_the_d_stroke():
    assert slug("Đại học Mở TP.HCM") == "dai-hoc-mo-tp-hcm"


def test_write_csv_joins_lists_with_semicolon_and_keeps_a_multiline_body(tmp_path):
    body = '# T\n\nline, with comma and "quote"'
    write_csv(tmp_path / "x.csv", [row(body=body, university="MTU", major=["A", "B"], entry_level=["THPT"])])
    [read_back] = read(tmp_path / "x.csv")
    assert tuple(read_back) == CSV_COLUMNS
    assert read_back["major"] == "A;B" and read_back["entry_level"] == "THPT" and read_back["province"] == ""
    assert read_back["body"] == body and read_back["university"] == "MTU"


def test_write_csv_rejects_a_semicolon_inside_a_list_item(tmp_path):
    with pytest.raises(ValueError, match="major"):
        write_csv(tmp_path / "x.csv", [row(major=["Kế toán; kiểm toán"])])


def test_write_csv_rejects_unknown_doc_type_and_unknown_column(tmp_path):
    with pytest.raises(ValueError, match="doc_type"):
        write_csv(tmp_path / "x.csv", [row(doc_type="blog")])
    with pytest.raises(ValueError, match="surprise"):
        write_csv(tmp_path / "x.csv", [row(surprise="x")])


def program(major, level):
    return {"ten_nganh": major, "doi_tuong_dau_vao": level, **{field: "" for field in xlsx.FIELD_LABELS},
            "hoc_phi": "500.000đ/tín chỉ"}


SCHOOL = {"ten_truong": "Đại học Minh Họa", "ten_viet_tat": "MTU"}
MAJORS = {"Công nghệ thông tin": [program("Công nghệ thông tin", "THPT"), program("Công nghệ thông tin", "Cao đẳng")],
          "Kế toán": [program("Kế toán", "THPT")]}


def test_school_metadata_lists_majors_and_levels_in_source_order():
    assert xlsx.school_metadata(SCHOOL, MAJORS) == {
        "doc_type": "tuyen_sinh", "university": "MTU",
        "major": ["Công nghệ thông tin", "Kế toán"], "entry_level": ["THPT", "Cao đẳng"]}


def test_school_row_carries_the_markdown_as_body_and_a_stable_document_id():
    result = xlsx.school_row(SCHOOL, MAJORS, [])
    assert result["document_id"] == "tuyen-sinh-mtu"
    assert result["title"] == "Đại học Minh Họa (MTU) — Thông tin tuyển sinh"
    assert result["body"] == xlsx.school_doc(SCHOOL, MAJORS, []).strip()
    assert result["source_url"] == "" and result["university"] == "MTU"


def test_main_writes_unchanged_markdown_plus_a_csv(tmp_path):
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    schools = workbook.active
    schools.title = "TRUONG"
    schools.append(["ten_truong", "ten_viet_tat"])
    schools.append([SCHOOL["ten_truong"], SCHOOL["ten_viet_tat"]])
    stations = workbook.create_sheet("TRAM_THI")
    stations.append(["ten_tram", "don_vi", "dia_chi", "tinh_thanh"])
    master = workbook.create_sheet("MASTER_TU_VAN")
    columns = ["university_id", "ten_nganh", "doi_tuong_dau_vao", *xlsx.FIELD_LABELS]
    master.append(columns)
    for group in MAJORS.values():
        for item in group:
            master.append(["MTU", item["ten_nganh"], item["doi_tuong_dau_vao"],
                           *[item[field] for field in xlsx.FIELD_LABELS]])
    source = tmp_path / "data.xlsx"
    workbook.save(source)
    target = tmp_path / "out"

    assert xlsx.main(str(source), str(target)) == 0

    assert (target / "tuyen-sinh-mtu.md").read_text(encoding="utf-8") == xlsx.school_doc(SCHOOL, MAJORS, [])
    [imported] = read(target / "import.csv")
    assert imported["document_id"] == "tuyen-sinh-mtu" and imported["major"] == "Công nghệ thông tin;Kế toán"
    assert imported["entry_level"] == "THPT;Cao đẳng" and imported["doc_type"] == "tuyen_sinh"


def test_real_workbook_still_produces_the_same_markdown(tmp_path):
    pytest.importorskip("openpyxl")
    source = REPO / "docs/operations/Data_TUYENSINH_v2.xlsx"
    existing = REPO / "docs/operations/kb-tuyensinh"
    if not source.exists() or not existing.exists():
        pytest.skip("local operations data is not present")
    assert xlsx.main(str(source), str(tmp_path)) == 0
    for expected in sorted(existing.glob("*.md")):
        assert filecmp.cmp(expected, tmp_path / expected.name, shallow=False), expected.name
    assert len(read(tmp_path / "import.csv")) == len(list(existing.glob("*.md")))


HCM_MD = """# Doanh nghiệp liên kết của IHRD tại TP. Hồ Chí Minh

Giới thiệu chung.

## Mẫu A (TP. Hồ Chí Minh)

Mẫu A là doanh nghiệp mẫu.

- **Lĩnh vực thực chiến:** Tài chính.
- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên doanh tài chính, chứng khoán: hoàn phí, lương thực tập sinh, cam kết việc làm.
  - Kinh doanh quốc tế: lương thực tập sinh, cam kết việc làm.

## Mẫu B (TP. Hồ Chí Minh)

Mẫu B là doanh nghiệp mẫu.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên doanh công nghệ: hoàn phí, lương thực tập sinh, cam kết việc làm.
  - Chuyên ngành Trí tuệ nhân tạo: lương thực tập sinh, cam kết việc làm.
"""

DONG_THAP_MD = """# Doanh nghiệp liên kết của IHRD tại Đồng Tháp

## Mẫu C (Đồng Tháp)

Mẫu C là doanh nghiệp mẫu.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên doanh tài chính, chứng khoán: hoàn phí, lương thực tập sinh, cam kết việc làm.

## Mẫu B (Đồng Tháp)

Chi nhánh tại Đồng Tháp.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên ngành phần mềm (Web, App): lương thực tập sinh, cam kết việc làm.
"""

TOAN_QUOC_MD = """# Doanh nghiệp liên kết của IHRD trên phạm vi toàn quốc

## Mẫu D (phạm vi toàn quốc)

Mẫu D là doanh nghiệp mẫu.

- **Lĩnh vực thực chiến:** Logistics.
- **Ngành học liên kết:** chưa gắn ngành cụ thể; phù hợp các ngành thuộc lĩnh vực nêu trên.
"""

BENEFITS_MD = "# Quyền lợi học viên theo ngành — Chương trình doanh nghiệp liên kết IHRD\n\n- Chuyên doanh công nghệ\n"

FILES = {"doanh-nghiep-lien-ket-hcm.md": HCM_MD, "doanh-nghiep-lien-ket-dong-thap.md": DONG_THAP_MD,
         "doanh-nghiep-lien-ket-toan-quoc.md": TOAN_QUOC_MD, "quyen-loi-theo-nganh.md": BENEFITS_MD}


def by_id(rows):
    return {item["document_id"]: item for item in rows}


def test_enterprise_rows_split_files_into_one_row_per_company():
    rows = by_id(enterprise.enterprise_rows(FILES))
    assert set(rows) == {"doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c",
                         "doanh-nghiep-mau-d", "quyen-loi-theo-nganh"}
    mau_a = rows["doanh-nghiep-mau-a"]
    assert mau_a["doc_type"] == "doanh_nghiep" and mau_a["enterprise"] == ["Mẫu A"]
    assert mau_a["province"] == ["TP. Hồ Chí Minh"]
    assert mau_a["major"] == ["Chuyên doanh tài chính, chứng khoán", "Kinh doanh quốc tế"]
    assert mau_a["internship_support"] == ["hoan_phi", "luong_thuc_tap", "cam_ket_viec_lam"]
    assert mau_a["title"] == "Mẫu A — doanh nghiệp liên kết IHRD"
    assert mau_a["body"].startswith("# Mẫu A (TP. Hồ Chí Minh)\n\nMẫu A là doanh nghiệp mẫu.")
    assert "Chuyên doanh tài chính, chứng khoán: hoàn phí" in mau_a["body"]


def test_support_values_come_from_the_benefit_lines_only():
    rows = by_id(enterprise.enterprise_rows(FILES))
    assert rows["doanh-nghiep-mau-c"]["internship_support"] == ["hoan_phi", "luong_thuc_tap", "cam_ket_viec_lam"]
    only_internship = {"doanh-nghiep-lien-ket-hcm.md": HCM_MD.replace("hoàn phí, ", "")}
    assert by_id(enterprise.enterprise_rows(only_internship))["doanh-nghiep-mau-b"]["internship_support"] \
        == ["luong_thuc_tap", "cam_ket_viec_lam"]


def test_a_company_in_two_files_becomes_one_document_with_both_provinces_and_majors():
    mau_b = by_id(enterprise.enterprise_rows(FILES))["doanh-nghiep-mau-b"]
    assert mau_b["province"] == ["TP. Hồ Chí Minh", "Đồng Tháp"]
    assert mau_b["major"] == ["Chuyên doanh công nghệ", "Chuyên ngành Trí tuệ nhân tạo",
                            "Chuyên ngành phần mềm (Web, App)"]
    assert mau_b["internship_support"] == ["hoan_phi", "luong_thuc_tap", "cam_ket_viec_lam"]
    assert "Mẫu B là doanh nghiệp mẫu." in mau_b["body"] and "Chi nhánh tại Đồng Tháp." in mau_b["body"]


def test_company_without_linked_majors_has_no_major_or_support():
    mau_d = by_id(enterprise.enterprise_rows(FILES))["doanh-nghiep-mau-d"]
    assert mau_d["province"] == ["Toàn quốc"] and mau_d["major"] == [] and mau_d["internship_support"] == []


def test_benefits_overview_becomes_a_document_without_list_metadata():
    row_ = by_id(enterprise.enterprise_rows(FILES))["quyen-loi-theo-nganh"]
    assert row_["doc_type"] == "quyen_loi_nganh" and row_["title"].startswith("Quyền lợi học viên theo ngành")
    assert not row_.get("major") and not row_.get("province") and not row_.get("enterprise")


def test_unknown_file_suffix_is_an_error():
    with pytest.raises(ValueError, match="doanh-nghiep-lien-ket-moi.md"):
        enterprise.enterprise_rows({"doanh-nghiep-lien-ket-moi.md": HCM_MD})


def test_enterprise_main_writes_a_csv_beside_the_markdown(tmp_path):
    for name, text in FILES.items():
        (tmp_path / name).write_text(text, encoding="utf-8")
    assert enterprise.main(str(tmp_path)) == 0
    imported = {item["document_id"]: item for item in read(tmp_path / "import.csv")}
    assert imported["doanh-nghiep-mau-b"]["province"] == "TP. Hồ Chí Minh;Đồng Tháp"
    assert imported["doanh-nghiep-mau-d"]["major"] == ""


def test_real_enterprise_markdown_parses_into_valid_rows():
    directory = REPO / "docs/operations/kb-doanh-nghiep-lien-ket"
    if not directory.exists():
        pytest.skip("local operations data is not present")
    files = {path.name: path.read_text(encoding="utf-8") for path in directory.glob("*.md")}
    rows = enterprise.enterprise_rows(files)
    companies = [item for item in rows if item["doc_type"] == "doanh_nghiep"]
    assert companies and all(item["province"] and item["enterprise"] for item in companies)
    assert len({item["document_id"] for item in rows}) == len(rows)


def test_heading_area_with_a_nested_parenthesis_is_not_part_of_the_company_name():
    text = "## Thuận Phát (khu vực Đồng bằng sông Cửu Long (ĐBSCL))\n\nMô tả.\n"
    rows = enterprise.enterprise_rows({"doanh-nghiep-lien-ket-dbscl.md": text})
    assert rows[0]["enterprise"] == ["Thuận Phát"] and rows[0]["document_id"] == "doanh-nghiep-thuan-phat"
    assert rows[0]["province"] == ["Khu vực ĐBSCL"]


from sample_rows import FIXTURE, build_sample_rows  # noqa: E402


def test_sample_fixture_is_what_the_generators_produce(tmp_path):
    write_csv(tmp_path / "now.csv", build_sample_rows())
    assert (tmp_path / "now.csv").read_text(encoding="utf-8") == FIXTURE.read_text(encoding="utf-8"), \
        "run: python3 scripts/tests/sample_rows.py --write"


def test_sample_covers_every_document_type_and_field():
    rows = build_sample_rows()
    assert [item["document_id"] for item in rows] == [
        "doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c",
        "doanh-nghiep-mau-d", "quyen-loi-theo-nganh", "tuyen-sinh-mtu", "tuyen-sinh-ptit"]
    assert {name for item in rows for name, _ in FIELDS if item.get(name)} == {name for name, _ in FIELDS}
