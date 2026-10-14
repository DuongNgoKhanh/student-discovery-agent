# ĐẶC TẢ CHI TIẾT CONTRACT BOUNDARY & FIXTURES (G0-03 / DEC-07)

Tài liệu này chi tiết hóa các Contract headers, schemas và dữ liệu mẫu (fixtures) dùng chung giữa tầng **TypeScript Product/Studio Layer** và tầng **Python Execution Layer**, phục vụ nghiệm thu **AT-19** và **AT-20**.

---

## 1. Giao Thức Xác Thực & Trao Đổi Ngữ Cảnh (Auth & Context Contract)

### 1.1. Client-to-BFF Contract (Browser $\rightarrow$ TypeScript)

* **Cookie Header:** `Cookie: sda_owner=<SIGNED_OPAQUE_TOKEN>`
* **Cookie Attributes:**
  * `HttpOnly`: true (Ngăn XSS truy cập token)
  * `Secure`: true (Chỉ truyền qua HTTPS trên Production)
  * `SameSite`: Lax
  * `Path`: `/api/v1`
  * `Max-Age`: `2592000` (30 ngày)
* **Payload bên trong Token đã ký (HMAC-SHA256):**
  ```json
  {
    "owner_id": "own_01J9K3Z5P08F9V2E3M4X1N8B2Q",
    "iat": 1728810000,
    "exp": 1731402000
  }
  ```

---

### 1.2. Inter-Service Contract (TypeScript BFF $\rightarrow$ Python FastAPI)

Mọi HTTP request từ TS chuyển tiếp sang Python Execution API bắt buộc phải kèm bộ Header nội bộ:

```http
POST /api/v1/internal/conversations/conv_01J9K4A1B2C3D4E5F6G7H8J9K0/turns HTTP/1.1
Host: execution-engine:8000
Content-Type: application/json
X-Internal-Caller: sda-product-bff
X-Correlation-Id: req_01J9K4XYZ987654321
X-Idempotency-Key: idem_01J9K4TURN123456
X-Caller-Context: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjYWxsZXJfdHlwZSI6InN0dWRlbnQiLCJvd25lcl9pZCI6Im93bl8wMUo5SzNaNVAwOEY5VjJFM000WDFOOEIyUSIsInVzZXJfaWQiOm51bGwsInJvbGVzIjpbXX0...
```

#### Cấu trúc Payload của `X-Caller-Context` (JWT / Signed Payload):
```json
{
  "caller_type": "student", // "student" | "admin" | "system"
  "owner_id": "own_01J9K3Z5P08F9V2E3M4X1N8B2Q", // Bắt buộc nếu caller_type là student
  "user_id": null, // User ID của Admin (nếu caller_type là admin)
  "roles": [], // e.g. ["admin", "experience_editor"]
  "permissions": [
    "conversation.turn.write",
    "activity.read"
  ],
  "iat": 1728810005,
  "exp": 1728810065 // Token nội bộ có TTL ngắn (60 giây)
}
```

---

## 2. Release Delivery & Pinning Contract (Studio $\rightarrow$ Execution)

### 2.1. Contract Đóng Gói Release Snapshot (`ExperienceReleasePayload`)

Khi một bản Release được kích hoạt hoặc đồng bộ sang Execution Engine, payload cấu hình có cấu trúc bất biến:

```json
{
  "experience_id": "exp_personality_v1",
  "release_id": "rel_01J9K5R8T7W6Y5Z4A3B2C1D0EF",
  "version": "1.2.0",
  "content_hash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "schema_version": "2026-10.1",
  "engine_target": "career-assessment-v1",
  "environment": "production",
  "published_at": "2026-10-13T10:00:00Z",
  "published_by": "usr_admin_001",
  "configuration": {
    "title": "Trắc nghiệm Tính cách & Hướng nghiệp ĐBSCL",
    "question_catalog": [
      {
        "id": "q1",
        "dimension": "R_REALISTIC",
        "prompt": "Bạn có thích tự tay sửa chữa dụng cụ hoặc máy móc không?",
        "options": [
          { "value": "A", "label": "Rất thích", "score_vector": { "R": 2 } },
          { "value": "B", "label": "Bình thường", "score_vector": { "R": 1 } },
          { "value": "C", "label": "Không thích", "score_vector": { "R": 0 } }
        ]
      }
    ],
    "scoring_policy": {
      "dimensions": ["R", "I", "A", "S", "E", "C"],
      "classification_algorithm": "holland_dominant_v2"
    }
  }
}
```

