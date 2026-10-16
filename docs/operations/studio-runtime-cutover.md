# Cutover: web-ui / studio-api / agent-runtime

Runbook cho việc tách Next UI khỏi Product backend. Các thao tác dưới đây do operator chạy với DB/volume thật; kiểm thử refactor chỉ dùng DB/bucket tạm.

## Chuyển service

1. Ghi lại cấu hình/volume đang dùng và snapshot DB theo quy trình vận hành. Giữ cùng `DATABASE_URL`, `SECRET_KEY`, cookie config và S3 bucket/credentials; đặt chúng trong shell hoặc `.env` root. Giữ cùng Compose project name để nhận đúng named volumes. Không chạy `down --volumes`.
2. Build image mới: `docker compose -f docker-compose.yaml build web-ui studio-api agent-runtime studio-api-migrate`. UI không nhận credential Product; runtime dùng env riêng.
3. Nếu đã migrate Product ở đợt trước, **không có schema migration mới chỉ vì đổi thư mục**. Tool chuyển sang `studio-api-migrate`, SQL/journal giữ nguyên. Chỉ khi DB mới hoặc còn migration thiếu, chạy thủ công: `docker compose -f docker-compose.yaml --profile tools run --rm studio-api-migrate`. Tool dùng cùng `DATABASE_URL` với API, giữ journal `product.__drizzle_migrations`; không bootstrap/reset lại DB đã migrated.
4. Dừng service `web` cũ theo cấu hình cũ để nhả cổng 3000, giữ volume. Chạy `docker compose -f docker-compose.yaml up -d gateway web-ui studio-api agent-runtime`. Xóa orphan container `web` khi đã xác minh đúng container; không xóa volume.
5. Kiểm tra `/healthz` (UI), `/api/health` (API), login/session, `/api/v1/me`, admin, refresh/logout, upload/read avatar và `/download`. Cookie browser vẫn cùng public origin. `PRODUCT_BASE_URL` là public gateway origin, mặc định local `http://localhost:3000`.
6. UI SSR gọi `STUDIO_API_ORIGIN=http://studio-api:3001`. Gateway định tuyến `/api/*` và `/download` tới API, còn lại tới UI. Không publish runtime hoặc cấp DB/JWT secret của Product cho runtime.

Migration không tự chạy khi image build hoặc app khởi động. `/healthz`, `/api/health`, runtime `/health` là liveness, không xác nhận DB/storage đã sẵn sàng. `minio-init` vẫn là tool thủ công cho bucket/policy; không cần chạy lại chỉ vì tách UI/API.

## Rollback

Rollback riêng đợt tách UI/API: dừng gateway/UI/API mới rồi chạy image/config `web` trước refactor với cùng volume/env. Schema, journal, object keys và token không đổi; không restore DB chỉ vì đổi thư mục.

**Lịch sử đợt Python → Product:** đợt trước chuyển ownership sang schema `product` và gỡ backend Python cũ. Nếu rollback xuyên qua mốc schema đó, cần dừng writer và restore snapshot tương ứng theo quy trình vận hành; Git revert riêng lẻ không đủ. Runtime FastAPI hiện tại là tầng thực thi Agent, không thay thế Product API.
