# Studio API

Backend TypeScript độc lập dùng Hono/Node, cổng mặc định 3001. Chứa Product auth/users/admin/versions/experiences, storage và migration. Không phụ thuộc Next/React hoặc source của app khác.

```bash
pnpm install
pnpm gen:api
# Điền .env từ .env.example; Node/tsx cần nạp env rõ ràng:
node --env-file=.env --import tsx --watch src/main.ts
# Nếu env đã export: pnpm dev
pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm test
pnpm test:integration           # Docker fixtures PostgreSQL/MinIO tạm
pnpm build
node --env-file=.env dist/main.js
# Khi cần migration thủ công, dùng đúng operator DATABASE_URL:
pnpm exec tsx --env-file=.env src/infrastructure/db/migrate.ts
```

`createApp()` trong `src/app.ts` dựng router không listen hoặc kết nối DB. `src/main.ts` là Node entrypoint, đóng DB pool khi shutdown. `/api/health` là liveness không cần Product env. `/api/v1/auth/session` trả metadata đã xác minh `{userId,isAdmin}`, invalid/expired access trả 401, không set token/cookie mới.

### Experience Configuration & Immutable Releases (Task A-01, Module M-CFG)
- **Experiences & Drafts**: `GET|POST /api/v1/admin/experiences`, `GET|PATCH /api/v1/admin/experiences/:id`, `GET|PUT /api/v1/admin/experiences/:id/draft`. Hỗ trợ lưu draft chưa hoàn chỉnh (incomplete JSON), từ chối malformed JSON / duplicate keys / non-finite numbers (400 `INVALID_REQUEST`), kiểm soát xung đột ghi đồng thời bằng optimistic locking (`expected_revision`), tính mã băm canonical sha256 chuẩn hóa (RFC 8785).
- **Immutable Releases**: `POST|GET /api/v1/admin/experiences/:id/releases`, `GET /api/v1/admin/experience-releases/:release_id`. Kiểm tra publish gate cấu trúc definition document (`schema_version: '1.0'`), đóng băng snapshot không thể sửa đổi hay xóa (trigger DB `prevent_experience_release_mutation` cấm `UPDATE`/`DELETE`). Publish hiện **fail closed**: chưa có dịch vụ validation/evaluation report (A-02/C-05) nên `validation_id`/`evaluation_id` không kiểm chứng được và publish trả 422 `PUBLISH_GATE_FAILED` (`report_unverified`); gắn verifier thật qua `setPublishReportVerifier` trong `experiences.reports.ts`. Mỗi thao tác ghi idempotent chạy trong một transaction có advisory lock theo (scope, key), nên retry/đồng thời cùng key chỉ ghi một lần.
- **Idempotency Replay**: Mọi thao tác ghi (`POST`, `PUT`, `PATCH`) yêu cầu `idempotency_key` và tự động replay kết quả ban đầu ngay cả khi revision đã tăng, hoặc trả 409 `IDEMPOTENCY_KEY_COLLISION` nếu key bị dùng lại với payload khác.

Source: `src/modules/{auth,users,versions,experiences}` giữ service/repository/controller; `src/infrastructure/{db,storage}` giữ adapter; `src/http` giữ envelope/errors/handler. Admin users thuộc domain users. `migrations/` giữ nguyên SQL/journal; build/start không tự migrate.

Browser truy cập cùng origin qua gateway; public origin nằm trong `PRODUCT_BASE_URL`. SSR UI gọi API nội bộ, không chia sẻ JWT secret. Compose đọc env ở root repo, không tự nạp file `.env` tại app này. Xem [root README](../../README.md), [API conventions](docs/README.md) và [runbook](../../docs/operations/studio-runtime-cutover.md).
