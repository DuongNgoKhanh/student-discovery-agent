# Tài liệu API

Mỗi resource có một file OpenAPI riêng, gồm endpoint, request/response schema và ví dụ của nhóm đó.
Các file trong `schemas/` chỉ chứa component dùng chung, không phải API độc lập.

## API học sinh — chat anonymous

Học sinh không cần đăng ký hoặc đăng nhập. MVP chat dùng ba nhóm API sau:

| File | Nội dung |
| --- | --- |
| [conversation-api.yaml](openapi/public/conversation-api.yaml) | Tạo/đọc conversation, lịch sử messages, gửi turn/interaction, kết thúc phiên. |
| [activity-api.yaml](openapi/public/activity-api.yaml) | Đọc kết quả hiện hành của activity. |
| [result-api.yaml](openapi/public/result-api.yaml) | Đọc projection ShareCard của result. |

Luồng xác định chủ phiên:

1. Browser gọi `POST /conversations`. Khi chưa có cookie `sda_owner`, server tạo anonymous owner,
   tạo conversation và trả cookie qua `Set-Cookie` trong response `201`.
2. Browser tự lưu và gửi cookie khi đọc conversation/messages, gửi turns, kết thúc phiên,
   đọc kết quả và ShareCard. Cookie hợp lệ có sẵn được dùng lại khi tạo conversation mới.
3. Các API truy cập resource đã tạo yêu cầu cookie hợp lệ; ID của conversation/activity/result
   không đủ để truy cập. Cookie có mặt nhưng invalid/expired trả `401`, kể cả khi tạo conversation.

Cookie dùng `HttpOnly`, host-only, `Path=/api/v1`, `SameSite=Lax` và `Secure` trên production HTTPS.
MVP dùng UI/API cùng site. Frontend khác origin nhưng cùng site cần gửi request với
`credentials: include`; server cấu hình CORS credentials với origin cụ thể. Triển khai khác site
cần chốt lại SameSite/CSRF. CSRF, định dạng credential và TTL vẫn cần chốt theo DEC-07.

Retry tạo conversation trong cùng owner giữ nguyên `idempotency_key`/payload. Nếu mất cả cookie
và response khởi tạo, request tạo owner mới không khôi phục hoặc replay conversation của owner cũ;
deduplication xuyên owner không được đảm bảo.

## API scaffold ngoài phạm vi MVP chat anonymous

Các API dưới đây thuộc scaffold quản lý tài khoản hiện có, không cần gọi để bắt đầu hoặc tiếp tục chat:

| File | Nội dung |
| --- | --- |
| [auth-api.yaml](openapi/public/auth-api.yaml) | Đăng ký, đăng nhập, refresh token của scaffold hiện có. |
| [profile-api.yaml](openapi/public/profile-api.yaml) | Hồ sơ cá nhân và danh sách người dùng của scaffold. |
| [avatar-api.yaml](openapi/public/avatar-api.yaml) | Upload và đọc avatar của scaffold. |
| [versions-api.yaml](openapi/public/versions-api.yaml) | Đọc/tạo version ứng dụng (công khai, POST trả 201, version dạng `x.y.z`). |
| [download-api.yaml](openapi/public/download-api.yaml) | `GET /download?object_name=<bucket>/<key>`, response nhị phân; chỉ bucket avatar công khai, còn lại 404. |

`POST /auth/logout` nằm trong [auth-api.yaml](openapi/public/auth-api.yaml): xóa cookie auth, response envelope `data: {ok: true}`.

## API Admin

Admin cần đăng nhập và được kiểm tra quyền khi cấu hình experience, quản lý release và đọc audit.

`Experience` là cấu hình một trải nghiệm có draft và release; `Activity` là một lần học sinh
thực hiện trải nghiệm đó trong conversation, tham chiếu `experience_id` và `experience_release_id`.
MVP hỗ trợ `activity_type: personality_assessment`. Các schema câu hỏi, scoring và House thuộc
kiểu này; kiểu trải nghiệm mới sẽ có schema/engine riêng và cần thương lượng capability/version.
Tên `Experience` được dùng chung cho các endpoint, schema metadata/draft/release và quyền `experience.*`.

