# Agent Chat Lab

Prototype local để chat với agent runtime và đánh giá từng lượt trả lời. Không phải UI sản phẩm. Thư mục này nằm ngoài `apps/` và ngoài CI.

```
trình duyệt ──> proxy.py :8787 ──(ký X-Caller-Context như Product BFF)──> agent-runtime :18100 ──> Postgres+pgvector :15433
                   └─ phục vụ index.html                                        └─ đọc release từ ./releases
```

## Chạy

```bash
# Key model (chọn một). Không có key thì agent trả template fallback, vẫn xem được luồng commit.
echo 'GOOGLE_API_KEY=...' >> apps/agent-runtime/.env

bash prototypes/agent-chat/start.sh       # mở http://127.0.0.1:8787, Ctrl+C để dừng
bash prototypes/agent-chat/start.sh reset # xóa container DB (mất mọi hội thoại)
```

Sau khi pull bản có bảng `execution.responses`, chạy `start.sh reset` một lần: migration được sửa tại chỗ nên DB cũ không tự nâng cấp (script sẽ nhắc nếu gặp DB cũ). Bản có knowledge cần image pgvector: chạy `start.sh reset` một lần.

Lần chạy đầu, script tạo `.env.local` (mode 600, git-ignore) chứa mật khẩu DB, keyring JWT và key ký cursor. Sau đó nó chạy container `sda-agent-chat-db` (Postgres 16 + pgvector), migrate, rồi bật runtime từ `apps/agent-runtime/.venv` với `RUNTIME_LOCAL_RELEASES_DIR=./releases`.

## Release

- `releases/agent.json`: nội dung `agent.snapshot.v1`, ban đầu chép từ `contracts/fixtures/agent-snapshot-demo.json`. Model mặc định là `gemini/gemini-3.5-flash-lite`.
- `agent.json` bind `knowledge.search` (KB `kb_ihrd_demo`, lọc được theo `houses`, `province`, `major`) và `knowledge.show`. `start.sh` nạp KB demo (trường hư cấu) và index một lần; có `GOOGLE_API_KEY` thì dùng `gemini-embedding-2`, không có thì fake embedding (chỉ tìm theo từ khoá).
- `releases/experiences/exp_riasec.json`: bài RIASEC 2.0 tiếng Việt, 30 câu, đã qua `ExperienceValidator`.

Runtime đọc lại file ở mỗi lần tạo hội thoại hoặc bắt đầu bài. Nếu sửa prompt hay template, chỉ hội thoại mới thấy thay đổi, vì hội thoại cũ vẫn giữ bản đã ghim.

## Trên UI

- **Chat tự do**: `POST /conversations/{id}/messages` với `content: [{type: "text"}]`. Mặc định gửi kèm `Accept: text/event-stream`: chữ của agent hiện dần (dạng chữ thuần), có nút **Hủy** (`POST /responses/{id}/cancel`), và khi nhận event cuối thì thay bằng block đã làm sạch. Tắt "stream (SSE)" ở bảng trái để nhận JSON một lần. Agent loop chạy qua 4 handoff, server tự render block cho từng cái: `assessment.start` hiện câu hỏi tên, `set_name` hiện câu hỏi đầu tiên, `propose_answer` hiện lời xác nhận kèm câu hỏi, `current_question` hiện lại câu hiện tại.
- **Câu hỏi tuyển sinh**: agent gọi `knowledge.search` rồi `knowledge.show`; server hiện block `knowledge_card` (tiêu đề, bảng thông tin, link nguồn) sau lời dẫn. Tắt "knowledge_card v1" ở bảng trái để xem thẻ hạ cấp về markdown.
- **Bấm đáp án**: cũng là `POST /messages`, với `content: [{type: "interaction", action: "submit_answer", ...}]`, gửi JSON vì không gọi LLM.
- **Response gọn**: mỗi lượt trả `TurnResponse` (`status`, `output.blocks`, `activity` dạng tóm tắt, không có `answers[]`). Khi activity đổi, UI đọc thêm `GET /conversations/{id}` để có lịch sử đáp án. Lượt `failed` hiện mã lỗi; `409 CONFLICT_TURN_IN_PROGRESS` thì UI tự chờ lượt kia qua `GET /responses/{id}`. Đứt stream giữa chừng thì UI cũng lấy kết quả qua `GET /responses/{id}`.
- **Bảng phải**: activity hiện tại, JSON của turn gần nhất, log mọi request (status, độ trễ, body), và tab đánh giá. Tab đánh giá cho chấm 👍/👎, ghi chú từng câu trả lời và xuất transcript ra JSON.
- **Bảng trái**: đổi owner (học sinh mới), tắt markdown/suggestions để xem server hạ cấp block, kết thúc hội thoại, tải lại lịch sử qua API messages, và các câu mẫu để thử nhanh.

