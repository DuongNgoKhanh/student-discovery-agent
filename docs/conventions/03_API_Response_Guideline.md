# 📘 API Response Guideline – Chuẩn ISC

---

## 🎯 Mục tiêu

Chuẩn hóa định dạng phản hồi của tất cả API trong hệ thống ISC giúp:

- Đảm bảo tính nhất quán trong giao tiếp hệ thống.
- Giúp frontend, mobile app, hệ thống tích hợp xử lý đồng nhất.
- Tăng hiệu quả log, trace, debug và monitoring.
- Hỗ trợ quá trình manual/automation test.

---

## ✅ Cấu trúc response thành công

```json
{
  "success": true,
  "data": {
    "user_id": 123,
    "username": "john.doe"
  },
  "error": null,
  "meta": {
    "request_id": "req-abc-123",
    "trace_id": "trace-xyz-789",
    "timestamp": "2025-06-16T09:00:00Z"
  }
}
```

- `success`: luôn `true` nếu thành công
- `data`: object, array hoặc `null` nếu không có payload
- `error`: `null` nếu không có lỗi
- `meta`: metadata thêm cho trace & monitoring

---


## ✅ Response với phân trang

```json
{
  "success": true,
  "data": [...],
  "error": null,
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 10,
      "total_items": 42,
      "total_pages": 5,
      "has_next": true,
      "has_prev": false
    },
    "request_id": "req-xyz-111",
    "trace_id": "trace-abc-222",
    "timestamp": "2025-06-16T09:03:00Z"
  }
}
```

---

## ❌ Phản hồi lỗi nghiệp vụ (business logic error)

- HTTP status: `200 OK`
- `success = false`
- `data = null`
- `error`: có cấu trúc rõ ràng

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_OTP",
    "message": "Mã OTP không hợp lệ hoặc đã hết hạn",
    "details": {
      "field": "sms_otp"
    },
    "retryable": false
  },
  "meta": {
    "request_id": "req-def-456",
    "trace_id": "trace-uvw-123",
    "timestamp": "2025-06-16T09:01:00Z"
  }
}
```

---

## ❌ Phản hồi lỗi kỹ thuật (4xx - 5xx)

- HTTP status: 4xx hoặc 5xx
- `success = false`
- Middleware chịu trách nhiệm xử lý

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "SYS_500",
    "message": "Internal server error. Please try again later.",
    "details": {
      "field": "Can not connect database."
    },
    "retryable": true
  },
  "meta": {
    "request_id": "req-hij-999",
    "trace_id": "trace-klm-000",
    "timestamp": "2025-06-16T09:02:00Z"
  }
}
```

---

## 🧱 Mô tả các trường phản hồi

| Trường        | Bắt buộc | Mô tả |
|---------------|----------|-------|
| `success`     | ✅       | Trạng thái xử lý logic thành công |
| `data`        | ✅       | Payload trả về – `object / array / null` |
| `error.code`  | 🔁       | Mã lỗi nội bộ (`AUTH_401`, `SYS_500`,...) |
| `error.message`| 🔁      | Mô tả lỗi dễ hiểu, dành cho dev hoặc người dùng |
| `error.details`| 🔁      | Chi tiết lỗi – có thể là object hoặc array |
| `error.retryable`| 🔁   | Cho biết client có thể retry không |
| `meta.request_id` | ✅   | ID để định danh mỗi request |
| `meta.trace_id`   | ✅   | Dùng để trace xuyên hệ thống |
| `meta.timestamp`  | ✅   | ISO timestamp tạo response |
| `meta.pagination` | 🔁   | Chỉ có khi có phân trang |

>🔁: Có thể `null` hoặc không xuất hiện nếu không có lỗi.

---

## 📌 Bảng lỗi HTTP phổ biến

| HTTP Code | Tên lỗi               | Mô tả thực tế                                                 |
|-----------|------------------------|----------------------------------------------------------------|
| `400`     | Bad Request            | Sai format, thiếu field, lỗi JSON                             |
| `401`     | Unauthorized           | Thiếu hoặc sai token                                          |
| `403`     | Forbidden              | Không có quyền                                                |
| `404`     | Not Found              | URL sai, không tìm thấy resource                              |
| `408`     | Request Timeout        | Server mất quá nhiều thời gian xử lý                          |
| `426`     | Upgrade Required       | Bắt buộc nâng cấp phiên bản                                   |
| `429`     | Too Many Requests      | Gửi quá nhiều request                                         |
| `500`     | Internal Server Error  | Crash, lỗi hệ thống                                            |
| `502`     | Bad Gateway            | Service upstream lỗi                                          |
| `503`     | Service Unavailable    | Server quá tải hoặc bảo trì                                   |

---

