# Test toàn bộ stack local bằng Docker

Stack `sda-full-local` chạy UI, Studio/Product API, gateway, runtime, PostgreSQL 16 và MinIO. Database/bucket Product của stack này là dữ liệu local riêng, không dùng volume `sda` hoặc database test B-02 đã có. Script cố định project name, kể cả khi shell có `COMPOSE_PROJECT_NAME`. Các lệnh bên dưới chạy từ root repository.

## Khởi động

```bash
bash scripts/local-stack.sh up
```

Lệnh tạo credential riêng trong `.local-docker/.env` (mode 600, Git ignore), build từ Dockerfiles hiện tại, chờ DB, chạy migration Product, tạo bucket MinIO rồi bật các service. Chạy lại giữ credential và dữ liệu đã có; không tự reset DB. Docker Compose cần hỗ trợ `extends` và `!override` (2.24.4 trở lên); build UI/API cần Buildx vì Dockerfiles dùng named context `contracts`.

Nếu máy chưa cài Buildx, cài từ [Docker Buildx chính thức](https://github.com/docker/buildx#installing). Trong phiên setup này, Buildx v0.29.1 đã được tải vào `/tmp/sda-docker-cli/cli-plugins`, kiểm SHA-256 với file checksums của release chính thức. Script có thể dùng bản tạm đó; sau reboot/xóa `/tmp`, cần có Buildx để rebuild. Chạy image đã build không cần Buildx:

```bash
bash scripts/local-stack.sh up --no-build
```

Nếu runtime standalone từ bước trước vẫn đang giữ cổng 18000, dừng đúng project đó trước khi khởi động full stack:

```bash
docker compose -f docker-compose.runtime-local.yaml down
```

Proxy build dùng biến `http_proxy`/`https_proxy` hiện có trong shell. Không đưa credential Product vào UI/runtime.

Nếu sửa `infra/nginx/default.conf` khi gateway đang chạy, bind mount không tự reload nginx. Sau khi `up` thành công, kiểm tra và reload cấu hình:

```bash
docker compose --project-name sda-full-local --env-file .local-docker/.env -f docker-compose.full-local.yaml exec gateway nginx -t
docker compose --project-name sda-full-local --env-file .local-docker/.env -f docker-compose.full-local.yaml exec gateway nginx -s reload
```

Runtime vẫn đọc `apps/agent-runtime/.env` nếu có, gồm cả `RUNTIME_DATABASE_URL` do bạn cấu hình; DB runtime này không được tự tạo hoặc migrate bởi script. Khi chưa cấu hình, runtime chỉ sẵn sàng cho health/docs, chưa chạy toàn luồng conversation/turn.

## Địa chỉ và tài khoản

| Thành phần | URL |
|---|---|
| UI | <http://localhost:3000> |
| Đăng ký / đăng nhập user | <http://localhost:3000/register> / <http://localhost:3000/login> |
| Đăng nhập admin | <http://localhost:3000/admin/login> |
| Product API health | <http://localhost:3000/api/health> |
| Gateway liveness / readiness | <http://localhost:3000/healthz> / <http://localhost:3000/ready> |
| Runtime liveness / readiness / docs | <http://localhost:18000/healthz> / <http://localhost:18000/ready> / <http://localhost:18000/docs> |
| MinIO Console | <http://localhost:19001> |

Username admin là `admin`; password đọc field `SDA_LOCAL_ADMIN_PASSWORD` trong `.local-docker/.env`. User test là `SDA_LOCAL_USER_EMAIL` / `SDA_LOCAL_USER_PASSWORD`; chạy smoke test để tạo tài khoản này. MinIO username `sda-local-minio`, password là `SDA_LOCAL_MINIO_PASSWORD`. Không copy file credential này vào Git hoặc gửi trong log.

API chạy với `NODE_ENV=development` trong **stack local này** để cookie auth dùng được qua HTTP localhost. Image và cấu hình production vẫn giữ chế độ riêng. Thay `SDA_LOCAL_PORT`, `SDA_LOCAL_RUNTIME_PORT`, `SDA_LOCAL_MINIO_PORT` trong file env nếu cổng bị trùng; chạy lại `up --no-build`. `PRODUCT_BASE_URL` tự theo cổng gateway để URL avatar hợp lệ.

## Knowledge Base (Studio)

`up` chạy thêm bước `runtime-provision` (profile `tools`, script [runtime-provision.py](../../scripts/runtime-provision.py)): tạo database `sda_runtime` trong container `db`, tạo role `kb_runtime`/`kb_indexer` (NOLOGIN) và `kb_studio` (Studio đăng nhập bằng role này, chỉ ghi cột nội dung), migrate + grant qua `knowledge_provision`, rồi nạp KB demo `kb_ihrd_demo`. Chạy lại an toàn. Service `knowledge-indexer` chạy nền để embed tài liệu sửa trong Studio.

Khoá ký Studio↔runtime, keyring/cursor key của runtime và password `kb_studio` được tự thêm vào `.local-docker/.env` (chỉ khi còn thiếu). Các biến tuỳ chọn:

| Biến | Ý nghĩa |
|---|---|
| `GOOGLE_API_KEY` | Key embedding Gemini cho runtime/indexer. |
| `VLLM_API_KEY`, `VLLM_BASE_URL` | Endpoint OpenAI-compatible (vLLM/LiteLLM proxy, ví dụ `https://.../v1`): chat model `vllm/<model id>` và embedding `nomic-embed-text-v1.5`, `multilingual-e5-large`. |
| `SDA_LOCAL_KNOWLEDGE_EMBEDDING_MODEL` | Danh sách phân tách bằng dấu phẩy, mặc định `gemini-embedding-2`; admin chọn một model cho mỗi KB khi tạo. Hỗ trợ `gemini-embedding-2`, `nomic-embed-text-v1.5`, `multilingual-e5-large`; đặt `fake-embedding` để chạy offline (search chỉ theo từ khoá). Đổi model trên DB đã seed cần requeue KB. |
| `SDA_LOCAL_PROXY_HOST` / `SDA_LOCAL_PROXY_PORT` | Proxy ra ngoài cho runtime/indexer khi container không có route trực tiếp (ví dụ mạng công ty). |

Tài liệu bị `error` (ví dụ embed khi chưa có proxy) gửi lại hàng đợi bằng:

```bash
docker exec sda-full-local-knowledge-indexer-1 python -m agent_runtime.cli.knowledge_indexer --retry-errors kb_ihrd_demo
```

Revision kẹt ở `indexing` do indexer bị dừng giữa chừng tự được nhận lại sau 600 giây.

## Chat học sinh

`http://localhost:3000/chat` gọi thật qua BFF studio-api (`/api/v1/conversations*`, `/api/v1/responses/{id}`); UI được build với `NEXT_PUBLIC_CHAT_MOCK=false`. Lần tạo hội thoại đầu tiên cấp cookie ẩn danh `sda_owner` (HttpOnly, `Path=/api/v1`); studio-api ký `X-Caller-Context` cho học sinh bằng `SDA_LOCAL_RUNTIME_INTERNAL_KEY` rồi chuyển sang runtime. Agent không còn đọc từ `infra/local-releases/agent.json`: runtime lấy release agent đang active từ studio-api (xem mục "Cấu hình agent"). Bộ đánh giá vẫn đọc `infra/local-releases/experiences/` (mount read-only); sửa file trong đó rồi `docker compose ... restart agent-runtime` để áp dụng. Model dùng `GOOGLE_API_KEY` và proxy như phần Knowledge Base.

Giới hạn hiện tại: UI chỉ dùng JSON (chưa stream SSE); sửa đáp án (`edit_answer`) và xác nhận làm rõ chưa được runtime hỗ trợ ở profile adaptive.

## Cấu hình agent

- Agent (lời chào, prompt, model...) được quản lý trong Studio qua `/api/v1/admin/agent/...` (draft, validate, publish, restore, audit). Runtime đọc release đang active từ studio-api (`RUNTIME_AGENT_RELEASE_SOURCE=product`, `RUNTIME_PRODUCT_URL=http://studio-api:3001`); hội thoại mới dùng release mới nhất, hội thoại cũ giữ release đã ghim.
- `bash scripts/local-stack.sh up` chạy `studio-api-seed-agent` (profile `tools`): nạp draft/v1/pointer từ `infra/local-releases/agent.json` chỉ khi chưa có release agent nào.
- Khoá `SDA_LOCAL_RUNTIME_PRODUCT_KEY` (tự sinh bởi `init`, base64 32 byte) ký yêu cầu runtime -> studio-api; phải khác mọi khoá runtime khác. Phía studio-api là `PRODUCT_DELIVERY_VERIFY_KEY`.
- `/api/v1/internal/` bị gateway (nginx) trả 404; chỉ runtime gọi được qua mạng compose.
- Khi migration 0002 (hoặc baseline) thay đổi, tạo lại DB sản phẩm (không đụng `sda_runtime`):

```bash
C="docker compose --project-name sda-full-local --env-file .local-docker/.env -f docker-compose.full-local.yaml"
$C up -d --wait db
$C exec db psql -U sda_local -d postgres -c "DROP DATABASE IF EXISTS sda_local WITH (FORCE)" -c "CREATE DATABASE sda_local OWNER sda_local"
bash scripts/local-stack.sh up
```

## Test tự động qua gateway

```bash
bash scripts/local-stack.sh smoke
```

Script gọi HTTP thật qua gateway và kiểm cả response/state liên quan; không bypass auth hoặc DB. Nó tạo user developer, experience/draft mẫu, avatar PNG nhỏ và version khi DB chưa có version. User tạm để kiểm admin CRUD/bulk được soft-delete sau test. Smoke chạy lại dùng cùng developer account/experience; draft của **experience smoke riêng** được cập nhật lại, nên không dùng experience đó cho nội dung cần giữ.

Các nhóm được kiểm:

- Health UI/API; auth register/login/session/refresh/logout, 401 khi chưa đăng nhập và 403 khi user gọi API admin.
- GET/PUT profile, users list, admin users list/create/read/update/delete/restore và bulk create/update/delete.
- Upload avatar → MinIO → đọc avatar và download qua hai alias route.
- Versions GET và POST trên DB mới.
- Experiences create/list/read/patch; draft GET/PUT; replay, key collision và revision conflict.
- Release list, release không tồn tại và publish bị gate chặn (422).

Smoke không chứng minh publish thành công, scoring/card production hoặc E2E chat runtime. Nó chỉ test routes Product đã có. Không yêu cầu model/provider key.

## Test bằng curl / Postman

API base URL: `http://localhost:3000/api/v1`.

```bash
curl -i http://localhost:3000/api/health
curl -i http://localhost:3000/ready
curl -i http://localhost:18000/healthz
curl -i http://localhost:18000/ready

# Điền password admin từ file env; giữ cookie jar cho những request sau.
curl -i -c /tmp/sda-local-admin.cookies \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"YOUR_LOCAL_ADMIN_PASSWORD"}' \
  http://localhost:3000/api/v1/admin/auth/login

curl -i -b /tmp/sda-local-admin.cookies \
  http://localhost:3000/api/v1/admin/experiences

curl -i -b /tmp/sda-local-admin.cookies \
  -H 'Content-Type: application/json' \
  -d '{"name":"My local experience","activity_type":"personality_assessment","idempotency_key":"manual_create_001"}' \
  http://localhost:3000/api/v1/admin/experiences
```

Postman có thể giữ cookie sau login hoặc lấy `data.access_token` và đặt Bearer Token. User login dùng body `{"email":"...","password":"..."}`; admin login dùng `username`.

| Nhóm | Routes hiện có (prefix `/api/v1`) |
|---|---|
| Auth | POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; GET `/auth/session`; POST `/admin/auth/login` |
| Profile/users | GET/PUT `/me`; GET `/users`; GET/POST (201) `/admin/users`; GET/PUT/DELETE `/admin/users/{id}`; POST `/admin/users/{id}/restore` |
| Bulk | POST `/admin/users/bulk/create`; PUT `/admin/users/bulk/update`; POST `/admin/users/bulk/delete` |
| Avatar/download | POST `/users/avatar/upload` (`multipart/form-data`, field `file`); GET `/users/{id}/avatar`; GET `/download?object_name=...`; alias `/download` không có prefix |
| Versions | GET/POST `/versions` |
| Experiences | GET/POST `/admin/experiences`; GET/PATCH `/admin/experiences/{id}`; GET/PUT `/admin/experiences/{id}/draft`; GET/POST `/admin/experiences/{id}/releases`; GET `/admin/experience-releases/{release_id}` |

Metadata dùng `metadata_revision` / `expected_metadata_revision`; draft dùng `draft_revision` / `expected_draft_revision`. Hai counter độc lập; no-op giữ revision. Thao tác mới dùng idempotency key mới, retry giữ nguyên key/payload. List dùng `data.items` và `meta.pagination`; bulk dùng `meta.summary`. Session dùng `principal` và `is_admin`. Xem [API review migration](api-review-fixes.md) và [error registry](../../contracts/error-codes.json).

Refresh/logout chỉ nhận refresh cookie HttpOnly, không nhận token trong body. Khi gọi bằng curl/Postman, thêm `Origin: http://localhost:3000` (khớp external gateway origin); access mặc định 30 phút, refresh family 14 ngày. Logout thu hồi cả access và refresh của session. Duplicate email trả 409 `CONFLICT_EMAIL_EXISTS`.

## Những route chưa chạy thành công toàn luồng

- Publish release hiện trả `422 PUBLISH_GATE_FAILED` khi chưa có validation/evaluation report được xác minh. Không giả verifier để làm publish pass.
- Conversation đi qua BFF scaffold trong studio-api; release lấy từ thư mục local, chưa từ Product release. Định dạng cookie owner, CSRF và TTL vẫn chờ DEC-07.
- Runtime `/docs` là FastAPI docs; Studio/Product chưa đăng ký Swagger route. Xem contracts trong `contracts/openapi/public` để biết schema đầy đủ.

## Quản lý stack

```bash
bash scripts/local-stack.sh ps
bash scripts/local-stack.sh logs studio-api
bash scripts/local-stack.sh logs web-ui
bash scripts/local-stack.sh logs agent-runtime
bash scripts/local-stack.sh down
```

`down` giữ volume và dữ liệu local. Không xóa `.local-docker/.env` khi còn dùng volume cũ: đổi password trong file không tự đổi password PostgreSQL/MinIO đã khởi tạo. Không dùng `down -v` nếu muốn giữ dữ liệu.
