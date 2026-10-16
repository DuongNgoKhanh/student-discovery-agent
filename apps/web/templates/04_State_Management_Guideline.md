# 04 — State Management Guideline

Chọn đúng công cụ cho từng loại state để tránh lộn xộn.

## Cây quyết định

```
State này là gì?
├─ Dữ liệu đến từ server (API)?           → TanStack Query
├─ State UI cục bộ 1 component?            → useState / useReducer
└─ State client dùng chung nhiều nơi,
   đổi hiếm (theme, phiên, sidebar open)?  → React Context
```

## 1. Local state — `useState` / `useReducer`

Mặc định cho state chỉ 1 component quan tâm: input đang gõ, modal mở/đóng, tab đang chọn. Không nâng lên global nếu không có ai khác cần.

## 2. Server state — TanStack Query (BẮT BUỘC)

Mọi dữ liệu từ API đi qua TanStack Query, **không** copy vào `useState`/Context:

- `useQuery` cho đọc, `useMutation` cho ghi.
- Bọc trong hook module (`modules/<f>/hooks`), key lấy từ `lib/query/keys.ts`.
- Cache/refetch/loading/error do Query lo. Đồng bộ lại bằng `invalidateQueries`.

❌ Sai: `const [users, setUsers] = useState([]); useEffect(fetch...)`
✅ Đúng: `const { data: users } = useAdminUsers(page)`

## 3. Global client state — Context

Chỉ dùng cho state **client thuần**, dùng nhiều nơi, đổi ít:
- theme (light/dark), trạng thái sidebar, thông tin session hiển thị (không phải token).

Quy tắc: **không để server-state trong Context**. Nếu dữ liệu có thể "cũ" và cần refetch → đó là server-state → dùng Query.

## 4. Form state — React Hook Form

Form dùng React Hook Form + `zodResolver`; không quản field bằng `useState` rời rạc. Schema Zod đặt ở `modules/<f>/schemas`.

## 5. URL state

Filter/pagination/tab nên phản ánh lên URL (`useSearchParams`) khi cần share/back được, thay vì chỉ giữ trong memory.
