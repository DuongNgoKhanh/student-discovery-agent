"""The metadata the import scripts write filters the way knowledge.search needs (DEC-27), on a real Postgres."""
import csv
import sys
from pathlib import Path

import pytest

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork
from agent_runtime.knowledge.embedding import by_model
from agent_runtime.knowledge.retrieval import PgKnowledge
from agent_runtime.knowledge.schemas import RetrievalRequest
from tests.helpers.knowledge import knowledge_rig, role_engine

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from kb_metadata import FIELDS, LIST_FIELDS  # noqa: E402

pytestmark = pytest.mark.integration
SAMPLE = ROOT / "contracts/fixtures/knowledge-import-sample.csv"
SETTING = {"top_k": 20, "score_threshold": 0, "semantic_weight": 0.7, "max_chunks_per_doc": 1}  # top_k counts chunks


def imported_metadata(row):
    """What the Studio CSV import stores: lists split on ';', empty cells dropped."""
    values = {}
    for name, _ in FIELDS:
        cell = row[name].strip()
        if not cell:
            continue
        values[name] = [item.strip() for item in cell.split(";") if item.strip()] if name in LIST_FIELDS else cell
    return values


@pytest.fixture
def rig(test_database):
    rig = knowledge_rig(test_database)
    rig.writer.create_knowledge_base("kb_ihrd", "IHRD tư vấn", rig.embedding.model)
    for name, kind in FIELDS:
        rig.writer.put_field("kb_ihrd", name, kind, filterable=True)
    with SAMPLE.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            rig.writer.put_document("kb_ihrd", row["document_id"], title=row["title"], body=row["body"],
                                    metadata=imported_metadata(row))
    rig.indexer.run_once()
    runtime = role_engine(test_database.url, test_database.runtime_role)
    rig.knowledge = PgKnowledge(RuntimeUnitOfWork(runtime), by_model(rig.embedding))
    yield rig
    runtime.dispose()
    rig.dispose()


def ids(rig, conditions, query="doanh nghiệp liên kết ngành học", logical_operator="and"):
    result = rig.knowledge.retrieve(RetrievalRequest.model_validate({
        "knowledge_id": "kb_ihrd", "query": query, "retrieval_setting": SETTING,
        "metadata_condition": {"logical_operator": logical_operator, "conditions": conditions}}))
    return {record.metadata["document_id"] for record in result.records}


def contains(name, value):
    return {"name": name, "comparison_operator": "contains", "value": value}


def is_(name, value):
    return {"name": name, "comparison_operator": "is", "value": value}


def test_major_and_province_narrow_enterprises(rig):
    finance = "Chuyên doanh tài chính, chứng khoán"
    assert ids(rig, [contains("major", finance)]) == {"doanh-nghiep-mau-a", "doanh-nghiep-mau-c"}
    assert ids(rig, [contains("major", finance), contains("province", "Đồng Tháp")]) == {"doanh-nghiep-mau-c"}
    assert ids(rig, [contains("province", "Đồng Tháp")]) == {"doanh-nghiep-mau-c", "doanh-nghiep-mau-b"}


def test_a_company_in_two_provinces_matches_either(rig):
    assert ids(rig, [contains("province", "TP. Hồ Chí Minh")]) == {"doanh-nghiep-mau-a", "doanh-nghiep-mau-b"}
    assert ids(rig, [contains("province", "Đồng Tháp")]) == {"doanh-nghiep-mau-c", "doanh-nghiep-mau-b"}
    assert ids(rig, [contains("major", "Chuyên ngành Trí tuệ nhân tạo")]) == {"doanh-nghiep-mau-b"}


def test_internship_support_filters_by_benefit(rig):
    assert ids(rig, [contains("internship_support", "hoan_phi")]) == {
        "doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c"}
    assert ids(rig, [contains("internship_support", "cam_ket_viec_lam")]) == {
        "doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c"}


def test_and_requires_every_condition_and_or_any_of_them(rig):
    province_pair = [contains("province", "Toàn quốc"), contains("province", "Đồng Tháp")]
    assert ids(rig, province_pair, logical_operator="or") == {
        "doanh-nghiep-mau-d", "doanh-nghiep-mau-c", "doanh-nghiep-mau-b"}
    assert ids(rig, province_pair, logical_operator="and") == set()
    support_or_national = [contains("internship_support", "hoan_phi"), contains("province", "Toàn quốc")]
    assert ids(rig, support_or_national, logical_operator="or") == {
        "doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c",
        "doanh-nghiep-mau-d"}
    assert ids(rig, support_or_national, logical_operator="and") == set()


def test_company_without_majors_is_found_by_province_but_not_by_major(rig):
    assert ids(rig, [contains("province", "Toàn quốc")]) == {"doanh-nghiep-mau-d"}
    assert ids(rig, [{"name": "major", "comparison_operator": "not empty"}]) == {
        "doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c",
        "tuyen-sinh-mtu", "tuyen-sinh-ptit"}


def test_school_documents_filter_by_university_level_and_major(rig):
    assert ids(rig, [is_("university", "MTU")]) == {"tuyen-sinh-mtu"}
    assert ids(rig, [is_("doc_type", "tuyen_sinh"), contains("major", "Công nghệ thông tin")]) == {
        "tuyen-sinh-mtu", "tuyen-sinh-ptit"}
    assert ids(rig, [contains("entry_level", "Cao đẳng")]) == {"tuyen-sinh-mtu"}


def test_doc_type_separates_the_three_kinds(rig):
    assert ids(rig, [is_("doc_type", "doanh_nghiep")]) == {
        "doanh-nghiep-mau-a", "doanh-nghiep-mau-b", "doanh-nghiep-mau-c",
        "doanh-nghiep-mau-d"}
    assert ids(rig, [is_("doc_type", "quyen_loi_nganh")]) == {"quyen-loi-theo-nganh"}
