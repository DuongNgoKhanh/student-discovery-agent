# Agent Chat Lab

Prototype local để chat với agent runtime và đánh giá từng lượt trả lời. Không phải UI sản phẩm. Thư mục này nằm ngoài `apps/` và ngoài CI.

```
trình duyệt ──> proxy.py :8787 ──(ký X-Caller-Context như Product BFF)──> agent-runtime :18100 ──> Postgres :15433
                   └─ phục vụ index.html                                        └─ đọc release từ ./releases
```

## Chạy

```bash
# Key model (chọn một). Không có key thì agent trả template fallback, vẫn xem được luồng commit.
echo 'GOOGLE_API_KEY=...' >> apps/agent-runtime/.env

bash prototypes/agent-chat/start.sh       # mở http://127.0.0.1:8787, Ctrl+C để dừng
bash prototypes/agent-chat/start.sh reset # xóa container DB (mất mọi hội thoại)
```

Lần chạy đầu, script tạo `.env.local` (mode 600, git-ignore) chứa mật khẩu DB, keyring JWT và key ký cursor. Sau đó nó chạy container `sda-agent-chat-db` (Postgres 16), migrate, rồi bật runtime từ `apps/agent-runtime/.venv` với `RUNTIME_LOCAL_RELEASES_DIR=./releases`.

## Release

- `releases/agent.json`: nội dung `agent.snapshot.v1`, ban đầu chép từ `contracts/fixtures/agent-snapshot-demo.json`. Model mặc định là `gemini/gemini-3.5-flash-lite`.
- `releases/experiences/exp_riasec.json`: bài RIASEC 2.0 tiếng Việt, 30 câu, đã qua `ExperienceValidator`.

Runtime đọc lại file ở mỗi lần tạo hội thoại hoặc bắt đầu bài. Nếu sửa prompt hay template, chỉ hội thoại mới thấy thay đổi, vì hội thoại cũ vẫn giữ bản đã ghim.

## Trên UI

- **Chat tự do**: gửi một message turn. Agent loop chạy qua 4 handoff, và server tự render block cho từng cái: `assessment.start` hiện câu hỏi tên, `set_name` hiện câu hỏi đầu tiên, `propose_answer` hiện lời xác nhận kèm câu hỏi, `current_question` hiện lại câu hiện tại.
- **Bấm đáp án**: gửi interaction `submit_answer`, đi thẳng vào engine mà không gọi LLM.
- **Bảng phải**: activity hiện tại, JSON của turn gần nhất, log mọi request (status, độ trễ, body), và tab đánh giá. Tab đánh giá cho chấm 👍/👎, ghi chú từng câu trả lời và xuất transcript ra JSON.
- **Bảng trái**: đổi owner (học sinh mới), tắt markdown/suggestions để xem server hạ cấp block, kết thúc hội thoại, tải lại lịch sử qua API messages, và các câu mẫu để thử nhanh.

Proxy ký cho bất kỳ owner nào và chỉ bind `127.0.0.1`. Đừng mở nó ra mạng.
