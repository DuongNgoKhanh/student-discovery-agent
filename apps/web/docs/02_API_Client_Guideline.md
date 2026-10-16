# 02 — API Client Guideline

Cách gọi API backend nhất quán, an toàn token, xử lý envelope chuẩn hoá.

## 1. Kiến trúc gọi API (same-origin `/api/v1`)

Token nằm ở **httpOnly cookie**; browser chỉ gọi Product API cùng origin (route handlers trong `src/app/api/v1`).

```
Client component ──▶ api (src/lib/api/client.ts) ──▶ /api/v1/<path> (route handler, src/server/<domain>)
Auth (login/register/refresh/logout) ──▶ /api/v1/auth/* (route handler set/clear cookie)
```

- Code server nằm ở `src/server/<domain>` (server-only); code client ở `src/features/<domain>`; type sinh từ OpenAPI ở `src/generated/api`.
- **KHÔNG** `fetch('http://localhost:3000/...')` từ client. Luôn qua `api.*`.
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

Luôn bọc call trong hook TanStack Query trong `features/<f>/hooks`:

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

- Đăng nhập/đăng ký: gọi hàm `login`/`register` trong `features/users/api/auth.ts` (chúng POST tới `/api/v1/auth/*`, nơi set cookie). KHÔNG tự set token phía client.
- Refresh: tự động ở `src/lib/api/client.ts`: gặp 401 thì gọi `/api/v1/auth/refresh` một lần rồi retry request. Không cần xử lý refresh thủ công ở UI.
