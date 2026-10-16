# 07 — PR Review Checklist (Frontend)

Reviewer tick từng mục trước khi approve. Author tự kiểm trước khi tạo PR.

## Convention & cấu trúc
- [ ] Đặt tên file/folder/component/hook đúng `01_Coding_Convention.md`.
- [ ] Code đặt đúng chỗ (feature → `modules/<f>`; dùng chung → `components/shared` / `ui`).
- [ ] Import qua barrel module, không import sâu vào internals module khác.
- [ ] `'use client'` chỉ ở nơi thực sự cần; phần còn lại là Server Component.

## API & bảo mật
- [ ] Không gọi thẳng FastAPI từ client — luôn qua `api` / route handler.
- [ ] Không đọc/ghi token ở client; không log token; không đưa `.env*` vào commit.
- [ ] Lỗi API xử lý qua `ApiError` + `mapErrorMessage` (thông điệp tiếng Việt).
- [ ] Mutation có `invalidateQueries` đúng key khi dữ liệu đổi.

## State & form
- [ ] Server-state dùng TanStack Query (không nhét vào useState/Context).
- [ ] Form dùng React Hook Form + Zod; schema ở `modules/<f>/schemas`.

## Type & test
- [ ] Không `any` vô cớ; type request/response khớp OpenAPI (`pnpm gen:api` nếu BE đổi).
- [ ] Có test cho logic mới (schema/util/hạ tầng/nhánh hiển thị quan trọng).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` đều pass.

## UI
- [ ] Có loading & error state.
- [ ] Chỉ dùng token theme Tailwind, không hard-code màu.
- [ ] A11y tối thiểu (label/aria, keyboard) đạt.
- [ ] Đính kèm ảnh chụp màn hình cho thay đổi UI.

## Commit
- [ ] Message đúng `<type>(scope): subject` (xem `.github/commit_guide.instructions.md`).
