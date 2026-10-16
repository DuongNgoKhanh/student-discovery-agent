# ✨ CODING_CONVENTIONS.md – Chuẩn viết code ISC (.NET ưu tiên)

Tài liệu quy định chuẩn viết code cho toàn bộ thành viên trong team phát triển dự án ISC.  
Ngôn ngữ chính: **.NET Core**, tuy nhiên nguyên tắc mang tính **ngôn ngữ-độc lập**.

---

## 📌 1. Nguyên tắc chung

| Nguyên tắc                  | Giải thích ngắn gọn                                         |
|-----------------------------|--------------------------------------------------------------|
| ✅ Nhất quán                | Cùng team nên cùng cách đặt tên, indent, comment             |
| ✅ Dễ đọc – dễ hiểu         | Ưu tiên rõ ràng hơn ngắn gọn, dễ review                      |
| ✅ Không lặp lại code       | Dùng hàm/helper tái sử dụng                                 |
| ✅ 1 hàm = 1 chức năng      | Tránh viết hàm đa mục đích                                 |
| ✅ Không hardcode           | Dùng config/const/enum/DB thay vì số liệu cứng               |
| ✅ Luôn có xử lý lỗi        | Không để app crash hoặc báo lỗi chung chung                 |

---

## 📁 2. Quy ước đặt tên

| Thành phần      | Quy ước       | Ví dụ                         |
|------------------|----------------|-------------------------------|
| Biến toàn cục             | `camelCase`    | `isActive`, `totalAmount`     |
| Biến private              | `_camelCase`   | `_userRepository` |
| Hàm              | `PascalCase`   | `CalculateTotal()`, `GetUser()` |
| Class            | `PascalCase`   | `UserService`, `TokenHandler` |
| Const            | `ALL_CAPS`   | `DEFAULT_TIMEOUT` |
| Enum     | `PascalCase`   | `UserType.Admin` |
| Interface        | `I` + `PascalCase`   | `IUserService`, `IMiddleware` |
| Tên file `.cs`   | Trùng tên class| `LoginController.cs`          |

---

## 🧱 3. Quy ước thư mục

### 📂 3.1. Thư mục code `src/`

| Thư mục         | Mục đích                                      |
|------------------|-----------------------------------------------|
| `Controllers/`   | Xử lý route & HTTP                           |
| `Services/`      | Xử lý logic nghiệp vụ                        |
| `Repositories/`  | Giao tiếp DB, Redis, Kafka                   |
| `Models/`        | DTO, schema, entity                          |
| `Configs/`       | Cấu hình hệ thống (auth, logging, timeout...)|
| `Middlewares/`   | Can thiệp request, response                  |
| `Utils/Helpers/` | Hàm tiện ích tái sử dụng                    |
| `Tests/`         | Unit test, integration test                  |

### 📚 3.2. Thư mục tài liệu `docs/`

| Thư mục          | Mục đích cụ thể                                   |
|------------------|----------------------------------------------------|
| `api/`           | Guideline response, error, OpenAPI YAML           |
| `setup/`         | Cách cài môi trường local/dev                    |
| `architecture/`  | Sơ đồ hệ thống, ADR (architecture decision)       |
| `deployment/`    | CI/CD, dockerfile, helm chart, triển khai script |

---

## 🎨 4. Format code

- ✅ 4 space indent
- ✅ Có khoảng trắng sau dấu phẩy, toán tử, và giữa các khối logic
- ✅ Mỗi file chỉ nên chứa 1 class chính
- ❌ Không dùng cả tab và space
- ✅ Dùng `dotnet format` để đảm bảo format nhất quán
- ✅ Sắp xếp theo thứ tự: `Fields → Constructors → Properties → Methods`
- ✅ Dùng `regions` để nhóm logic nếu file dài
- ✅ `{` xuống dòng (C# style)

---

## ✍️ 5. Comment & Documentation

- ✅ Comment các logic phức tạp
- ✅ Dùng XML-doc cho public method

```csharp
/// <summary>
/// Tính tổng đơn hàng theo loại
/// </summary>
public decimal CalculateTotal(List<Order> orders) { ... }
```

- ❌ Tránh comment dư thừa kiểu:
```csharp
// Tăng biến i lên 1
i++;
```

---

## 🛡 6. Bảo mật & Chất lượng

| Nội dung                 | Lưu ý                                               |
|--------------------------|-----------------------------------------------------|
| ❌ Không log dữ liệu nhạy cảm | Ví dụ: email, token, password                  |
| ✅ Validate input đầy đủ | Không tin tưởng FE gửi                            |
| ❌ Không throw exception thô | Gói lại, log rõ nội bộ                         |
| ✅ Dùng middleware handle error | Trả `trace_id`, log chi tiết nếu cần         |

---

## 🛌 7. Mẫu commit message chuẩn Git

```bash
feat(auth): thêm xác thực OAuth2 cho Google
fix(user): sửa lỗi không load avatar khi null
refactor(session): gom nhỏ logic khởi tạo session
```

---

## 🧠 8. Nguyên tắc thiết kế
- ✅ Áp dụng `SOLID, DRY, KISS, YAGNI`
- ✅ Ưu tiên `interface` thay vì class cụ thể
- ✅ Dùng `Dependency Injection`

---

## 💪 9. Testing

- ✅ Mỗi service nên có ít nhất 1 unit test
- ✅ Dùng mock repository
- ✅ Test cả success và fail case

---

## 📤 10. Chuẩn hóa phản hồi API

### ✅ Tham khảo tài liệu `API_Response_Guideline.md`

---

## 📌 SUMMARY

- ✅Áp dụng cho toàn bộ các team nội bộ tại FPT, ưu tiên các dự án sử dụng .NET 6+ và triển khai CI/CD, DevSecOps.
- ✅ Mọi project backend đều cần `README.md`, `ERROR_CODES.md`, `API_RESPONSE_GUIDELINE.md`
- ✅ Tạo repo backend: phải có `docs/` để QA và Dev follow
- ✅ 🌟**Tài liệu này cần được đính kèm trong repo dưới tên `CODING_CONVENTIONS.md` để các thành viên tuân thủ.**

---
