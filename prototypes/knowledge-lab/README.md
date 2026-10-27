# Knowledge Lab

Prototype local để thử lõi knowledge (giai đoạn 1): nạp và sửa document, chạy indexer, tìm kiếm qua endpoint thật của runtime. Không phải UI sản phẩm. Thư mục này nằm ngoài `apps/` và ngoài CI.

```
trình duyệt ──> lab.py :8788 ──┬─ /rt/knowledge/retrieval ──(ký X-Caller-Context như Product BFF)──> agent-runtime :18101
                                └─ /lab/* (gọi thẳng code Python của runtime) ──────────────────────> Postgres pgvector :15434
```

## Chạy

```bash
# Tuỳ chọn: key Gemini để dùng gemini-embedding-2 thật. start.sh lấy theo thứ tự:
# biến môi trường, rồi GOOGLE_API_KEY trong .local-docker/.env (kể cả của checkout chính khi chạy từ worktree)
export GOOGLE_API_KEY=...

bash prototypes/knowledge-lab/start.sh        # mở http://127.0.0.1:8788, Ctrl+C để dừng
bash prototypes/knowledge-lab/start.sh reset  # xoá container DB (mất mọi document)
```

Lần chạy đầu, script tạo `.env.local` (git-ignore) chứa mật khẩu DB, mật khẩu hai role và keyring. Sau đó nó:
- chạy container `sda-knowledge-lab-db` (`pgvector/pgvector:pg16`) và migrate;
- tạo hai login role `kb_runtime` (chỉ đọc) và `kb_indexer`, cấp quyền bằng đúng `grant_knowledge_roles` của runtime;
- bật runtime với role `kb_runtime`, rồi bật `lab.py`.

Indexer trong lab chạy bằng role `kb_indexer`, nên lỗi phân quyền sẽ lộ ra ngay.

## Chế độ embedding

| | Có `GOOGLE_API_KEY` | Không có key |
|---|---|---|
| Lab index bằng | `gemini-embedding-2` | `fake-embedding` (bag of words, chỉ để thử luồng) |
| Endpoint runtime | vector + từ khoá | `degraded: true`, chỉ tìm theo từ khoá (runtime không có key để embed câu hỏi) |
| Đường "in-process" | như endpoint | vector giả + từ khoá |

Knowledge base demo được tạo theo model của lab. Nếu đổi giữa có key và không có key, chạy `start.sh reset` rồi nạp demo lại.

## Kịch bản nên thử

1. **Nạp demo**, rồi **Chạy indexer**. Mọi document chuyển sang `ready`, active r1.
2. Tìm "hoc phi" (không dấu) và "học phí công nghệ thông tin".
3. Lọc `houses contains house_s`, rồi thử `province is Đà Nẵng`.
4. Sửa một document và lưu: latest r2 ở trạng thái `pending`, tìm kiếm vẫn trả nội dung r1. Chạy indexer: chuyển sang r2.
5. Archive một document: biến mất khỏi kết quả ngay, không cần chạy indexer.
6. Lỗi có kiểu: điều kiện lọc trên field `khong_ton_tai` trả 422 `VAL_INVALID_INPUT`, `knowledge_id` sai trả 404 `RES_NOT_FOUND`.
7. Bảng log bên phải ghi mọi request và response, gồm envelope lỗi của runtime.

Lab ký request cho bất kỳ ai và ghi nội dung bằng quyền owner, chỉ bind `127.0.0.1`. Đừng mở nó ra mạng.
