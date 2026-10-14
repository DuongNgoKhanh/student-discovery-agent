# Tài liệu kiến trúc Student Discovery Agent

Phân biệt quyết định được duyệt, đặc tả đích và contract hiện có trước khi dùng tài liệu làm đầu vào triển khai. Repository hiện có scaffold và OpenAPI; các tài liệu bên dưới không xác nhận toàn bộ runtime đã có.

| Tài liệu | Vai trò | Trạng thái |
|---|---|---|
| [ADR-001 — Auth, persistence và release](ADR-001-auth-persistence-release-boundary.md) | Ranh giới TS Product/Studio và Python Execution | PROPOSED theo nội dung ADR-001 |
| [ADR-002 — Adaptive RIASEC](ADR-002-adaptive-riasec-scoring.md) | Quyết định và quan hệ với PR #13/DEC-04 (mục 1–6), đặc tả definition/metadata 6 Hệ/công thức/selector/stop/lifecycle/acceptance (mục 7), ví dụ contract/state (mục 8), truy vết FR/AT và câu hỏi mở (mục 9–10) | Người dùng duyệt thiết kế 15/10/2026; chưa triển khai/thẩm định chuyên môn; ví dụ chưa phải fixtures/API thực thi |
| [Contract boundary](CONTRACT_BOUNDARY_SPEC.md) | Headers, release pinning và tác động contract adaptive | Đặc tả tài liệu; phần adaptive chưa được đồng bộ vào OpenAPI |
| [OpenAPI hiện có](../openapi/README.md) | Schema/request/response đang có trong repository | Assessment hiện vẫn theo profile sáu câu; chưa có profile adaptive mới |

Đọc ADR-001 để hiểu quyền sở hữu dữ liệu, ADR-002 để hiểu lựa chọn thuật toán và hành vi chi tiết, rồi đọc contract boundary để nắm các điểm cần phối hợp. Phê duyệt ADR-002 không thay trạng thái ADR-001 và không tự sửa constraints của OpenAPI.

Ví dụ contract (ADR-002 mục 8) giúp theo dõi một hành trình cụ thể; ma trận truy vết (mục 9) giúp A/B/C/D thấy những yêu cầu/schema nào bị ảnh hưởng mà không phải suy ra từ các công thức.

Scope hiện tại chỉ hoàn thiện tài liệu architecture. Các SRS/tracker local và snapshot trong `docs/superpowers` là context làm việc; đặc tả adaptive được duy trì trong `docs/architecture/ADR-002-adaptive-riasec-scoring.md`.
