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

[error_codes.md](error_codes.md) là tài liệu mã lỗi hiện có; mã lỗi Chat/Studio và HTTP response tương ứng
được mô tả trong [schemas/common.yaml](openapi/schemas/common.yaml).

## Kiểm tra contract và bảng parity

Server local của mọi YAML là web `http://localhost:3000/api/v1`. Chạy `pnpm --dir apps/web contracts:check`
(`@redocly/cli lint`, cấu hình `apps/web/redocly.yaml`) trên hai mục lục `user-api.yaml`/`admin-api.yaml`;
lệnh fail khi `$ref` không resolve được hoặc schema sai cấu trúc OpenAPI 3.0.

Trạng thái parity giữa contract và triển khai hiện tại (Product API là Next route handlers ở
`apps/web/src/app/api/v1`; backend Python cũ đã được gỡ). Task là task port trong plan restructure.

| Endpoint | Trạng thái | Ghi chú |
| --- | --- | --- |
| `/auth/register`, `/auth/login`, `/auth/refresh` | implemented (Python) | Port sang Next ở Task 4. |
| `/auth/logout` | implemented (Next, `/api/auth/logout`) | Chưa nằm dưới `/api/v1`; chuyển ở Task 4. Response `data: {ok:true}`. |
| `/admin/auth/login` | implemented (Python) | Task 4. |
| `/me`, `/users`, `/admin/users*` (CRUD, restore, bulk) | implemented (Python) | Task 5. Mismatch: Python `/users` thiếu auth, contract yêu cầu BearerAuth; bulk create thất bại trả `user_id: null`. |
| `/users/avatar/upload`, `/users/{user_id}/avatar` | implemented (Python) | Task 6. |
| `/versions` (GET, POST 201) | implemented (Python) | Task 6; public, không RBAC. |
| `/download` | implemented (Python) | Mismatch có chủ đích: Python cho mọi bucket; contract chỉ cho bucket avatar công khai, còn lại/`..` trả 404 (Task 6). |
| `/conversations*`, `/activities/{id}/result`, `/results/{id}/share-card` | future | Chat anonymous, chưa triển khai. |
| `/admin/experiences*`, `/admin/experience-releases*`, `/admin/experience-previews*`, `/admin/audit-logs*` | future | Studio, chưa triển khai. |

Mọi endpoint Product `/api/v1` nhận JSON body (Next route handlers) yêu cầu `Content-Type: application/json`
(cho phép `; charset=...` hoặc `application/*+json`); body không rỗng với content type khác trả `415`
`VAL_UNSUPPORTED_MEDIA_TYPE` và không set cookie (chống CSRF qua request "simple" cross-site). Body tùy chọn
để trống (ví dụ `/auth/refresh` dùng cookie) không cần content type. Mã lỗi xem [error_codes.md](error_codes.md).

Mismatch chung: ID user ở JSON là integer, còn type UI hiện tại là `string` (xử lý ở Task 7); login/register theo
`AuthResponse` phẳng trong `data`.
