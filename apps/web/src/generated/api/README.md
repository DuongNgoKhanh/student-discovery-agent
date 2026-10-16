# Generated API types

Các file `*-api.d.ts` trong thư mục này được **sinh tự động** từ OpenAPI spec của
backend, KHÔNG chỉnh tay.

Sinh lại bằng:

```bash
pnpm gen:api
```

Lệnh này chạy `openapi-typescript` trên:

- `contracts/openapi/public/user-api.yaml` → `user-api.d.ts`
- `contracts/openapi/public/admin-api.yaml` → `admin-api.d.ts`

Import type trong module, ví dụ:

```ts
import type { paths, components } from '@/generated/api/user-api';
type User = components['schemas']['UserResponse'];
```