| File | Nội dung |
| --- | --- |
| [experience-api.yaml](openapi/public/experience-api.yaml) | Metadata experience, cấu hình definition và đọc/lưu draft. |
| [experience-validation-api.yaml](openapi/public/experience-validation-api.yaml) | Kiểm tra cấu hình và chạy evaluation. |
| [experience-preview-api.yaml](openapi/public/experience-preview-api.yaml) | Tạo preview và gửi turn trong preview. |
| [experience-release-api.yaml](openapi/public/experience-release-api.yaml) | Publish/read release, active pointer, activate và rollback. |
| [audit-api.yaml](openapi/public/audit-api.yaml) | Đọc audit log. |
| [admin-auth-api.yaml](openapi/public/admin-auth-api.yaml) | Đăng nhập Admin của scaffold. |
| [admin-user-api.yaml](openapi/public/admin-user-api.yaml) | Quản lý người dùng của scaffold. |

## Schema dùng chung

| File | Nội dung |
| --- | --- |
| [schemas/common.yaml](openapi/schemas/common.yaml) | Envelope, metadata, lỗi, reusable responses và ví dụ conflict. |
| [schemas/activity.yaml](openapi/schemas/activity.yaml) | Activity state, câu hỏi, đáp án, clarification và result reference. |
| [schemas/chat.yaml](openapi/schemas/chat.yaml) | Conversation state, turn/interaction input và turn output. |
| [schemas/typed-blocks.yaml](openapi/schemas/typed-blocks.yaml) | Typed blocks và dữ liệu PersonalityCard. |

Schema chỉ dùng bởi một nhóm nằm trong `components.schemas` của nhóm đó. Schema được dùng bởi
nhóm khác sẽ được tham chiếu bằng `$ref` tương đối; mỗi định nghĩa có một nơi để sửa.
Mở YAML bằng công cụ hỗ trợ external `$ref` và giữ nguyên cấu trúc thư mục khi chia sẻ tài liệu.

[user-api.yaml](openapi/public/user-api.yaml) và [admin-api.yaml](openapi/public/admin-api.yaml) là hai mục lục tổng hợp,
tham chiếu tới endpoint/component trong các file trên. Chúng giữ các tên component và operation hiện có,
để lệnh `gen:api` tiếp tục sử dụng hai entrypoint cũ. Khi sửa contract, sửa file định nghĩa gốc;
khi thêm endpoint/component, bổ sung tham chiếu tương ứng trong mục lục.

Các quyết định DEC và quy ước chung vẫn nằm trong `info.description` của hai mục lục.
Việc chia file giữ nguyên contract: revision/idempotency, kiểm tra stale result, lifecycle,
khả năng thêm optional response fields và quy tắc version của typed blocks/projection.
Các lựa chọn còn ở trạng thái Proposed vẫn cần chốt trước implementation.

[error-codes.json](error-codes.json) là registry duy nhất; [error_codes.md](error_codes.md), TypeScript/Python và OpenAPI enum được generate bằng `python3 scripts/generate-error-codes.py`. Envelope dùng canonical code; alias cũ ở `error.legacy_code`. Xem [API migration](../docs/operations/api-review-fixes.md).

## Tương thích về sau

Server chỉ được **thêm** vào contract đã phát hành: thêm field (optional với request), thêm endpoint,
thêm giá trị enum. Server không đổi tên, đổi kiểu, đổi nghĩa hoặc bỏ field/endpoint trong cùng một
phiên bản; thay đổi như vậy chờ phiên bản API hoặc envelope tiếp theo.

Client phải:

