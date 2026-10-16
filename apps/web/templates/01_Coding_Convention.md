# 01 — Coding Convention (Frontend)

Quy ước code để cả team viết giống nhau, không phải bàn cãi mỗi module mới.

## 1. Đặt tên

| Đối tượng | Quy ước | Ví dụ |
|---|---|---|
| File / folder | `kebab-case` | `use-admin-users.ts`, `page-header.tsx` |
| React component | `PascalCase` | `PageHeader`, `LoginPage` |
| Hook | `useXxx` | `useMe`, `useLogin` |
| Biến / hàm | `camelCase` | `mapErrorMessage`, `queryKeys` |
| Type / Interface | `PascalCase` | `User`, `LoginInput`, `ButtonProps` |
| Hằng | `UPPER_SNAKE_CASE` | `MESSAGES`, `BFF` |
| Zod schema | `xxxSchema` + type infer | `loginSchema` → `type LoginInput` |

- Props interface: `<Component>Props` (vd `ButtonProps`).
- Query key luôn khai báo tập trung ở `src/lib/query/keys.ts`, không viết mảng key rải rác.

## 2. Cấu trúc thư mục feature-module

Mỗi feature là 1 module độc lập trong `src/modules/<feature>/`:

```
modules/users/
├─ api/       # hàm gọi API (dùng lib/api/client hoặc route handler auth)
├─ components/# UI riêng của feature
├─ hooks/     # bọc TanStack Query (useQuery/useMutation)
├─ schemas/   # Zod schema (form + validate runtime)
├─ types/     # type domain của feature
└─ index.ts   # PUBLIC SURFACE — nơi khác chỉ import từ đây
```

**Quy tắc ranh giới:** module khác chỉ import qua `@/modules/<feature>` (barrel `index.ts`), KHÔNG import sâu vào `modules/x/hooks/...`. Component dùng chung → `components/ui` (shadcn) hoặc `components/shared`.

## 3. Thứ tự import

```ts
// 1. thư viện ngoài
import { useQuery } from '@tanstack/react-query';
// 2. alias hạ tầng dùng chung
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/query/keys';
// 3. module khác (qua barrel)
import type { User } from '@/modules/users';
// 4. tương đối trong cùng module
import { adminApi } from '../api/user-admin';
```

Luôn dùng alias `@/*` cho import xuyên thư mục; chỉ dùng `../` trong nội bộ module.

## 4. Server Component vs Client Component

- **Mặc định là Server Component.** Không thêm `'use client'` nếu không cần.
- Thêm `'use client'` chỉ khi cần: `useState`/`useEffect`, event handler, hook trình duyệt, TanStack Query hook, React Hook Form.
- Đọc dữ liệu ở server → dùng `serverFetch` (`src/lib/api/server.ts`) trong Server Component.
- Đọc dữ liệu ở client → dùng hook module (bọc `api` của `src/lib/api/client.ts`).
- KHÔNG import `next/headers`, `cookies`, `getServerEnv` vào client component.

## 5. TypeScript

- `strict: true`, tránh `any`. Cần "thoát hiểm" thì `unknown` + thu hẹp kiểu.
- Type request/response ưu tiên dùng type sinh từ OpenAPI (`src/types/api/*`), Zod chỉ cho form + ranh giới cần validate runtime.
