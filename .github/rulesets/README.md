# Ruleset cho các thành viên

`main-protection.json` là file import vào GitHub, bảo vệ nhánh mặc định (hiện là `main`). File có trạng thái `active`: các quy tắc có hiệu lực sau khi import và lưu trên GitHub. Chỉ thêm file vào repo không tự kích hoạt ruleset.

## Quy tắc

- Mọi thay đổi vào nhánh mặc định phải qua pull request.
- Cần ít nhất một approval từ người có quyền review phù hợp. Tác giả PR không tự duyệt PR của mình; người duyệt lần push cuối phải khác người push.
- Commit mới làm mất hiệu lực các approval trước đó.
- Phải giải quyết các thảo luận review trước khi merge.
- Chặn force push và xóa nhánh mặc định.
- Không có bypass, áp dụng cả admin. Admin có quyền quản lý ruleset vẫn có thể sửa hoặc tắt ruleset.

Nhóm cần ít nhất hai người có quyền phù hợp để duyệt và merge PR. Thành viên phát triển thường cần quyền Write; chỉ giao quyền Admin cho người quản lý repo.

## Import

1. Mở repo `localis-ai/student-discovery-agent` trên GitHub.
2. Vào **Settings → Rules → Rulesets**.
3. Chọn **New ruleset → Import a ruleset** và chọn `main-protection.json`.
4. Kiểm tra tên, trạng thái **Active**, nhánh **Default branch**, bypass và các quy tắc; lưu.
5. Thử bằng một PR nhỏ: phải có approval của người khác mới merge được. Không thử force push hoặc xóa nhánh chính để kiểm tra.

Nếu đã có ruleset bảo vệ nhánh mặc định, kiểm tra và cập nhật ruleset đó thay vì import trùng; nhiều ruleset có thể cùng áp dụng.

## CI và quyền truy cập

Workflow [CI](../workflows/ci.yml) chạy khi mở/cập nhật PR vào `main`, push lên `main` và chạy thủ công qua **Actions → CI → Run workflow**. Các job chạy song song trên mọi PR, không lọc theo đường dẫn:

| Check | Nội dung |
| --- | --- |
| `Branch name` | Chỉ trên PR. Tên nhánh phải theo `<type>/<feature-slug>` (xem [commit guide](../commit_guide.instructions.md)); `dependabot/*` được miễn |
| `Web UI` | Generate API types, typecheck, lint, unit tests và build |
| `Studio API` | Generate API types, kiểm tra contract, typecheck, lint, unit tests và build |
| `Studio API Integration` | Integration tests với Postgres tạm thời qua Testcontainers. Các test cần MinIO đang tắt (image MinIO không còn trên Docker Hub, object storage chưa dùng); bật lại bằng `SDA_TEST_MINIO=1` khi có image thay thế |
| `Agent Runtime` | `ruff check` rồi toàn bộ pytest trong app |
| `Docker Build (web-ui)`, `Docker Build (studio-api)`, `Docker Build (agent-runtime)` | Build thử Dockerfile của từng app, không push image |
| `Dependency Review` | Chỉ trên PR. Chặn dependency mới có lỗ hổng mức high trở lên |

Workflow [CodeQL](../workflows/codeql.yml) quét JavaScript/TypeScript và Python (check `CodeQL (javascript-typescript)`, `CodeQL (python)`) trên PR, khi push lên `main` và mỗi thứ Hai. Kết quả xem ở **Security → Code scanning**.

CI dùng Node 22, pnpm 9.15.9, Python theo `apps/agent-runtime/.python-version` và ruff ghim trong `apps/agent-runtime/pyproject.toml`. Có cache dependencies và Docker layers, hủy lượt chạy cũ khi cùng PR/nhánh có cập nhật mới. Workflow không cần secrets và không deploy.

Việc tải dependencies dùng retry có sẵn của pnpm/pip; lỗi test, lint, typecheck hoặc build làm job thất bại ngay. Để thử lại khi lỗi hạ tầng/mạng, mở lượt chạy trong **Actions** và chọn **Re-run failed jobs**. CI không tự retry toàn bộ job.

File `main-protection.json` hiện chưa yêu cầu status checks. Sau khi các workflow chạy thành công trên GitHub, vào ruleset bảo vệ `main`, bật **Require status checks to pass**, thêm các check trong hai bảng trên từ lượt chạy thực tế rồi lưu. Thêm workflow vào repo không tự bật quy tắc chặn merge này.

Chưa bắt buộc CODEOWNERS hoặc commit signature vì chưa thiết lập các quy trình đó.

Ruleset quản lý nhánh, không cấp quyền cho thành viên và không chặn file theo đường dẫn. `.gitignore` cũng không chặn `git add -f`; việc kiểm soát file nhạy cảm cần cơ chế riêng nếu nhóm yêu cầu.

Khả năng sử dụng rulesets phụ thuộc visibility của repo và gói GitHub. Xem tài liệu chính thức nếu GitHub không cho kích hoạt.

Nguồn: [GitHub REST schema](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset) và [quản lý/import rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository).
