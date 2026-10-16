# 🔢 TL_QA_REVIEW_CHECKLIST.md – Checklist đánh giá API ISC

> Dành cho PM/TL/QA/Reviewer để đánh giá tính đúng đủ, nhất quán và tuân thủ chuẩn khi review API trong dự án nội bộ ISC.

---

## ✅ 1. Kiểm tra file YAML/OpenAPI

- [ ] Mỗi service API phải có file .yaml, định nghĩa API theo chuẩn **OpenAPI 3.0**
- [ ] Tên file rõ ràng theo chức năng: `api-name.yaml`
- [ ] Đầy đủ thông tin path, method, request, response
- [ ] Mã lỗi trong response dùng đúng theo `04_Error_Code_Guideline.md`
- [ ] Đặt file trong thư mục `docs/api/openapi/`

---

## 📊 2. Kiểm tra cấu trúc phản hồi API

- [ ] Phản hồi **thành công**:
  - `success = true`
  - data: object, array hoặc null nếu không có payload
  - error: null
  - meta: metadata thêm cho trace & monitoring
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

- [ ] Phản hồi **lỗi nghiệp vụ**:
  - `success = false`
  - Có đủ `code`, `message`, `traceId`
  - Trả HTTP `200`

- [ ] Lỗi **kỹ thuật**:
  - `success = false`
  - Có đủ `code`, `message`, `traceId`
  - Trả HTTP 4xx/5xx
  - Do middleware handle

- [ ] ✅ Tất cả phản hồi API đều có các trường `success', 'data', 'meta.request_id', 'meta.trace_id', 'meta.timestamp'

---

## 🔍 3. Kiểm tra logic & mã lỗi sử dụng

- [ ] Mã lỗi dùng đúng theo `04_Error_Code_Guideline.md`
- [ ] Lỗi nghiệp vụ có prefix: `INVALID_`, `MISSING_`, `DUPLICATE_`, ...
- [ ] Lỗi kỹ thuật: `SYS_`, `DB_`, `REQ_`, `EXT_`, `MQ_`, `AUTH_`...
- [ ] Khi thêm mã lỗi mới cần tuân thủ checklist trong `04_Error_Code_Guideline.md`
---

## 🌐 4. Kiểm tra tài liệu và cấu trúc repo

- [ ] Repo backend có thư mục `docs/api/`
- [ ] Có đầy đủ các file chuẩn:
  - `02_API_Naming_Convention.md`
  - `03_API_Response_Guideline.md`
  - `04_Error_Code_Guideline.md`
  - `openapi/*.yaml`. 
- [ ] Tài liệu liên kết trong `README.md` hoặc `api-guideline.md`

---

## 🚀 5. Kiểm tra bổ sung (tùy chọn)

- [ ] Có file collection test Postman / Insomnia đính kèm?
- [ ] API đã được test qua Swagger UI hoặc mock test?
- [ ] Sử dụng tool auto gen doc (Swashbuckle, NSwag, ...)?

---

📌 **Checklist này nên được sử dụng trong mỗi lần review pull request có thay đổi API logic, phản hồi, hoặc bổ sung tài liệu liên quan.**
