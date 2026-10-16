# Student Discovery Agent (SDA)

**SDA** là dự án trợ lý AI tư vấn hướng nghiệp cho học sinh THPT lớp 10–12 tại Đồng bằng sông Cửu Long, phục vụ **IHRD GenZ Career Agent**. Sản phẩm hướng đến trải nghiệm chat trên thiết bị di động, tích hợp vào `ihrd.vn` và tư vấn trong mạng lưới 12 trường liên kết.

Repository hiện chứa **backend FastAPI**, **frontend Next.js** và tài liệu thiết kế cho Agent cùng SDA Studio.

> **Trạng thái hiện tại:** bộ khung ứng dụng đã có xác thực, quản lý người dùng, quản trị và các tiện ích hạ tầng. Luồng tư vấn hướng nghiệp, Agent Harness, SDA Studio, scoring/matching và kho tri thức chuyên biệt chưa được triển khai thành sản phẩm hoàn chỉnh.

## Mục lục

- [Phạm vi và định hướng](#phạm-vi-và-định-hướng)
- [Công nghệ](#công-nghệ)
- [Cấu trúc repository](#cấu-trúc-repository)
- [Chạy backend bằng Docker](#chạy-backend-bằng-docker)
- [Chạy backend trực tiếp](#chạy-backend-trực-tiếp)
- [Chạy frontend](#chạy-frontend)
- [API và tài liệu](#api-và-tài-liệu)
- [Kiểm tra và đóng góp](#kiểm-tra-và-đóng-góp)
- [Giấy phép](#giấy-phép)

## Phạm vi và định hướng

### Thành phần đã có

- **Xác thực:** đăng ký, đăng nhập bằng email/mật khẩu, JWT và refresh token.
- **Người dùng:** xem/cập nhật hồ sơ, quản lý avatar.
- **Quản trị:** đăng nhập admin, quản lý người dùng và thao tác hàng loạt.
- **Tiện ích chung:** chuẩn hóa phản hồi/lỗi, theo dõi request, timeout, logging và tích hợp Redis/MinIO/LLM.
- **Hạ tầng:** PostgreSQL, Redis, MinIO, TaskIQ worker và API quản lý phiên bản.
- **Frontend:** bộ khung Next.js với proxy API và token lưu trong cookie httpOnly.

### Định hướng đang thiết kế

SDA Studio quản lý hành trình tư vấn, prompt, luật nghiệp vụ, dữ liệu và phiên bản phát hành. Agent Harness điều phối thực thi dựa trên hồ sơ có bằng chứng trong phiên; các engine nghiệp vụ thực hiện chấm điểm, matching, so sánh và tính chi phí bằng code xác định. LLM hỗ trợ hiểu và diễn đạt; dữ liệu tư vấn phải có nguồn và được kiểm tra trước khi gửi đến người học.

Thiết kế mới phân chia **TypeScript cho tầng sản phẩm/quản trị** và **Python cho tầng thực thi AI/Agent**, trao đổi qua API và JSON Schema có phiên bản. Đây là định hướng kiến trúc, chưa phản ánh đầy đủ cấu trúc code hiện tại.

Xem [thiết kế Agent](docs/superpowers/specs/2026-09-23-ihrd-career-agent-architecture.md) và [tổng quan SDA Studio](docs/superpowers/specs/2026-10-06-sda-studio-architecture-overview.md).

## Công nghệ

| Thành phần | Công nghệ hiện tại |
| --- | --- |
| Backend | Python **3.11**, FastAPI, Uvicorn |
| Dependency Python | `requirements.txt` với phiên bản cố định |
| ORM và cơ sở dữ liệu | SQLAlchemy, SQLModel, PostgreSQL 16; hỗ trợ cấu hình kết nối Supabase |
| Cache và hàng đợi | Redis 7, TaskIQ, taskiq-redis |
| Lưu trữ tệp | MinIO |
| Tích hợp AI | Agno, Gemini qua `google-genai` |
| Xác thực | JWT, thư viện băm mật khẩu Argon2/bcrypt |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui |
| Kiểm thử frontend | Vitest, Testing Library |

**Neo4j/Graphiti:** dependency, tiện ích và service Neo4j vẫn còn trong bộ khung hiện tại. Thiết kế Agent đã loại bỏ hướng GraphRAG này; không xem đây là kiến trúc đích. PostgreSQL với pgvector/full-text là hướng truy hồi đang được đề xuất, chưa triển khai.

## Cấu trúc repository

```text
student-discovery-agent/
├── app/
│   ├── constants/          # Thông báo và hằng số dùng chung
│   ├── core/               # Cấu hình, xác thực và nạp cấu hình Vault
│   ├── db/                 # Kết nối, session và khởi tạo database
│   ├── exception_handlers/ # Xử lý lỗi và middleware
│   ├── jobs/               # TaskIQ broker
│   ├── models/             # Model dữ liệu
│   └── modules/            # admin, users, common, version
├── docs/
│   ├── mockup/             # Mockup và hội thoại mẫu
│   ├── presentations/      # Tài liệu trình bày kiến trúc
│   ├── superpowers/        # Thiết kế và kế hoạch
│   └── templates/          # Quy ước code, API và review
├── apps/
│   └── web/                # Frontend Next.js, chạy riêng
├── contracts/
│   └── openapi/            # Đặc tả API công khai và mã lỗi
├── .env.example            # Cấu hình backend mẫu
├── .python-version         # Python 3.11
├── docker-compose.local.yml
├── Dockerfile
├── main.py                 # FastAPI entrypoint
├── pytest.ini
├── requirements.txt
└── start.sh                # Khởi động Uvicorn và TaskIQ worker
```

Các module backend tổ chức theo `crud/`, `routes/`, `schemas/`, `services/` và `utils/`. API nghiệp vụ sử dụng tiền tố `/api/v1`.

## Chạy backend bằng Docker

### 1. Chuẩn bị môi trường

Cần Docker và Docker Compose v2. Chạy các lệnh từ thư mục gốc repository.

```powershell
Copy-Item .env.example .env
```

Trên Linux/macOS, dùng `cp .env.example .env`. Nếu đã có `.env`, chỉnh sửa file hiện có.

Cấu hình các nhóm biến sau trước khi khởi động:

| Nhóm | Biến cần kiểm tra |
| --- | --- |
| Xác thực | `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` |
| PostgreSQL | `POSTGRES_SERVER`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB` |
| MinIO | `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, tên bucket |
| Neo4j hiện tại | `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` |
| Frontend | `BACKEND_CORS_ORIGINS` chứa origin của frontend |
| Gemini, khi sử dụng | `GOOGLE_API_KEY` |

Thay các giá trị mẫu `change-me`. Với Docker Compose, giữ hostname nội bộ `db`, `redis`, `minio` và `neo4j`.

**MinIO:** thêm `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD` vào `.env` để cấu hình tài khoản server local; đặt chúng tương ứng với `MINIO_ACCESS_KEY` và `MINIO_SECRET_KEY` của ứng dụng. File mẫu hiện chưa khai báo hai biến này.

`DATABASE_URL`, nếu có giá trị, được ưu tiên hơn nhóm `POSTGRES_*` cho kết nối ứng dụng. Khi dùng Vertex AI, cần cấu hình project/location, thông tin xác thực Google Cloud và bật chế độ Vertex trong client; chỉ đặt biến môi trường không tự chuyển chế độ.

### 2. Khởi động

```powershell
docker compose -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.local.yml ps
```

Compose khởi động `api`, `db`, `redis`, `minio`, `neo4j` và `adminer`. Container `api` chạy cả Uvicorn và TaskIQ worker qua `start.sh`. Backend tạo các bảng từ model khi khởi động.

### 3. Truy cập

| Dịch vụ | Địa chỉ local |
| --- | --- |
| Backend | http://localhost:8081 |
| Swagger UI | http://localhost:8081/docs |
| ReDoc | http://localhost:8081/redoc |
| OpenAPI JSON | http://localhost:8081/openapi.json |
| Health check | http://localhost:8081/health |
| Adminer | http://localhost:8080 |
| MinIO API / Console | http://localhost:9000 / http://localhost:9001 |
| Neo4j Browser | http://localhost:7474 |

Xem log hoặc dừng dịch vụ:

```powershell
docker compose -f docker-compose.local.yml logs -f api
docker compose -f docker-compose.local.yml down
```

Dữ liệu PostgreSQL, MinIO và Neo4j được lưu trong named volumes; lệnh `down` ở trên giữ lại các volume này.

## Chạy backend trực tiếp

Cần **Python 3.11** và các dịch vụ hạ tầng đang chạy. Có thể khởi động riêng chúng bằng Compose:

```powershell
docker compose -f docker-compose.local.yml up -d db redis minio neo4j
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Đổi hostname trong `.env` thành địa chỉ truy cập từ máy host:

```dotenv
POSTGRES_SERVER=localhost
REDIS_HOST=localhost
MINIO_ENDPOINT=localhost:9000
NEO4J_URI=bolt://localhost:7687
```

Sau đó chạy API:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Swagger UI ở http://localhost:8000/docs. Nếu dùng frontend, đổi `API_BASE_URL` thành `http://localhost:8000/api/v1`.

Khi cần xử lý tác vụ nền, mở terminal riêng tại thư mục gốc:

```powershell
.\.venv\Scripts\python.exe -m taskiq worker app.jobs.taskiq_broker:broker
```

Trên Linux/macOS, tạo môi trường bằng `python3.11 -m venv .venv` và dùng `.venv/bin/python` thay cho `.\.venv\Scripts\python.exe`. Vault không bắt buộc khi chạy local; ứng dụng bỏ qua nếu không có file cấu hình được inject.

## Chạy frontend

Cần **Node.js ≥20** và **pnpm 9**. Frontend chạy độc lập với backend.

```powershell
Set-Location apps/web
Copy-Item .env.example .env.local
pnpm install
pnpm gen:api
pnpm dev
```

Truy cập http://localhost:3000. Cấu hình mặc định `API_BASE_URL=http://localhost:8081/api/v1` phù hợp với backend Docker. Các lệnh frontend trong README này chạy từ thư mục `apps/web/`.

Browser gọi API cùng origin qua route handler của Next.js; backend URL và token được xử lý phía server. Chi tiết ở [README frontend](apps/web/README.md).

## API và tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [User API](contracts/openapi/public/user-api.yaml) | Xác thực và quản lý người dùng |
| [Admin API](contracts/openapi/public/admin-api.yaml) | Xác thực admin và quản lý người dùng |
| [Mã lỗi](contracts/error_codes.md) | Danh mục lỗi API |
| [Thiết kế Agent](docs/superpowers/specs/2026-09-23-ihrd-career-agent-architecture.md) | Hồ sơ, năng lực, tri thức và kiểm soát đầu ra |
| [Tổng quan SDA Studio](docs/superpowers/specs/2026-10-06-sda-studio-architecture-overview.md) | Thành phần hệ thống và phân chia TypeScript/Python |
| [Thiết kế SDA Studio](docs/superpowers/specs/2026-10-06-sda-studio-design.md) | Cấu hình, hành trình, phát hành và thực thi |
| [Hội thoại mẫu](docs/mockup/hoi-thoai-mau.html) | Minh họa trải nghiệm tư vấn |
| [Bản ghi mẫu](docs/mockup/tools/steps.json) | Hội thoại 41 bước dùng làm tham chiếu hành vi |

Các tài liệu kiến trúc mô tả hướng phát triển; đối chiếu trạng thái của từng tài liệu trước khi dùng làm đặc tả triển khai. Swagger/OpenAPI do ứng dụng sinh khi chạy phản ánh các route đã đăng ký.

## Kiểm tra và đóng góp

Backend đã có cấu hình [pytest.ini](pytest.ini), nhưng chưa có bộ test trong `tests/` và `pytest` chưa nằm trong dependency runtime. Khi bổ sung test, cài công cụ và chạy từ thư mục gốc:

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest
```

Frontend có các bài kiểm thử Vitest. Chạy từ `apps/web/`:

```powershell
pnpm typecheck
pnpm test
```

Tham khảo [quy ước backend](docs/templates/01_Coding_Convention.md), [quy ước frontend](apps/web/templates/README.md) và [checklist review](docs/templates/07_TL_QA_review_checklist.md). Commit theo dạng `<type>(scope): subject`, chi tiết trong [hướng dẫn commit](.github/commit_guide.instructions.md).

## Giấy phép

Dự án sử dụng [MIT License](LICENSE).
