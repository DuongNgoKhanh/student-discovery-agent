# 05 — Testing Guideline

Công cụ: **Vitest** + **@testing-library/react** (cấu hình ở `vitest.config.ts`, setup ở `vitest.setup.ts`).

## 1. Chạy test

```bash
pnpm test         # chạy 1 lần
pnpm test:watch   # watch mode
```

## 2. Test cái gì (ưu tiên giá trị/độ ổn định)

| Nên test | Ví dụ trong repo |
|---|---|
| Zod schema (biên hợp lệ/không hợp lệ) | `modules/users/schemas/auth.test.ts` |
| Util thuần | `lib/utils/cn.test.ts` |
| Logic hạ tầng | `lib/api/response.test.ts` (unwrap envelope), `lib/auth/jwt.test.ts` |
| API client (mock `fetch`) | `lib/api/client.test.ts` |
| Component có nhánh hiển thị | render + assert theo hành vi người dùng |

Không cần test: code chỉ forward props, style thuần, hoặc wrapper Query 1 dòng.

## 3. Quy ước

- File test đặt **cạnh nguồn**: `xxx.ts` → `xxx.test.ts`.
- Test **hành vi**, không test implementation nội bộ. Với component, query theo role/label/text như người dùng thấy (`getByRole`, `getByLabelText`), tránh bám class/CSS.
- Mock ở ranh giới ngoài (network: mock `fetch`); không mock module nội bộ trừ khi bất khả kháng.

## 4. Ví dụ mock fetch (client)

```ts
import { vi } from 'vitest';
vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify({ success: true, data: { id: 9 } }), { status: 200 }),
);
```

## 5. Component test (mẫu)

```tsx
import { render, screen } from '@testing-library/react';
import { PageHeader } from '@/components/shared/page-header';

it('hiển thị tiêu đề', () => {
  render(<PageHeader title="Người dùng" />);
  expect(screen.getByRole('heading', { name: 'Người dùng' })).toBeInTheDocument();
});
```

Hook dùng Query → bọc `QueryClientProvider` trong `render` (tạo helper `renderWithProviders` khi cần).
