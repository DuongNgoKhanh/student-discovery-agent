# 📦 ERROR_CODES.md – Chuẩn hóa mã lỗi hệ thống ISC

Tài liệu chuẩn hóa tất cả mã phản hồi lỗi sử dụng trong hệ thống API ISC, nhằm:

- ✅ Nhất quán giữa các module
- ✅ Dễ trace log, debug, monitoring, test
- ✅ Phân biệt rõ lỗi **nghiệp vụ** và **kỹ thuật**
- ✅ Kết nối chặt chẽ với cấu trúc response chuẩn (`API_Response_Guideline.md`)

---

### ✅ Mã thành công (`2xx`)

| Mã nội bộ  | HTTP | Mô tả phản hồi                          |
|------------|------|------------------------------------------|
| GEN_200    | 200  | Thao tác thành công                     |
| USR_200    | 200  | Lấy thông tin người dùng thành công     |
| AUTH_200   | 200  | Đăng nhập thành công                    |
| PROD_200   | 200  | Lấy danh sách sản phẩm thành công       |
| AUTH_201   | 201  | Tạo access token mới                    |
| USR_204    | 204  | Xóa người dùng thành công (No content)  |

---


## ❌ Mã lỗi nghiệp vụ (`HTTP 200` + `success = false`)

| Mã nội bộ           | Mô tả                                     |
|---------------------|--------------------------------------------|
| INVALID_OTP         | Mã OTP không hợp lệ hoặc đã hết hạn        |
| USER_LOCKED         | Tài khoản người dùng bị khóa               |
| DUPLICATE_EMAIL     | Email đã tồn tại trong hệ thống            |
| INVALID_PASS        | Mật khẩu không đúng định dạng              |
| MISSING_CAPTCHA     | Thiếu CAPTCHA trong request                |
| UNAUTHORIZED_DEVICE | Thiết bị không được phép truy cập hệ thống |
| INVITE_EXPIRED      | Link mời đã hết hạn hoặc không tồn tại     |
| INVALID_PROFILE     | Thông tin hồ sơ không hợp lệ               |
| NOTIFY_FAILED       | Gửi thông báo thất bại                     |
| SESSION_CONFLICT    | Đăng nhập đồng thời gây xung đột session   |
| FILE_TOO_LARGE      | File upload vượt giới hạn                  |
| IMAGE_INVALID       | Định dạng ảnh không hỗ trợ                 |
| MFA_REQUIRED        | Cần xác thực đa yếu tố (MFA)               |

> 📌 Các lỗi này do Dev xử lý & trả về `success = false` kèm HTTP `200`

---

## 💥 Mã lỗi kỹ thuật (`4xx` / `5xx` – do middleware handle)

| Mã nội bộ       | HTTP | Mô tả kỹ thuật                          |
|------------------|------|------------------------------------------|
| REQ_400          | 400  | Request sai định dạng, thiếu field       |
| AUTH_401         | 401  | Chưa xác thực / thiếu token              |
| AUTH_403         | 403  | Không có quyền truy cập                  |
| USR_404          | 404  | Không tìm thấy người dùng                |
| PROD_404         | 404  | Không tìm thấy sản phẩm                  |
| REQ_TIMEOUT      | 408  | Yêu cầu xử lý quá lâu                    |
| RATE_429         | 429  | Gửi quá nhiều request liên tiếp          |
| UPGRADE_REQUIRED | 426  | Cần nâng cấp phiên bản client            |
| SYS_500          | 500  | Lỗi hệ thống (null/crash bất thường)     |
| DB_500           | 500  | Lỗi kết nối hoặc xử lý database          |
| DB_503           | 503  | Database quá tải / không sẵn sàng        |
| MQ_502           | 502  | Lỗi message queue (Kafka, RabbitMQ)      |
| EXT_504          | 504  | Timeout khi gọi hệ thống bên ngoài       |

> ✅ Các lỗi này được backend/middleware tự động bắt & trả về chuẩn.

---

## 🧩 Quy tắc đặt mã lỗi

| Thành phần       | Quy ước                            |
|------------------|------------------------------------|
| Prefix module    | `AUTH`, `USR`, `PROD`, `SYS`, `REQ`, ... |
| Ngữ nghĩa lỗi    | HTTP status code hoặc ngữ cảnh cụ thể (`INVALID_`, `DUPLICATE_`, ...) |
| Lỗi nghiệp vụ    | Dạng `INVALID_XXX`, `MISSING_XXX`, `USER_LOCKED`, ... |
| Lỗi kỹ thuật     | Dạng `REQ_400`, `AUTH_403`, `SYS_500`, ... |

> Ví dụ: `INVALID_EMAIL`, `REQ_400`, `AUTH_401`, `SESSION_CONFLICT`

---

## 📘 Gợi ý tổ chức mã lỗi theo module

```plaintext
ErrorCodes/
├── General.cs
├── User.cs
├── Auth.cs
├── Product.cs
├── System.cs
```

```csharp
public static class AuthErrorCodes {
    public const string Unauthorized = "AUTH_401";
    public const string Forbidden = "AUTH_403";
    public const string TokenExpired = "INVALID_TOKEN";
}
```

---

## 🔗 Kết hợp với API Response chuẩn

| Trường     | Mô tả                                               |
|------------|------------------------------------------------------|
| `success`  | `true` nếu thành công, `false` nếu lỗi nghiệp vụ     |
| `code`     | Mã lỗi nội bộ – phải nằm trong file này              |
| `message`  | Mô tả dễ hiểu – có thể show FE hoặc log              |
| `trace_id` | ID trace toàn hệ thống – log & debug                 |
| `data`     | Object trả về nếu thành công, `null` nếu lỗi         |

### Ví dụ:
```json
{
  "success": false,
  "code": "INVALID_OTP",
  "error": {
    "message": "Mã OTP không hợp lệ hoặc đã hết hạn",
    "retryable": false
  },
  "trace_id": "abc123",
  "data": null
}
```

---

## ✅ Checklist khi thêm mã lỗi mới

- ✅ Đặt đúng prefix module: `AUTH`, `USR`, `SYS`, ...
- ✅ Tên mã ngắn gọn, dễ hiểu, không trùng lặp
- ✅ Mapping đúng với HTTP status
- ✅ Phân biệt rõ lỗi nghiệp vụ & lỗi kỹ thuật
- ✅ Có thể tái sử dụng cho nhiều API (không hardcode riêng lẻ)

---


## 📚 Tài liệu liên quan

- [`API_Response_Guideline.md`](./API_Response_Guideline.md)
- [`API_Naming_Convention.md`](./API_Naming_Convention.md)
- [`Coding_Convention.md`](./Coding_Convention.md)
- [`docs/api/openapi/*.yaml`](./openapi/) – OpenAPI YAML mô tả chi tiết

---

📌 **Tài liệu này là tiêu chuẩn bắt buộc dùng trong toàn bộ hệ thống ISC.**  
Áp dụng cho Dev, QA, Reviewer khi xử lý response hoặc định nghĩa mã lỗi mới.
