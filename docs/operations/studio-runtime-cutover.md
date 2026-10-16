# Cutover: backend Python cũ sang Product (Next.js) + agent-runtime

Runbook ngắn. Chưa thực hiện trên DB thật; operator cung cấp `DATABASE_URL`.

Kiểm tra trước khi xóa backend cũ: `rg 'neo4j|graphiti|taskiq|@broker.task|common.utils.minio|common.utils.redis' apps`
không có consumer nào trong `apps/` (Neo4j/Graphiti/TaskIQ/Redis không còn dùng).

1. **Snapshot DB**: `pg_dump -Fc "$DATABASE_URL" > sda-pre-cutover.dump` (và lưu lại bucket MinIO nếu cần).
2. **Dừng writer cũ**: dừng container `api` Python (gồm TaskIQ worker) để không còn ghi vào DB.
3. **Migrate Product** (explicit, không chạy khi khởi động):
   `DATABASE_URL=<operator-url> docker compose --profile tools run --rm product-migrate`
   Migration tạo schema `product` (bảng `users`, `versions`, journal `product.__drizzle_migrations`).
4. **Chạy stack**: `docker compose up -d web agent-runtime` với env `apps/web/.env` (`DATABASE_URL`, `SECRET_KEY`,
   `ADMIN_PASSWORD`, `S3_*`, `PRODUCT_BASE_URL`). Runtime không nhận credential Product.
5. **Kiểm tra Product**: `curl /api/health`, đăng nhập, `GET /api/v1/me`, `/api/v1/versions`, tải avatar.
6. **Chuyển host API cũ**: URL avatar cũ `/users/{id}/avatar` (và `/download`) trỏ sang web
   `/api/v1/users/{id}/avatar` (reverse proxy/redirect), rồi đóng backend cũ.

**Rollback**: sau khi schema đã chuyển, chỉ Git revert là không đủ. Dừng web, restore snapshot
(`pg_restore --clean`), khởi động lại backend cũ từ tag/commit trước refactor.