- bỏ qua field lạ trong response, không lỗi khi gặp field mới;
- xử lý giá trị enum lạ theo nhánh mặc định an toàn (ví dụ hiển thị chung chung, coi như lỗi không retry);
- không phụ thuộc vào thứ tự field trong JSON;
- phân nhánh lỗi theo `error.code`, không theo `message`.

Envelope hiện trả cả HTTP status lẫn `status` trong body, và `error.message` dạng text tiếng Anh.
`status` trong body luôn bằng HTTP status. `message` chỉ để debug/log; web-ui hiện vẫn dùng `message`
làm fallback hiển thị, nên chưa bỏ được. Ở phiên bản envelope tiếp theo: UI dịch thông báo theo
`error.code`, sau đó bỏ `status` trong body và hạ `message` thành field debug.

## Kiểm tra contract và bảng parity

Public gateway origin local của mọi YAML là `http://localhost:3000/api/v1`. Chạy `pnpm --dir apps/studio-api contracts:check`
(`@redocly/cli lint`, cấu hình `apps/studio-api/redocly.yaml`) trên hai mục lục `user-api.yaml`/`admin-api.yaml`;
lệnh fail khi `$ref` không resolve được hoặc schema sai cấu trúc OpenAPI 3.0.

Trạng thái parity giữa contract và triển khai hiện tại (Product API là Hono routes ở
`apps/studio-api/src/modules`; backend Python cũ đã được gỡ).

| Endpoint | Trạng thái | Ghi chú |
| --- | --- | --- |
| `/auth/register`, `/auth/login`, `/auth/refresh` | implemented (studio-api `/api/v1`) | Access/user trong `data`; refresh chỉ qua HttpOnly cookie và xoay vòng server-side. |
| `/auth/session` | implemented (studio-api `/api/v1`) | Read-only verified metadata `{principal:{type,id},is_admin}`; missing/invalid/expired trả 401 với code riêng. |
| `/auth/logout` | implemented (studio-api `/api/v1/auth/logout`) | Response `data: {ok:true}`. |
| `/admin/auth/login` | implemented (studio-api `/api/v1`) | Không có mật khẩu mặc định; cần `ADMIN_PASSWORD`. |
| `/me`, `/users`, `/admin/users*` (CRUD, restore, bulk) | implemented (studio-api `/api/v1`) | `/users` yêu cầu Bearer; tạo user trả 201; list admin mặc định chỉ user chưa xóa (`is_deleted=true` để xem đã xóa); bulk delete là `POST /admin/users/bulk/delete`; bulk create thất bại trả `user_id: null`; `updated_at` bằng `created_at` khi mới tạo. |
| `/users/avatar/upload`, `/users/{user_id}/avatar` | implemented (studio-api `/api/v1`) | Avatar quá lớn trả 413. |
| `/versions` (GET, POST 201) | implemented (studio-api `/api/v1`) | Public, không RBAC. |
| `/download` | implemented (studio-api `/api/v1`) | Chỉ bucket avatar công khai; bucket khác hoặc `..` trả 404. |
| `/conversations*`, `/activities/{id}/result`, `/results/{id}/share-card` | future | Chat anonymous, chưa triển khai. |
| `/admin/experiences*`, `/admin/experience-releases*`, `/admin/experience-previews*`, `/admin/audit-logs*` | future | Studio, chưa triển khai. |

Normalization đã xử lý: `/users` yêu cầu Bearer; `/download` giới hạn bucket avatar công khai (`..` -> 404);
ID user là integer; login/register theo `AuthResponse` phẳng; bulk create `user_id` nullable.

Quyết định có chủ đích: `requireAdmin` trả 401 khi thiếu/sai token và 403 khi không phải admin; admin login
không có mật khẩu mặc định (cần `ADMIN_PASSWORD`, thiếu thì 401); body không phải JSON trả 415; avatar quá
lớn trả 413.

