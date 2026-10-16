# 02 — API Client Guideline

Cách gọi API backend nhất quán, an toàn token, xử lý envelope chuẩn hoá.

## 1. Kiến trúc gọi API (BFF-lite)

Token nằm ở **httpOnly cookie** → **browser không bao giờ gọi thẳng FastAPI**.

```
Client component ──▶ api (lib/api/client) ──▶ /api/bff/<path> ──▶ FastAPI
Server component ──▶ serverFetch (lib/api/server) ──▶ FastAPI (đọc cookie)
Auth (login/refresh) ──▶ /api/auth/* (route handler set cookie)
```

- **KHÔNG** `fetch('http://localhost:8081/...')` từ client. Luôn qua `api.*`.
- `path` truyền vào `api` là phần sau `/api/v1`, ví dụ `api.get('me')`, `api.get('admin/users?page=1')`.

## 2. Dùng client

```ts
import { api } from '@/lib/api/client';

const me = await api.get<User>('me');
await api.post('users', payload);
```

`api.get/post/put/patch/del` tự **unwrap envelope** (`{ success, data, error }`) và ném `ApiError` khi `success:false` — kể cả lỗi nghiệp vụ HTTP 200.

## 3. Xử lý lỗi

`ApiError` (`src/lib/api/errors.ts`) có `code`, `message`, `details`, `retryable`, `httpStatus`.

```ts
import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';

try {
  await api.post('...', body);
} catch (e) {
  if (e instanceof ApiError) toast(mapErrorMessage(e.code)); // hiển thị tiếng Việt
}
```

Thêm code mới → cập nhật `src/lib/api/error-map.ts` (seed từ `error_codes.md` của BE).

## 4. Loading / error state (qua hook module)

Luôn bọc call trong hook TanStack Query trong `modules/<f>/hooks`:

```ts
export function useMe() {
  return useQuery({ queryKey: queryKeys.users.me(), queryFn: usersApi.me });
}
```

Ở UI:
```tsx
const { data, isLoading, error } = useMe();
if (isLoading) return <Spinner />;
if (error) return <ErrorState message={(error as Error).message} />;
```

## 5. Mutation + cache invalidation

```ts
const qc = useQueryClient();
const mutation = useMutation({
  mutationFn: (body: UpdateInput) => api.put('me', body),
  onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.users.me() }),
});
```

- Invalidate theo `queryKey` tập trung ở `lib/query/keys.ts` — không hard-code mảng key.
- `retry` được cấu hình ở `makeQueryClient`: lỗi `retryable:false` không thử lại.

## 6. Auth flow

- Đăng nhập/đăng ký: gọi hàm `login`/`register` trong `modules/users/api/auth.ts` (chúng POST tới `/api/auth/*`, nơi set cookie). KHÔNG tự set token phía client.
- Refresh: tự động ở BFF proxy khi gặp 401 → xoay cookie → retry. Không cần xử lý refresh thủ công ở UI.
