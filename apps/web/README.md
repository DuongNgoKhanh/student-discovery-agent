# SDA Frontend

Frontend template cho **Student Discovery Agent (SDA)**, chứa cả UI và Product API (`/api/v1`, Drizzle + PostgreSQL, S3/MinIO).

## Tech stack

- **Next.js 15** (App Router) + **TypeScript** strict
- **Tailwind CSS** + **shadcn/ui**
- **TanStack Query** (server-state) · **React Hook Form + Zod** (form)
- **openapi-typescript** (sinh type từ OpenAPI của BE)
- **Vitest** + Testing Library · ESLint + Prettier + Husky + lint-staged

## Kiến trúc chính

- **Auth**: token lưu ở **httpOnly cookie**; browser gọi same-origin Product API `/api/v1/*` (route handlers trong `src/app/api/v1`), không còn proxy BFF.
- `src/middleware.ts` gác `/dashboard/*` và `/admin/*` theo cookie + flag `admin` trong JWT.
- **Feature theo domain**: code client chia theo domain trong `src/features/<domain>` (`api/hooks/schemas/types` + `index.ts` là public surface); code chỉ chạy server nằm ở `src/server/<domain>` và import `server-only`.

Xem chi tiết quy ước trong [`docs/`](./docs/README.md).

## Cấu trúc thư mục

```
src/
├─ app/              # App Router: (auth) (app) (admin) + api/v1
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

## Docker và migration

Chạy từ thư mục gốc repo bằng `compose.yaml` (build context là `apps/web`, contracts qua `additional_contexts`):

```bash
docker compose up -d --build web db
docker compose --profile tools run --rm product-migrate   # Drizzle migrations; pnpm db:migrate khi chạy local
```

## Convention

- Commit: `<type>(scope): subject` — xem [`.github/commit_guide.instructions.md`](./.github/commit_guide.instructions.md).
- Trước khi mở PR: chạy `pnpm lint && pnpm typecheck && pnpm test`, đối chiếu [`docs/07_PR_Review_Checklist.md`](./docs/07_PR_Review_Checklist.md).
