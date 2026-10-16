# Studio API conventions

- Domain code ở `src/modules/<domain>`: routes/controllers → service → repository. Hono Context chỉ ở transport adapter; services không nhận framework context.
- DB/storage adapter ở `src/infrastructure`; HTTP envelope/error/meta ở `src/http`. Không import source UI/runtime.
- Public contracts ở `contracts/openapi/public` tại root; `pnpm gen:api` sinh DTO riêng cho API. Sửa contract nguồn rồi generate, không sửa `.d.ts` bằng tay.
- Unit tests đặt cạnh source. Integration tests ở `tests/integration`, gọi router thật hoặc Node HTTP adapter với PostgreSQL/MinIO tạm. `pnpm test:integration` cần Docker.
- Giữ auth/hash/cookie semantics và policy storage hiện tại; config/credentials chỉ ở server. `/api/health` là liveness; lỗi DB/env của endpoint nghiệp vụ vẫn trả envelope lỗi.
- Migration chỉ chạy thủ công qua `pnpm db:migrate` khi env đã nạp hoặc Compose tool `studio-api-migrate`; không reset schema/journal khi đổi folder.

Xem [quy ước API chung](../../../docs/conventions/README.md), [contracts](../../../contracts/README.md), và [lệnh chạy app](../README.md).
