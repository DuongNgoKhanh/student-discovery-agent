# Student Discovery Agent (SDA)

**SDA** là dự án trợ lý AI tư vấn hướng nghiệp cho học sinh THPT lớp 10–12 tại Đồng bằng sông Cửu Long, phục vụ **IHRD GenZ Career Agent**. Sản phẩm hướng đến trải nghiệm chat trên thiết bị di động, tích hợp vào `ihrd.vn` và tư vấn trong mạng lưới 12 trường liên kết.

Repository gồm ba ứng dụng độc lập:

| Ứng dụng | Trách nhiệm | Công nghệ |
| --- | --- | --- |
| `apps/web-ui` | Giao diện, render SSR, HTTP client | Next.js 15 / React 19 |
| `apps/studio-api` | Backend Studio/Product: auth, users, admin, versions, storage, migrations | TypeScript / Hono / Node |
| `apps/agent-runtime` | Tầng thực thi Agent | Python 3.11 / FastAPI |

Hiện auth, quản lý người dùng và avatar/download đã có scaffold. Studio editor, luồng tư vấn và kết nối thực thi API → runtime chưa được triển khai.

## Cấu trúc repository

```text
student-discovery-agent/
├── apps/
│   ├── web-ui/          # UI, không giữ DB/JWT signing key/S3 credentials
│   ├── studio-api/      # Product API, nghiệp vụ, DB/storage, migration SQL
│   └── agent-runtime/   # Agent execution, env/dependencies/image riêng
├── contracts/           # OpenAPI chung; mỗi app tự sinh DTO
├── infra/nginx/         # Gateway cùng origin cho browser
├── docs/
│   ├── conventions/     # Quy ước API dùng chung
│   └── operations/      # Runbook cutover/rollback
├── docker-compose.yaml
└── .github/
```

Browser gọi `/api/*` và `/download` cùng origin. Gateway chuyển các đường dẫn này tới `studio-api:3001`, còn các trang tới `web-ui:3000`. UI SSR lấy session đã xác minh qua HTTP nội bộ; Python runtime ở cổng 8000 nội bộ, chưa có API thực thi công khai.

## Chạy bằng Docker Compose

Cần Docker Compose v2 hỗ trợ `build.additional_contexts` và `env_file.required`. Đặt biến trong shell hoặc `.env` **ở root repo**: `DATABASE_URL`, `SECRET_KEY`, `ADMIN_PASSWORD`, `S3_*`, `MINIO_PUBLIC_BUCKET_NAME`, `PRODUCT_BASE_URL`, `POSTGRES_PASSWORD`. Xem [API env example](apps/studio-api/.env.example). Defaults trong Compose chỉ dùng local; admin không có mật khẩu mặc định. Các file `.env` riêng của UI/API không được Compose đọc. Runtime đọc `apps/agent-runtime/.env` nếu có.

```bash
docker compose -f docker-compose.yaml up -d --build
# Chỉ chạy thủ công cho DB mới hoặc migration còn thiếu:
docker compose -f docker-compose.yaml --profile tools run --rm studio-api-migrate
# Tạo bucket và public download policy cho bucket avatar:
docker compose -f docker-compose.yaml --profile tools run --rm minio-init
curl http://localhost:3000/healthz
curl http://localhost:3000/api/health
```

Gateway publish `localhost:3000`; UI/API/runtime không publish port host. MinIO console local ở `127.0.0.1:9001`. Migration không tự chạy khi build/start và không thay đổi SQL/journal vì đổi thư mục. Giữ nguyên volume, DB URL và JWT secret khi chuyển từ service cũ. `minio-init` dùng client `mc` có sẵn trong image MinIO được pin cùng server.

UI chỉ nhận `STUDIO_API_ORIGIN=http://studio-api:3001`; API nhận DB/auth/storage env; runtime không nhận credential Product. `PRODUCT_BASE_URL` phải là origin công khai của gateway để avatar URL đúng. Build sau proxy có thể truyền `http_proxy`/`https_proxy` từ shell làm build args.

## Chạy trực tiếp và kiểm thử

Node 22, pnpm 9.15.9; chạy UI và API ở hai terminal:

```bash
# UI: copy .env.example thành .env.local nếu cần chỉnh API origin.
cd apps/web-ui
pnpm install && pnpm gen:api
pnpm dev                       # :3000; dev rewrite /api/* và /download tới API
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

```bash
cd apps/studio-api
pnpm install && pnpm gen:api
# Copy .env.example thành .env, điền cấu hình thật ở local.
# Node/tsx không tự đọc .env; nạp rõ file bằng Node 22:
node --env-file=.env --import tsx --watch src/main.ts  # :3001
# Hoặc export env từ shell rồi chạy pnpm dev.
pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm test
pnpm test:integration          # cần Docker, DB/MinIO fixture tạm
pnpm build
node --env-file=.env dist/main.js
# Migration thủ công khi cần: pnpm exec tsx --env-file=.env src/infrastructure/db/migrate.ts
```

`pnpm start` của UI ở production cần gateway để định tuyến browser API; rewrite chỉ bật trong dev. Liveness UI/API build và chạy không cần DB/JWT/S3. Trang bảo vệ cần API session: 401 chuyển login, API/network lỗi hiển thị trạng thái không khả dụng.

```bash
cd apps/agent-runtime
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest
uvicorn agent_runtime.main:app --port 8000
```

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Contracts](contracts/README.md) | OpenAPI và trạng thái endpoint |
| [Mã lỗi](contracts/error_codes.md) | Danh mục lỗi |
| [Quy ước chung](docs/conventions/README.md) | API naming/response/error/timeout |
| [UI docs](apps/web-ui/docs/README.md), [API docs](apps/studio-api/docs/README.md), [Runtime docs](apps/agent-runtime/docs/01_Coding_Convention.md) | Quy ước theo ứng dụng |
| [Runbook](docs/operations/studio-runtime-cutover.md) | Chuyển service và rollback |

Commit theo dạng `<type>(scope): subject`, xem [hướng dẫn commit](.github/commit_guide.instructions.md).

## Giấy phép

Dự án sử dụng [MIT License](LICENSE).
