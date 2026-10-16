# Student Discovery Agent (SDA)

**SDA** là dự án trợ lý AI tư vấn hướng nghiệp cho học sinh THPT lớp 10–12 tại Đồng bằng sông Cửu Long, phục vụ **IHRD GenZ Career Agent**. Sản phẩm hướng đến trải nghiệm chat trên thiết bị di động, tích hợp vào `ihrd.vn` và tư vấn trong mạng lưới 12 trường liên kết.

Repository hiện chứa **Product web (Next.js, gồm Product API `/api/v1`)**, **agent-runtime (FastAPI)** và tài liệu thiết kế cho Agent cùng SDA Studio.

> **Trạng thái hiện tại:** bộ khung Product (xác thực, người dùng, quản trị, versions, avatar/download) chạy trên Next.js; `agent-runtime` là khung FastAPI cho tầng thực thi AI. Luồng tư vấn, Agent Harness và SDA Studio chưa hoàn thiện.

## Cấu trúc repository

```text
student-discovery-agent/
├── apps/
│   ├── web/             # Next.js 15: UI + Product API (/api/v1), Drizzle migrations, docs React/TS
│   └── agent-runtime/   # FastAPI (package agent_runtime), Dockerfile riêng, docs Python
├── contracts/           # OpenAPI công khai + mã lỗi (nguồn cho gen:api)
├── docs/
│   ├── conventions/     # Quy ước API dùng chung (naming/response/error/timeout)
│   └── operations/      # Runbook (cutover/rollback)
├── compose.yaml         # web, agent-runtime, db (PostgreSQL 16), minio; profile tools
└── .github/
```

Backend Python cũ ở root (`app/`, `main.py`, Neo4j/Graphiti/TaskIQ/Redis) đã được gỡ. Browser gọi
Product API cùng origin; không còn `API_BASE_URL`/BFF proxy.

## Chạy bằng Docker Compose

Cần Docker Compose v2. Cấu hình web/db/minio đặt trong biến shell hoặc file `.env` ở **root repo**
(compose interpolation, không commit): `DATABASE_URL`, `SECRET_KEY`, `ADMIN_PASSWORD`, `S3_*`,
`MINIO_PUBLIC_BUCKET_NAME`, `PRODUCT_BASE_URL`, `POSTGRES_PASSWORD` (xem `apps/web/.env.example`). Mặc định
là giá trị local-only (db/minio của compose). `apps/web/.env` KHÔNG được compose đọc; nó chỉ dành cho
`pnpm dev` ngoài Docker. `agent-runtime` đọc `apps/agent-runtime/.env` (tùy chọn).
Thiếu `SECRET_KEY` thì layout được bảo vệ trả 500 (lỗi cấu hình) thay vì redirect; admin login cần
`ADMIN_PASSWORD` (không có mật khẩu mặc định).

```bash
docker compose up -d --build            # web :3000, agent-runtime (nội bộ :8000), db, minio
docker compose --profile tools run --rm product-migrate   # migrate Product, chạy thủ công
docker compose --profile tools run --rm minio-init        # tạo bucket MinIO (tùy chọn)
curl http://localhost:3000/api/health
```

`agent-runtime` không publish port ra host và không nhận credential DB/JWT của Product.
Migration không bao giờ tự chạy khi khởi động. Build sau proxy: `http_proxy`/`https_proxy` trong shell
được truyền làm build args (không nằm trong image cuối).

## Chạy trực tiếp và kiểm thử

```bash
# Web (Node >=20, pnpm 9)
cd apps/web && pnpm install && pnpm gen:api && pnpm dev
pnpm lint && pnpm typecheck && pnpm test        # contracts:check, test:integration (cần Docker)

# Agent runtime (Python 3.11)
cd apps/agent-runtime && pip install -r requirements.txt && pip install -e . && pytest
uvicorn agent_runtime.main:app --port 8000
```

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [User API](contracts/openapi/public/user-api.yaml), [Admin API](contracts/openapi/public/admin-api.yaml) | Hợp đồng API |
| [Mã lỗi](contracts/error_codes.md) | Danh mục lỗi |
| [Quy ước chung](docs/conventions/README.md) | API naming/response/error/timeout |
| [Docs web](apps/web/docs/README.md), [Docs runtime](apps/agent-runtime/docs/01_Coding_Convention.md) | Quy ước theo ứng dụng |
| [Runbook cutover](docs/operations/studio-runtime-cutover.md) | Migrate, cutover, rollback |

Commit theo dạng `<type>(scope): subject`, chi tiết trong [hướng dẫn commit](.github/commit_guide.instructions.md).

## Giấy phép

Dự án sử dụng [MIT License](LICENSE).
