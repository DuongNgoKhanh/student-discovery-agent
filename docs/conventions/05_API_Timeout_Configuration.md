# ⏱️ Quy định cấu hình thời gian Timeout cho API

## 🎯 Mục tiêu
- Đảm bảo hệ thống phản hồi đúng thời gian mong đợi
- Tránh treo hệ thống, kẹt tài nguyên do request quá lâu
- Tăng khả năng quan sát (observability) và kiểm soát lỗi
- Cải thiện trải nghiệm người dùng và tính ổn định hệ thống

---

## 🔍 Định nghĩa các tầng áp dụng Timeout

| Tầng hệ thống          | Mô tả                                    |
|------------------------|-------------------------------------------|
| Frontend               | Web/Mobile App, Portal, POS UI            |
| Backend                | API Gateway, BFF, dịch vụ nghiệp vụ       |
| Internal Service       | Microservice, hệ thống nội bộ liên thông  |
| External Call          | API từ bên thứ ba (đối tác, hệ sinh thái) |
| Database / Cache       | Kết nối DB, Redis, Search Engine          |

---

## ✅ 1. Luôn đặt Timeout cho tất cả các tầng

- Bất kỳ HTTP/gRPC/DB call... đều phải có timeout rõ ràng.
- ❌ Không được để gọi API nội bộ hoặc bên thứ 3 **vô thời hạn**.

---

## ✅ 2. Timeout theo vai trò/tính chất API


| Loại API                        | Timeout khuyến nghị   | Ghi chú                                      |
|----------------------------------|------------------------|-----------------------------------------------|
| Truy vấn đơn giản (GET)         | 100ms – 1s             | Ưu tiên cache nếu có thể                     |
| Ghi dữ liệu (POST/PUT)          | 300ms – 2s             | Không nên blocking quá lâu                   |
| Tạo job / trigger task          | 500ms – 2s             | Ưu tiên dùng queue thay vì blocking          |
| Upload file / xử lý ảnh         | 5s – 10s               | Giới hạn dung lượng upload và xử lý song song|
| Webhook callback                | ≤ 3s                   | Phải retry được từ phía gọi lại             |
| Nội bộ (microservice call)      | 200ms – 1s             | Gọi lồng nhau cần circuit breaker           |
| Batch API / async processing    | 10s – 30s hoặc dùng queue | Trả về job_id để xử lý bất đồng bộ          |
| Tác vụ AI/OCR/ML                | 20s+ (nên queue)      | Hạn chế blocking sync call                   |

---

## ✅ 3. Timeout phải tương thích với hệ thống Retry

- Tổng thời gian retry không được vượt quá timeout của tầng gọi phía trên.
- Ví dụ:
  - Frontend timeout = 5s  
  - Internal service retry = 1.5s × 2 lần → tổng 3s (✅)

---

## ✅ 4. Ghi log tất cả các request bị timeout

Thông tin cần log:
- Endpoint gọi
- Thời gian xử lý thực tế
- Thời gian timeout cấu hình
- `request_id` hoặc `trace_id`
- Client IP / `user_id` nếu có

> 🎯 Giúp alert kịp thời, phân tích bottleneck hệ thống.  

---

## ✅ 5. Timeout phải có khả năng cấu hình

- ❌ Không hardcode trong code
- ✅ Dùng config động qua biến môi trường, config server...
  
Ví dụ:
```env
API_TIMEOUT_PAYMENT=2000 # ms
```

## ✅ 6. Phản hồi rõ ràng khi timeout xảy ra

Ví dụ response chuẩn:
```json
{
  "success": false,
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "The request timed out after 2000ms.",
    "retryable": true
  },
  "meta": {
    "timestamp": "2025-06-21T12:30:45Z"
  }
}
```

## ✅ 7. Giao tiếp timeout giữa các service theo chuẩn
- Dùng chuẩn cancellation theo ngôn ngữ:
  - JavaScript: `AbortController`
  - .NET: `CancellationToken`
- Truyền timeout qua HTTP header:
  
```http
X-Request-Timeout: 2000
```
---

## 🚫 Những lỗi phổ biến cần tránh

| ❌ Anti-pattern                       | ✅ Thực hành tốt hơn                         |
|--------------------------------------|----------------------------------------------|
| Không đặt timeout                    | Luôn có timeout phù hợp từng loại API        |
| Retry vô hạn                         | Giới hạn số lần retry + timeout hợp lý|
| Hardcode timeout                     | Dùng config động, dễ thay đổi                |
| Blocking lâu phía frontend        | Dùng queue + xử lý bất đồng bộ           |

---

## 💡 Ví dụ Node.js: cấu hình timeout

```js
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 2000); // 2s

fetch("https://api.service.com", { signal: controller.signal })
  .then(res => res.json())
  .catch(err => {
    if (err.name === 'AbortError') {
      console.error('Request timed out!');
    }
  });
```

---

## ✅ Checklist review Timeout

| Tiêu chí kiểm tra                             | Bắt buộc | Ghi chú |
|-----------------------------------------------|----------|---------|
| Có timeout cho mọi HTTP/gRPC/DB call          | ✅       | Không được để mặc định hệ thống |
| Timeout tương thích với logic retry           | ✅       | Tổng retry time không vượt timeout phía trên |
| Có logging đầy đủ khi timeout xảy ra          | ✅       | Bao gồm trace_id, thời gian xử lý |
| Không hardcode timeout                        | ✅       | Dùng config file hoặc env variable |
| Có response rõ ràng khi timeout               | ✅       | Mã lỗi, message, retryable |
| Dùng cancellation đúng với ngôn ngữ lập trình | ✅       | Tùy ngôn ngữ: AbortController, Context, Token |

---

## 📌 Kết luận

Việc cấu hình timeout đúng chuẩn giúp:
- Tránh lãng phí tài nguyên
- Dễ dàng kiểm soát lỗi và cảnh báo
- Nâng cao độ tin cậy và trải nghiệm người dùng

📌 **Tài liệu này áp dụng bắt buộc cho toàn bộ hệ thống API nội bộ ISC.**  
Phải được review kỹ trước khi deploy hoặc release chính thức.

---
