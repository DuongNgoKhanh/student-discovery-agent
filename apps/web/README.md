# SDA Frontend

Frontend template cho **Student Discovery Agent (SDA)**, ghép đôi với backend FastAPI (`../sda-backend`).

## Tech stack

- **Next.js 15** (App Router) + **TypeScript** strict
- **Tailwind CSS** + **shadcn/ui**
- **TanStack Query** (server-state) · **React Hook Form + Zod** (form)
- **openapi-typescript** (sinh type từ OpenAPI của BE)
- **Vitest** + Testing Library · ESLint + Prettier + Husky + lint-staged

## Kiến trúc chính

- **Auth BFF-lite**: token lưu ở **httpOnly cookie**. Browser luôn gọi same-origin:
  - `/api/auth/*` — login/register/refresh/logout (set/xoá cookie)
  - `/api/bff/[...path]` — proxy tới FastAPI, gắn Bearer, tự refresh khi 401
- `src/middleware.ts` gác `/dashboard/*` và `/admin/*` theo cookie + flag `admin` trong JWT.
- **Feature-module**: mỗi feature là 1 module độc lập trong `src/modules/<feature>` (`api/components/hooks/schemas/types` + `index.ts` là public surface).

Xem chi tiết quy ước trong [`templates/`](./templates/README.md).

## Cấu trúc thư mục

```
src/
├─ app/              # App Router: (auth) (app) (admin) + api/{auth,bff}
├─ modules/          # feature-module: users, admin, ...
├─ components/       # ui (shadcn) + shared
├─ lib/              # api, auth, query, utils
├─ types/api/        # type sinh từ OpenAPI (pnpm gen:api)
├─ config/           # env (validate bằng zod)
└─ middleware.ts
```

## Chạy dev

```bash
pnpm install
cp .env.example .env.local     # sửa API_BASE_URL nếu cần
pnpm gen:api                   # sinh type từ ../../contracts/openapi/public/*.yaml
pnpm dev                       # http://localhost:3000
```

Backend chạy riêng (docker expose cổng 8081) → `.env.local` để `API_BASE_URL=http://localhost:8081/api/v1`.

## Scripts

| Lệnh | Việc |
|---|---|
| `pnpm dev` / `build` / `start` | Next dev / build / production |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `format` | ESLint / Prettier |
| `pnpm test` / `test:watch` | Vitest |
| `pnpm gen:api` | Sinh lại type TS từ OpenAPI backend |

## Chạy bằng Docker (ghép mạng backend)

```bash
# 1) Khởi động backend trước (tạo network "sda-network")
cd ../sda-backend && docker compose -f docker-compose.local.yml up -d

# 2) Khởi động frontend
cd apps/web && docker compose -f docker-compose.local.yml up --build
```

## Convention

- Commit: `<type>(scope): subject` — xem [`.github/commit_guide.instructions.md`](./.github/commit_guide.instructions.md).
- Trước khi mở PR: chạy `pnpm lint && pnpm typecheck && pnpm test`, đối chiếu [`templates/07_PR_Review_Checklist.md`](./templates/07_PR_Review_Checklist.md).
