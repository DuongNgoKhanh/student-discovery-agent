from agent_runtime.knowledge.chunking import Section, chunk_document, split_sections

BODY = """Giới thiệu chung.

# Ngành CNTT
Học lập trình.

## Học phí
Khoảng 25 triệu/năm.

```bash
# không phải heading
```

# Ngành Kinh tế
## Học phí

# Liên hệ
Email tuyển sinh.
"""


def test_sections_carry_their_heading_path_and_skip_empty_ones():
    assert split_sections(BODY) == [
        Section("", "Giới thiệu chung."),
        Section("Ngành CNTT", "Học lập trình."),
        Section("Ngành CNTT > Học phí", "Khoảng 25 triệu/năm.\n\n```bash\n# không phải heading\n```"),
        Section("Liên hệ", "Email tuyển sinh."),
    ]


def test_long_sections_are_split_under_the_size_limit():
    body = "# Dài\n" + "Câu này nói về học phí và học bổng. " * 100
    drafts = chunk_document("T", body, chunk_size=300)
    assert len(drafts) > 1
    assert all(len(draft.text) <= 300 and draft.heading_path == "Dài" for draft in drafts)
    assert [draft.ordinal for draft in drafts] == list(range(len(drafts)))


def test_hashes_are_stable_and_change_only_where_content_changes():
    first = chunk_document("T", BODY)
    assert [draft.chunk_hash for draft in first] == [draft.chunk_hash for draft in chunk_document("T", BODY)]
    edited = chunk_document("T", BODY.replace("Email tuyển sinh.", "Hotline tuyển sinh."))
    changed = [a.chunk_hash != b.chunk_hash for a, b in zip(first, edited, strict=True)]
    assert changed == [False, False, False, True]
    assert not {draft.chunk_hash for draft in first} & {draft.chunk_hash for draft in chunk_document("T2", BODY)}


def test_empty_body_has_no_chunks():
    assert chunk_document("T", "  \n# Chỉ heading\n") == []


def test_heading_keeps_a_trailing_hash_that_belongs_to_the_title():
    sections = split_sections("# Lập trình C#\nNội dung.\n\n## Đóng ##\nKhác.")
    assert [section.heading_path for section in sections] == ["Lập trình C#", "Lập trình C# > Đóng"]
