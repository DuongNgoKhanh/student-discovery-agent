# 06 — README template cho mỗi module

Copy khung dưới đây vào `src/modules/<feature>/README.md` khi tạo module mới.

---

# Module: <tên feature>

## Mục đích
<1-2 câu module này lo việc gì, tương ứng module nào bên backend.>

## API backend sử dụng
| Method | Path (sau /api/v1) | Mô tả |
|---|---|---|
| GET | `me` | Lấy thông tin user hiện tại |
| ... | ... | ... |

## Public surface (`index.ts`)
Những gì module export ra ngoài — nơi khác chỉ dùng các mục này:

- `usersApi` — hàm gọi API
- `useMe()`, `useLogin()` — hook
- `loginSchema`, `LoginInput` — schema/type

## Ví dụ dùng
```tsx
import { useMe } from '@/modules/users';
const { data } = useMe();
```

## Ghi chú
<Điểm đặc biệt: quyền hạn, phụ thuộc module khác, edge case cần biết.>
