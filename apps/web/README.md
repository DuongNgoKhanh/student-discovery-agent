# SDA Frontend

Frontend template cho **Student Discovery Agent (SDA)**, ghép đôi với backend FastAPI (Python, ở thư mục gốc repo cho đến khi được chuyển).

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
- **Feature theo domain**: code client chia theo domain trong `src/features/<domain>` (`api/hooks/schemas/types` + `index.ts` là public surface); code chỉ chạy server nằm ở `src/server/<domain>` và import `server-only`.

Xem chi tiết quy ước trong [`templates/`](./templates/README.md).

## Cấu trúc thư mục

```
src/
├─ app/              # App Router: (auth) (app) (admin) + api/{auth,bff}
├─ features/         # code client theo domain: auth, users
├─ server/           # code chỉ chạy server (server-only): auth, ...
├─ components/       # ui (shadcn) + shared
├─ lib/              # helper thuần (client + server): api, auth, query, utils
├─ generated/api/    # type sinh từ OpenAPI (pnpm gen:api, không commit .d.ts)
├─ config/           # env (validate bằng zod)
└─ middleware.ts
```

## Chạy dev

```bash
pnpm install
cp .env.example .env.local
pnpm gen:api                   # sinh type từ ../../contracts/openapi/public/*.yaml
pnpm dev                       # http://localhost:3000
```


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
# Chạy từ thư mục gốc repo.
# 1) Khởi động backend trước (tạo network "sda-network")
docker compose -f docker-compose.local.yml up -d

# 2) Khởi động frontend
cd apps/web && docker compose -f docker-compose.local.yml up --build
```

## Convention

- Commit: `<type>(scope): subject` — xem [`.github/commit_guide.instructions.md`](./.github/commit_guide.instructions.md).
- Trước khi mở PR: chạy `pnpm lint && pnpm typecheck && pnpm test`, đối chiếu [`templates/07_PR_Review_Checklist.md`](./templates/07_PR_Review_Checklist.md).