## Thử với dữ liệu thật (`docs/operations/kb-tuyensinh`)

Chạy knowledge-lab trỏ vào DB của agent-chat (đang chạy `start.sh`) để tạo KB và tải các file `.md`:

```bash
cd apps/agent-runtime
source <(sed -E 's/^([A-Z_]+)=(.*)$/\1='"'"'\2'"'"'/' ../../prototypes/agent-chat/.env.local)
DB="postgresql+psycopg://postgres:$DB_PASSWORD@127.0.0.1:15433/postgres"
LAB_KEYRING="$KEYRING" LAB_RUNTIME_URL=http://127.0.0.1:18100 LAB_OWNER_DATABASE_URL="$DB" \
  LAB_INDEXER_DATABASE_URL="$DB" LAB_RUNTIME_DATABASE_URL="$DB" .venv/bin/python ../../prototypes/knowledge-lab/lab.py
```

Sau đó sửa `releases/agent.json`: `knowledge_base_id` thành id KB vừa tạo, `auto_filter_fields` và `display` theo field của KB đó. Hội thoại mới mới thấy thay đổi.

## Knowledge Studio

`start.sh` tạo role `kb_studio` (chỉ ghi nội dung knowledge), cho runtime nhận token của Studio (`RUNTIME_STUDIO_KEYRING`) và ghi `studio.env` (mode 600, git-ignore). Indexer chạy nền nên sửa trong Studio được index trong lúc chat. Mở thêm hai terminal:

```bash
# studio-api :3001 (migration Product chạy trên cùng DB của prototype)
set -a; source prototypes/agent-chat/studio.env; set +a
cd apps/studio-api && corepack pnpm db:migrate && corepack pnpm dev

# web-ui :3000, gọi studio-api qua rewrite /api
cd apps/web-ui && corepack pnpm dev
```

Máy không có `pnpm` trên PATH thì dùng `corepack pnpm ...` như trên (có `pnpm` thì gõ thẳng cũng được). Cổng 3000 có thể đang bị stack Docker local đầy đủ chiếm: khi đó chạy `corepack pnpm dev -p 3002` cho web-ui và mở cổng 3002 thay cho 3000.

Đăng nhập <http://localhost:3000/admin/login> bằng `admin` / `STUDIO_ADMIN_PASSWORD` trong `.env.local`, vào **Knowledge**. Không có `GOOGLE_API_KEY` thì tạo KB với model `fake-embedding` (studio.env chỉ cho phép model đó).

Gắn KB vào agent: tab **Dùng cho agent** → Copy → thay `params` của `knowledge.search` và `knowledge.show` trong `releases/agent.json`. Chỉ hội thoại mới thấy thay đổi.

Sau khi pull bản này, chạy `start.sh reset` một lần: migration được sửa tại chỗ (thêm bảng `knowledge.imports` và hàm retry), nên DB cũ không tự nâng cấp (script sẽ nhắc nếu thiếu `knowledge.imports`). `.env.local` cũ vẫn dùng được: các secret mới của Studio chỉ được thêm khi chưa có.

Proxy ký cho bất kỳ owner nào và chỉ bind `127.0.0.1`. Đừng mở nó ra mạng.
