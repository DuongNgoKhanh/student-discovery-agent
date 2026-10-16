# 📘 API Naming Convention – ISC

> Quy ước đặt tên endpoint API chuẩn hóa cho toàn bộ dự án nội bộ ISC.

---

## 🌟 Mục tiêu

**Nhất quán – dễ đọc – dễ debug – RESTful – dễ mở rộng**

- ✅ Tập trung vào endpoint, path, method – tuân thủ RESTful & public API standards  
- ✅ Áp dụng cho toàn bộ Dev Backend, Frontend, Mobile, QA, QC, Doc, DevOps  

---

## ✅ Nguyên tắc tổng quát

| Tiêu chí                 | Mô tả                                                  |
|--------------------------|----------------------------------------------------------|
| ✅ RESTful              | Đặt tên theo resource: `users`, `orders`, `products`    |
| ✅ Danh từ số nhiều      | `users`, `logs`, `categories` cho danh sách             |
| ✅ Không dùng động từ   | Dùng HTTP method để phân biệt: `GET /users`            |
| ✅ Không lồng quá sâu    | Tối đa 3 cấp: `/orders/{id}/items`                     |
| ✅ Không viết hoa        | Dùng lowercase + dấu gạch ngang `/`                    |
| ✅ Có action rõ ràng    | Nếu không phải CRUD: `POST /users/{id}/reset-password` |

---

## 📌 Cấu trúc endpoint chuẩn

```text
/{domain}/{resource}/{id?}/{action?}
```

- `domain`: mô-đun lớn hoặc nhóm hệ thống (`auth`, `admin`, `public`...)  
- `resource`: đối tượng chính (user, order, report, ...)  
- `id`: định danh cụ thể (UUID hoặc numeric ID)  
- `action`: hành động nghiệp vụ bổ sung (nếu ngoài CRUD)  

---

## 🌐 Quy ước theo HTTP Method

| Method | URL ví dụ                         | Ý nghĩa                          |
|--------|------------------------------------|----------------------------------|
| GET    | `/users`                          | Lấy danh sách người dùng        |
| GET    | `/users/{id}`                     | Lấy chi tiết người dùng         |
| POST   | `/users`                          | Tạo mới người dùng              |
| PUT    | `/users/{id}`                     | Cập nhật toàn bộ thông tin      |
| PATCH  | `/users/{id}`                     | Cập nhật một phần thông tin     |
| DELETE | `/users/{id}`                     | Xóa người dùng                  |
| POST   | `/users/{id}/reset-password`      | Hành động cụ thể theo nghiệp vụ |

---

## 🔍 Truy vấn nâng cao (Filtering / Search)

```http
GET /products?category=abc&page=2&pageSize=20
GET /logs?traceId=xyz&level=error
GET /users/check-email?email=abc@example.com
```

> 📌 Nên dùng `snake_case` cho query params nếu cần, nhưng tránh dùng trong path URL.

---

## 🛑 Những điều KHÔNG nên làm

| ❌ Sai cách                      | ✅ Đúng cách               |
|----------------------------------|-----------------------------|
| `GET /getUsers`                  | `GET /users`               |
| `POST /createUser`              | `POST /users`              |
| `POST /update-user/{id}`        | `PUT /users/{id}`          |
| `GET /api/v1/auth/GetToken`     | `POST /auth/token`         |
| `DELETE /userDelete`            | `DELETE /users/{id}`       |

---

## ✅ Tên API nghiệp vụ cụ thể – Gợi ý chuẩn hóa

| Chức năng                    | API Gợi ý                             |
|------------------------------|----------------------------------------|
| Đăng nhập                    | `POST /auth/login`                    |
| Gửi lại OTP                  | `POST /auth/resend-otp`               |
| Đổi mật khẩu                 | `POST /users/{id}/change-password`    |
| Kiểm tra tồn tại email       | `GET /users/check-email?email=...`    |
| Cập nhật trạng thái đơn hàng| `PATCH /orders/{id}/status`           |
| Xuất file Excel              | `GET /reports/users/export`           |
| Gửi notification             | `POST /notifications`                 |

---

## 📍 Phân module theo domain (dự án lớn)

```text
/auth/login
/admin/users
/public/products
/internal/jobs
```
> ⚠ Nếu là hệ thống nội bộ, **tránh lặp lại prefix `/api/v1`**. Chỉ dùng versioning (`/api/v1`) nếu là public API hoặc có lý do kỹ thuật rõ ràng.

---

## 📘 YAML OpenAPI bắt buộc

- Mỗi API phải có file mô tả OpenAPI 3.0 (.yaml)  
- Đặt tại: `docs/api/openapi/{module}/{endpoint}.yaml`
- Tên file nên trùng với resource hoặc action chính, ví dụ: `users.yaml`, `change_password.yaml`  
- Sử dụng [Swagger Editor](https://editor.swagger.io/) để kiểm tra định dạng trước khi merge

---

## 📌 SUMMARY

- Mọi API mới phải:
  - Tuân thủ chuẩn RESTful
  - Có cấu trúc rõ ràng `/module/resource/{id}/{action}`
  - Đặt tên hợp lý theo HTTP method
  - Tránh viết hoa, lặp từ, động từ trong path
  - Có file `.yaml` mô tả đầy đủ (OpenAPI)
  - Review trước khi áp dụng: PM / Tech Lead / QA Lead
  📁 Lưu tại `docs/api/API_Naming_Convention.md`

---
