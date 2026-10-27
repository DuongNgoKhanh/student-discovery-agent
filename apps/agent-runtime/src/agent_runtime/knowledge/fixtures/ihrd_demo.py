"""Fictional partner schools for local demos; every name is invented and marked as an illustration."""
from typing import Any

from agent_runtime.knowledge.authoring import KnowledgeWriter

IHRD_DEMO: dict[str, Any] = {
    "knowledge_base": {"id": "kb_ihrd_demo", "name": "IHRD tuyển sinh (demo)",
                       "description": "Dữ liệu minh họa, chưa thẩm định.", "embedding_model": "gemini-embedding-2"},
    "fields": [
        {"name": "kind", "type": "string", "filterable": True, "label": "Loại"},
        {"name": "province", "type": "string", "filterable": True, "label": "Tỉnh/thành"},
        {"name": "major", "type": "string", "filterable": True, "label": "Ngành"},
        {"name": "houses", "type": "string_list", "filterable": True, "label": "Hệ phù hợp"},
        {"name": "tuition_text", "type": "string", "label": "Học phí"},
        {"name": "admission_note", "type": "string", "label": "Ghi chú tuyển sinh"},
    ],
    "documents": [
        {"id": "demo_school_a_it", "title": "Trường Minh Họa A — Công nghệ thông tin (minh họa)",
         "source_url": "https://ihrd.vn/demo/truong-a",
         "body": "# Giới thiệu\nChương trình minh họa về lập trình, dữ liệu và an toàn thông tin.\n\n"
                 "# Học phí\nKhoảng 25–30 triệu đồng/năm (số liệu minh họa).",
         "metadata": {"kind": "school_program", "province": "Hà Nội", "major": "Công nghệ thông tin",
                      "houses": ["house_i", "house_r"], "tuition_text": "25–30 triệu/năm (minh họa)",
                      "admission_note": "Xét học bạ và điểm thi (minh họa)"}},
        {"id": "demo_school_b_social", "title": "Trường Minh Họa B — Công tác xã hội (minh họa)",
         "source_url": "https://ihrd.vn/demo/truong-b",
         "body": "# Giới thiệu\nNgành công tác xã hội đào tạo kỹ năng hỗ trợ cộng đồng và tư vấn tâm lý.\n\n"
                 "# Học phí\nKhoảng 15 triệu đồng/năm (số liệu minh họa).",
         "metadata": {"kind": "school_program", "province": "Đà Nẵng", "major": "Công tác xã hội",
                      "houses": ["house_s"], "tuition_text": "15 triệu/năm (minh họa)",
                      "admission_note": "Có phỏng vấn (minh họa)"}},
        {"id": "demo_school_c_business", "title": "Trường Minh Họa C — Quản trị kinh doanh (minh họa)",
         "source_url": "https://ihrd.vn/demo/truong-c",
         "body": "# Giới thiệu\nChương trình minh họa về khởi nghiệp, bán hàng và quản lý.\n\n"
                 "# Học phí\nKhoảng 35 triệu đồng/năm (số liệu minh họa).",
         "metadata": {"kind": "school_program", "province": "TP. Hồ Chí Minh", "major": "Quản trị kinh doanh",
                      "houses": ["house_e", "house_c"], "tuition_text": "35 triệu/năm (minh họa)"}},
        {"id": "demo_article_choose_major", "title": "Chọn ngành theo nhóm tính cách (minh họa)",
         "body": "# Hệ S\nNgười thuộc Hệ S thường hợp các ngành giáo dục, y tế, công tác xã hội.\n\n"
                 "# Hệ I\nNgười thuộc Hệ I thường hợp các ngành nghiên cứu, công nghệ, khoa học dữ liệu.",
         "metadata": {"kind": "article", "houses": ["house_s", "house_i"]}},
    ],
}


def load_dataset(writer: KnowledgeWriter, dataset: dict[str, Any], *, embedding_model: str | None = None) -> int:
    kb = dataset["knowledge_base"]
    writer.create_knowledge_base(kb["id"], kb["name"], embedding_model or kb["embedding_model"],
                                 kb.get("description", ""))
    for ordinal, field in enumerate(dataset["fields"]):
        writer.put_field(kb["id"], field["name"], field["type"], filterable=field.get("filterable", False),
                         label=field.get("label", ""), ordinal=ordinal)
    created = 0
    for document in dataset["documents"]:
        result = writer.put_document(kb["id"], document["id"], title=document["title"], body=document["body"],
                                     metadata=document.get("metadata"), source_url=document.get("source_url"))
        created += result.created
    return created
