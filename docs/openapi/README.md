# Tài liệu API

Mỗi resource có một file OpenAPI riêng, gồm endpoint, request/response schema và ví dụ của nhóm đó.
Các file trong `schemas/` chỉ chứa component dùng chung, không phải API độc lập.

## API học sinh

| File | Nội dung |
| --- | --- |
| [conversation-api.yaml](conversation-api.yaml) | Tạo/đọc conversation, lịch sử messages, gửi turn/interaction, kết thúc phiên. |
| [activity-api.yaml](activity-api.yaml) | Đọc kết quả hiện hành của activity. |
| [result-api.yaml](result-api.yaml) | Đọc projection ShareCard của result. |
| [auth-api.yaml](auth-api.yaml) | Đăng ký, đăng nhập, refresh token của scaffold hiện có. |
| [profile-api.yaml](profile-api.yaml) | Hồ sơ cá nhân và danh sách người dùng của scaffold. |
| [avatar-api.yaml](avatar-api.yaml) | Upload và đọc avatar của scaffold. |

## API Admin

| File | Nội dung |
| --- | --- |
| [assessment-api.yaml](assessment-api.yaml) | Metadata assessment, cấu hình definition và đọc/lưu draft. |
| [assessment-validation-api.yaml](assessment-validation-api.yaml) | Kiểm tra cấu hình và chạy evaluation. |
| [assessment-preview-api.yaml](assessment-preview-api.yaml) | Tạo preview và gửi turn trong preview. |
| [assessment-release-api.yaml](assessment-release-api.yaml) | Publish/read release, active pointer, activate và rollback. |
| [audit-api.yaml](audit-api.yaml) | Đọc audit log. |
| [admin-auth-api.yaml](admin-auth-api.yaml) | Đăng nhập Admin của scaffold. |
| [admin-user-api.yaml](admin-user-api.yaml) | Quản lý người dùng của scaffold. |

## Schema dùng chung

| File | Nội dung |
| --- | --- |
| [schemas/common.yaml](schemas/common.yaml) | Envelope, metadata, lỗi, reusable responses và ví dụ conflict. |
| [schemas/activity.yaml](schemas/activity.yaml) | Activity state, câu hỏi, đáp án, clarification và result reference. |
| [schemas/chat.yaml](schemas/chat.yaml) | Conversation state, turn/interaction input và turn output. |
| [schemas/typed-blocks.yaml](schemas/typed-blocks.yaml) | Typed blocks và dữ liệu PersonalityCard. |

Schema chỉ dùng bởi một nhóm nằm trong `components.schemas` của nhóm đó. Schema được dùng bởi
nhóm khác sẽ được tham chiếu bằng `$ref` tương đối; mỗi định nghĩa có một nơi để sửa.
Mở YAML bằng công cụ hỗ trợ external `$ref` và giữ nguyên cấu trúc thư mục khi chia sẻ tài liệu.

[user-api.yaml](user-api.yaml) và [admin-api.yaml](admin-api.yaml) là hai mục lục tổng hợp,
tham chiếu tới endpoint/component trong các file trên. Chúng giữ các tên component và operation hiện có,
để lệnh `gen:api` tiếp tục sử dụng hai entrypoint cũ. Khi sửa contract, sửa file định nghĩa gốc;
khi thêm endpoint/component, bổ sung tham chiếu tương ứng trong mục lục.

Các quyết định DEC và quy ước chung vẫn nằm trong `info.description` của hai mục lục.
Việc chia file giữ nguyên contract: revision/idempotency, kiểm tra stale result, lifecycle,
khả năng thêm optional response fields và quy tắc version của typed blocks/projection.
Các lựa chọn còn ở trạng thái Proposed vẫn cần chốt trước implementation.

[error_codes.md](error_codes.md) là tài liệu mã lỗi hiện có; mã lỗi Chat/Studio và HTTP response tương ứng
được mô tả trong [schemas/common.yaml](schemas/common.yaml).