Mọi endpoint Product `/api/v1` nhận JSON body (Studio API/Hono) yêu cầu `Content-Type: application/json`
(cho phép `; charset=...` hoặc `application/*+json`); body không rỗng với content type khác trả `415`
`VAL_UNSUPPORTED_MEDIA_TYPE` và không set cookie (chống CSRF qua request "simple" cross-site). Body tùy chọn
để trống (ví dụ `/auth/refresh` dùng cookie) không cần content type. Mã lỗi xem [error_codes.md](error_codes.md).

## B-01 runtime lifecycle và capability

[Internal runtime API](openapi/internal/runtime-api.yaml) dùng prefix `/api/v1/internal` và hai header
`X-Caller-Context`/`X-Internal-Caller` đã ký/binding request; không dùng cookie AnonymousOwner trực tiếp,
không mở route Python qua public gateway. `/health` độc lập. Shared schema nằm trong
[session-lifecycle.yaml](openapi/schemas/session-lifecycle.yaml), fixture tại
[session-lifecycle.json](fixtures/session-lifecycle.json). Đăng ký contract chưa xác nhận route TS/client đã triển khai.

Demo có TTL cố định 3600 giây từ lúc tạo; reload/turn không gia hạn. End hoặc đúng hạn expiry chặn
mọi đọc/ghi nội dung, history/result/ShareCard trả 410 và data null. End lặp lại chỉ trả năm trường
`conversation_id/status/revision/closed_at/expires_at`; sau purge trả 404. Nội dung đủ điều kiện purge
86400 giây sau thời điểm đóng hiệu lực; trace có retention riêng 86400 giây từ event.

Create `accepted_activity_profiles` thiếu/rỗng mặc định legacy-only (`algorithm_profile=null`).
Khai báo `riasec.mean.bounds.v2` đồng nghĩa hiểu ActivityView v2 và yêu cầu đủ manifest text v1,
assessment_question v2, assessment_clarification v2, personality_card v1. Không ngầm bổ sung blocks
hoặc legacy fallback. Capability được pin, runtime từ chối profile/engine chưa đăng ký. Schema v1
vẫn giữ sáu answers; v2 dùng progress min/max/phase và total null trước completed. Bộ selector/scoring không đổi.

DTO Python dùng synchronous ports trong `agent_runtime.sessions`; policy demo không ngầm dùng production.
Product release descriptor phân biệt delivery schema và definition schema, snapshot agent `agent.snapshot.v1`
chứa cấu hình agent (persona, model, limits, tools, guardrails, templates); ví dụ đầy đủ ở `fixtures/agent-snapshot-demo.json`. Registry, canonical hash và metadata immutable được
release importer kiểm trước pinning. Result/ShareCard tiếp tục dùng projection và allowlist hiện có.

Contract review: A/D cần đối chiếu manifest/view/block v2, Agent snapshot và minimal end acknowledgement;
internal signing/request binding cần tích hợp Product trước khi xem là hỗ trợ thực tế. Generated TS DTO được tạo bằng `gen:api`; các lệnh xác minh và kết quả thực tế nằm trong [bằng chứng B-01](../docs/implementation/b01-acceptance-evidence.md).

Agent `allowed_activity_profiles` là allowlist quyền: `personality_assessment` cho activity legacy
(`algorithm_profile=null`), `riasec.mean.bounds.v2` cho adaptive. Danh sách rỗng chặn mọi activity;
capability legacy mặc định của browser không tự cấp quyền Agent.

Legacy definition 1.0 hiện luôn `UNSUPPORTED` bởi semantic validator thật; v1 storage/rehydration vẫn được giữ. Positive start B-01 dùng adaptive capability và pilot registry được inject rõ trong tests. Registry runtime mặc định rỗng; không có legacy import/start bypass. Sáu internal operations Python không xác nhận Product signer/cookie/proxy hay UI đã triển khai. Xem [runtime lifecycle](../apps/agent-runtime/docs/session-runtime.md) và [runbook demo](../docs/operations/session-runtime-demo.md).
