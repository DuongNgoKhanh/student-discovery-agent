# Test agent-runtime bằng Docker local

Nếu muốn test cả auth/users/experiences/storage/UI, dùng [stack local đầy đủ](../../../docs/operations/local-stack.md) thay cho cấu hình runtime-only bên dưới. Hai cấu hình cùng dùng port 18000 mặc định nên chỉ chạy một trong hai tại một thời điểm.

Chạy các lệnh từ **root repository**. Cần Docker daemon và Docker Compose v2 có hỗ trợ `env_file.required`. Cấu hình standalone này mở runtime trên localhost và dùng project `sda-runtime-local`, tách khỏi stack `sda` trong `docker-compose.yaml`.

## Build và chạy

```bash
docker build --build-arg http_proxy --build-arg https_proxy \
  -t sda-agent-runtime:local apps/agent-runtime

docker compose -f docker-compose.runtime-local.yaml up -d --no-build
```

Các build args truyền proxy từ shell nếu có; không cần ghi proxy vào Dockerfile hoặc file env. Cách build bằng Docker CLI ở trên dùng được cả khi máy chưa cài Buildx. Khi Buildx đã có, cũng có thể dùng `docker compose -f docker-compose.runtime-local.yaml up -d --build`.

Runtime mặc định được mở tại `127.0.0.1:18000`. Nếu cổng 18000 đang được dùng:

```bash
RUNTIME_LOCAL_PORT=18001 docker compose -f docker-compose.runtime-local.yaml up -d --no-build
```

Trong trường hợp đó, thay cổng trong các URL bên dưới bằng `18001`.

## Kiểm tra server

```bash
curl -i http://127.0.0.1:18000/health
curl -I http://127.0.0.1:18000/docs
```

Health trả HTTP 200 với `{"status":"healthy"}`. Xem danh sách routes tại <http://127.0.0.1:18000/docs> và OpenAPI tại <http://127.0.0.1:18000/openapi.json>. FastAPI routes đọc raw request nên Swagger hiện không mô tả đầy đủ request body/auth; payload chuẩn nằm ở `contracts/openapi/internal/runtime-api.yaml` và `contracts/openapi/schemas/chat.yaml`.

Health chỉ xác nhận process hoạt động, không xác nhận database, Product release delivery, engine registry hoặc projector đã sẵn sàng.

## Các route nghiệp vụ

Prefix: `/api/v1/internal`.

| Method | Path | Chức năng |
|---|---|---|
| POST | `/conversations` | Tạo conversation từ Agent Release. |
| GET | `/conversations/{conversation_id}` | Đọc state hiện tại. |
| GET | `/conversations/{conversation_id}/messages` | Đọc history. |
| POST | `/conversations/{conversation_id}/turns` | `set_name` hoặc `submit_answer` bằng option. |
| POST | `/conversations/{conversation_id}:end` | Đóng conversation. |
| GET | `/activities/{activity_id}/result` | Đọc result hiện hành. |
| GET | `/results/{result_id}/share-card` | Đọc share-card projection. |

Container đọc `apps/agent-runtime/.env` nếu file tồn tại. Các biến liên quan được liệt kê trong `apps/agent-runtime/.env.example`; giữ credential ngoài Git. Không tự nạp `.env` của Product vào runtime. Khi thay env, recreate container bằng `docker compose -f docker-compose.runtime-local.yaml up -d --no-build --force-recreate`.

Internal request cần `X-Internal-Caller: sda-product-bff` và JWT `X-Caller-Context` được ký, có scope gắn đúng method, internal path và SHA-256 của raw body. Không có runtime config hợp lệ thì route nghiệp vụ trả 503; có verifier nhưng thiếu/sai credential thì trả lỗi auth.

App mặc định vẫn giữ `ProductUnavailable`, nhưng đã đăng ký engine `career-assessment-v1` và completion port thật (B-03). Build image thành công không tự tạo dữ liệu demo: luồng tên/đáp án/card chỉ chạy khi có release đã pin. Integration tests dùng validated fixture releases trên PostgreSQL 16 riêng; xem `apps/agent-runtime/docs/evaluations.md`. Môi trường demo có dữ liệu và công cụ ký request là một chế độ bổ sung riêng.

## Logs và dừng

```bash
docker compose -f docker-compose.runtime-local.yaml ps
docker compose -f docker-compose.runtime-local.yaml logs -f runtime
docker compose -f docker-compose.runtime-local.yaml down
```

File Compose này không tạo database, không migrate dữ liệu và không gắn volume của stack Product. Image production và cơ chế xác thực runtime giữ nguyên.