> ✅ Những lỗi trên nên được `middleware handle` trả code `httpStatus` chính xác tránh gây ảnh hưởng đến biz-flow của client

---

## 🧠 Phân loại lỗi

| Loại lỗi  | HTTP Status | success | Mô tả xử lý |
|-----------|-------------|---------|--------------|
| Nghiệp vụ | 200         | false   | Dev chủ động trả về từ service |
| Kỹ thuật  | 4xx / 5xx    | false   | Middleware handle và trả lỗi |

---

## 🏷️ Prefix mã lỗi gợi ý

| Prefix             | Ý nghĩa                             |  
|--------------------|-------------------------------------|
| `INVALID_*`        | Dữ liệu sai định dạng               |
| `MISSING_*`        | Thiếu thông tin                     |
| `DUPLICATE_*`      | Trùng dữ liệu                       |
| `NOT_FOUND_*`      | Không tìm thấy                     |
| `UNAUTHORIZED_*`   | Không có quyền                      |
| `BUSINESS_RULE_*`  | Vi phạm quy tắc nghiệp vụ           |

---

## 🧩 Checklist Dev khi xử lý API

| Tiêu chí kiểm tra                                     | Trạng thái | Ghi chú                                     |
|--------------------------------------------------------|------------|---------------------------------------------|
| Trả `success = true` khi xử lý thành công              | ✅         | Bắt buộc                                    |
| Trả `success = false` khi xảy ra lỗi nghiệp vụ         | ✅         | Dùng đúng `code`, `message`, `trace_id`      |
| Không dùng `throw` cho lỗi nghiệp vụ                   | ✅         | Tránh crash không cần thiết                 |
| Middleware xử lý lỗi kỹ thuật (4xx/5xx)                | ✅         | Chủ động verify trước khi trả về client                    |
| Luôn có `trace_id` trong mọi response                   | ✅         | Dùng để trace log & monitoring              |
| Dùng `code` từ `error_codes.md`                        | ✅         | Không tự đặt mã lỗi                         |
| Không trả HTTP 200 nếu là lỗi kỹ thuật                 | ✅         | Chỉ có thể 200 cho lỗi nghiệp vụ              |

---

## 🧪 Checklist QA khi review API

| Mục kiểm                              | Bắt buộc | Ghi chú                                                |
|--------------------------------------|----------|--------------------------------------------------------|
| Đúng format JSON response            | ✅       | Có `success`, `code`, `message`, `trace_id`               |
| Dùng đúng mã lỗi chuẩn               | ✅       | Tham khảo `error_codes.md`                            |
| Có YAML mô tả API (OpenAPI 3.0)      | ✅       | File đặt tại `docs/api/openapi/`                      |
| Có `trace_id` trong mọi phản hồi      | ✅       | Bắt buộc để trace lỗi chính xác                       |
| Không dùng HTTP 200 cho lỗi hệ thống| ✅       | 200 chỉ dành cho thành công hoặc lỗi nghiệp vụ khác 4xx       |

---

## 🧩 Gợi ý bổ sung

- Mã lỗi nên đặt theo cấu trúc: `DOMAIN_CODE` (VD: `AUTH_401`, `USR_200`)
- Mỗi API cần có YAML mô tả (OpenAPI 3.0)
- `request_id`: sinh từ gateway hoặc entry endpoint
- `trace_id`: sinh từ hệ thống tracing (như OpenTelemetry)
- Nên dùng `snake_case` cho các field input/output

---

## 🧪 Khi viết API mới hoặc refactor cần đảm bảo test:

- ☑️ Trường hợp **thành công (happy path)**
- ❌ Trường hợp **dữ liệu sai, trạng thái không hợp lệ, lỗi nghiệp vụ**

---

## 📄 OpenAPI YAML

- Mỗi API phải có file `.yaml` tại `docs/api/openapi/`
- Viết theo chuẩn **OpenAPI 3.0**
- Dùng [Swagger Editor](https://editor.swagger.io/) để validate
  
---

## 📚 Tài liệu liên quan

- [`error_codes.md`](./error_codes.md)
- [`API_Naming_Convention.md`](./API_Naming_Convention.md)
- [`Coding_Convention.md`](./Coding_Convention.md)
- `docs/api/openapi/*.yaml` – mô tả API theo OpenAPI

---

📌 Kết luận
 Một response API nhất quán cần:
  - Chuẩn hóa cấu trúc: `success`, `data`, `error`, `meta`
  - Dùng đúng HTTP status code
  - Có `code` rõ ràng
  - Có `request_id`, `trace_id`
  - Phân biệt lỗi có thể retry / không retry
  - Không tiết lộ lỗi nội bộ

---

📌 **Tài liệu này bắt buộc áp dụng trong tất cả dự án nội bộ ISC.**
  
---


