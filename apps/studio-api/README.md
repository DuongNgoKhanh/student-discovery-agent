# Studio API

Backend TypeScript độc lập dùng Hono/Node, cổng mặc định 3001. Chứa Product auth/users/admin/versions, storage và migration; Studio/Agent domain mới chưa triển khai. Không phụ thuộc Next/React hoặc source của app khác.

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

Source: `src/modules/{auth,users,versions}` giữ service/repository/controller; `src/infrastructure/{db,storage}` giữ adapter; `src/http` giữ envelope/errors/handler. Admin users thuộc domain users. `migrations/` giữ nguyên SQL/journal; build/start không tự migrate.

Browser truy cập cùng origin qua gateway; public origin nằm trong `PRODUCT_BASE_URL`. SSR UI gọi API nội bộ, không chia sẻ JWT secret. Compose đọc env ở root repo, không tự nạp file `.env` tại app này. Xem [root README](../../README.md), [API conventions](docs/README.md) và [runbook](../../docs/operations/studio-runtime-cutover.md).