### 2.2. Contract Pin Release vào Activity

```json
{
  "activity_id": "act_01J9K6AABBCCDDEEFF00112233",
  "conversation_id": "conv_01J9K4A1B2C3D4E5F6G7H8J9K0",
  "owner_id": "own_01J9K3Z5P08F9V2E3M4X1N8B2Q",
  "activity_type": "personality_assessment",
  "pinned_release_id": "rel_01J9K5R8T7W6Y5Z4A3B2C1D0EF",
  "pinned_content_hash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  "status": "in_progress",
  "current_turn": 3,
  "answers_collected": 3,
  "created_at": "2026-10-13T10:15:00Z"
}
```

---

## 3. Fixtures Dùng Chung Cho Kiểm Thử Nghiệm Thu (AT-19 & AT-20)

### 3.1. Fixtures AT-19: Kiểm Tra Quyền Sở Hữu (Ownership & Boundary)

```json
[
  {
    "scenario_id": "FIXTURE_AT19_01_TAMPERED_COOKIE",
    "description": "Cookie bị can thiệp chữ ký nhằm mạo danh owner",
    "request": {
      "path": "/api/v1/conversations/conv_01J9K4A1B2C3D4E5F6G7H8J9K0",
      "headers": {
        "Cookie": "sda_owner=tampered.unsigned.owner_01J9K3Z5P08F9V2E3M4X1N8B2Q"
      }
    },
    "expected_response": {
      "status_code": 401,
      "body": {
        "error_code": "AUTH_INVALID_CREDENTIAL",
        "message": "Thông tin phiên không hợp lệ hoặc đã hết hạn"
      }
    }
  },
  {
    "scenario_id": "FIXTURE_AT19_02_CROSS_OWNER_ACCESS",
    "description": "Owner hợp lệ A cố tình đọc dữ liệu của Owner B",
    "request": {
      "path": "/api/v1/conversations/conv_OF_OWNER_B",
      "headers": {
        "Cookie": "sda_owner=VALID_TOKEN_OF_OWNER_A"
      }
    },
    "expected_response": {
      "status_code": 403,
      "body": {
        "error_code": "FORBIDDEN_RESOURCE_ACCESS",
        "message": "Bạn không có quyền truy cập hội thoại này"
      }
    }
  },
  {
    "scenario_id": "FIXTURE_AT19_03_DIRECT_PYTHON_BYPASS",
    "description": "Gọi trực tiếp vào Engine Python mà không có X-Internal-Caller",
    "request": {
      "path": "http://python-engine:8000/api/v1/conversations/conv_01J9K4A1B2C3D4E5F6G7H8J9K0/turns",
      "headers": {
        "User-Agent": "curl/7.88.1"
      }
    },
    "expected_response": {
      "status_code": 403,
      "body": {
        "error_code": "CALLER_NOT_AUTHORIZED",
        "message": "Truy cập trực tiếp bị từ chối"
      }
    }
  }
]
```

### 3.2. Fixtures AT-20: Release Delivery & Pinning Độc Lập

```json
[
  {
    "scenario_id": "FIXTURE_AT20_01_RELEASE_PINNING",
    "description": "Phiên đang chạy tiếp tục dùng Release cũ sau khi Release mới được kích hoạt",
    "initial_state": {
      "active_release": "rel_v1_hashA",
      "conversation_1": {
        "id": "conv_pinned_v1",
        "pinned_release_id": "rel_v1_hashA",
        "turn": 2
      }
    },
    "trigger_event": {
      "action": "ACTIVATE_NEW_RELEASE",
      "new_release": "rel_v2_hashB"
    },
    "subsequent_action": {
      "path": "/api/v1/conversations/conv_pinned_v1/turns",
      "body": {
        "action": "answer",
        "question_id": "q2",
        "choice": "A"
      }
    },
    "expected_result": {
      "evaluated_against_release": "rel_v1_hashA",
      "next_question_from": "rel_v1_hashA",
      "switched_to_new_release": false
    }
  }
]
```

