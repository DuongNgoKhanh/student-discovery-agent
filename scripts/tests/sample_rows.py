"""Builds the small sample CSV (contracts/fixtures/knowledge-import-sample.csv) through the real generators.

Run `python3 scripts/tests/sample_rows.py --write` to regenerate the fixture after changing a generator.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import enterprise_kb_to_csv as enterprise  # noqa: E402
import xlsx_to_kb_md as xlsx  # noqa: E402
from kb_metadata import write_csv  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[2] / "contracts/fixtures/knowledge-import-sample.csv"

HCM = """# Doanh nghiệp liên kết của IHRD tại TP. Hồ Chí Minh

## Mẫu A (TP. Hồ Chí Minh)

Mẫu A là doanh nghiệp mẫu.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên doanh tài chính, chứng khoán: hoàn phí, lương thực tập sinh, cam kết việc làm.
  - Kinh doanh quốc tế: lương thực tập sinh, cam kết việc làm.

## Mẫu B (TP. Hồ Chí Minh)

Mẫu B là doanh nghiệp mẫu.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên doanh công nghệ: hoàn phí, lương thực tập sinh, cam kết việc làm.
  - Chuyên ngành Trí tuệ nhân tạo: lương thực tập sinh, cam kết việc làm.
"""
DONG_THAP = """# Doanh nghiệp liên kết của IHRD tại Đồng Tháp

## Mẫu C (Đồng Tháp)

Mẫu C là doanh nghiệp mẫu.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên doanh tài chính, chứng khoán: hoàn phí, lương thực tập sinh, cam kết việc làm.

## Mẫu B (Đồng Tháp)

Chi nhánh tại Đồng Tháp.

- **Ngành học liên kết và quyền lợi của học viên:**
  - Chuyên ngành phần mềm (Web, App): lương thực tập sinh, cam kết việc làm.
"""
TOAN_QUOC = """# Doanh nghiệp liên kết của IHRD trên phạm vi toàn quốc

## Mẫu D (phạm vi toàn quốc)

Mẫu D là doanh nghiệp mẫu.

- **Ngành học liên kết:** chưa gắn ngành cụ thể; phù hợp các ngành thuộc lĩnh vực nêu trên.
"""
BENEFITS = "# Quyền lợi học viên theo ngành — Chương trình doanh nghiệp liên kết IHRD\n\n- Chuyên doanh công nghệ\n"


def _program(major: str, level: str) -> dict:
    return {"ten_nganh": major, "doi_tuong_dau_vao": level, **{field: "" for field in xlsx.FIELD_LABELS},
            "hoc_phi": "500.000đ/tín chỉ"}


def build_sample_rows() -> list[dict]:
    enterprise_rows = enterprise.enterprise_rows({
        "doanh-nghiep-lien-ket-hcm.md": HCM, "doanh-nghiep-lien-ket-dong-thap.md": DONG_THAP,
        "doanh-nghiep-lien-ket-toan-quoc.md": TOAN_QUOC, "quyen-loi-theo-nganh.md": BENEFITS})
    mtu = {"Công nghệ thông tin": [_program("Công nghệ thông tin", "THPT"), _program("Công nghệ thông tin", "Cao đẳng")],
           "Kế toán": [_program("Kế toán", "THPT")]}
    ptit = {"Công nghệ thông tin": [_program("Công nghệ thông tin", "THPT")]}
    schools = [xlsx.school_row({"ten_truong": "Đại học Minh Họa", "ten_viet_tat": "MTU"}, mtu, []),
               xlsx.school_row({"ten_truong": "Học viện Mẫu", "ten_viet_tat": "PTIT"}, ptit, [])]
    order = ["doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c",
             "doanh-nghiep-mau-d", "quyen-loi-theo-nganh"]
    by_id = {row["document_id"]: row for row in enterprise_rows}
    return [by_id[document_id] for document_id in order] + schools


if __name__ == "__main__":
    if "--write" in sys.argv:
        write_csv(FIXTURE, build_sample_rows())
        print(f"wrote {FIXTURE}")
    else:
        with tempfile.TemporaryDirectory() as folder:
            write_csv(Path(folder) / "x.csv", build_sample_rows())
        print("sample rows build and serialise")
