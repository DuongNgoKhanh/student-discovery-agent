# 03 — Component Guideline

## 1. Đặt component ở đâu?

| Vị trí | Dùng khi |
|---|---|
| `components/ui/` | Primitive từ shadcn/ui (Button, Input, Dialog...). Tái sử dụng toàn app, không chứa business logic. |
| `components/shared/` | Component ghép nhiều primitive, dùng bởi ≥2 feature (vd `PageHeader`, `DataTable`, `EmptyState`). |
| `modules/<f>/components/` | UI riêng của 1 feature (vd `UserProfileCard`). Không import chéo sang feature khác. |

**Quy tắc tạo mới vs tái sử dụng:** trước khi tạo, tìm trong `ui/` và `shared/`. Nếu chỉ khác style → truyền props/variant. Nếu bị dùng ở feature thứ 2 → nâng từ `modules/*/components` lên `components/shared`.

## 2. Props convention

- Interface tên `<Component>Props`, export nếu cần dùng lại.
- Ưu tiên **composition** (`children`, slot `action?: React.ReactNode`) hơn nhồi nhiều boolean.
- Tránh "boolean trap": thay `isPrimary/isSecondary` bằng `variant: 'primary' | 'secondary'` (dùng `cva` như `button.tsx`).
- Component thuần trình bày: không tự fetch dữ liệu — nhận qua props; fetch để ở hook/level trên.

```tsx
export interface PageHeaderProps {
  title: string;
  action?: React.ReactNode;
}
export function PageHeader({ title, action }: PageHeaderProps) { ... }
```

## 3. Server vs Client

- Component chỉ hiển thị (không state/event) → để Server Component.
- Cần tương tác/hook → `'use client'` và giữ component client càng nhỏ càng tốt (đẩy phần tĩnh ra server).

## 4. Style

- Chỉ dùng Tailwind + token theme (`bg-primary`, `text-muted-foreground`...), không hard-code màu hex.
- Ghép class động bằng `cn()` (`@/lib/utils/cn`).

## 5. Accessibility (tối thiểu)

- Input có `label`/`aria-label`; button icon-only có `aria-label`.
- Ưu tiên primitive shadcn/Radix (đã lo focus, keyboard, role).
- Trạng thái lỗi form gắn với field, đọc được bằng screen reader.
