---
applyTo: '**'
---

# Commit Guideline for SDA Frontend

Purpose:
Provide a concise, consistent commit message and branch workflow guideline for contributors and automated agents (including AI) to produce clear history and safe changes. Giữ **giống hệt convention của backend** để lịch sử toàn dự án đồng nhất.

Principles:
- Keep commits small and focused.
- Use imperative, present-tense subject lines.
- Do not include secrets, tokens or `.env*` files in commits.
- Never commit generated API types diff without regenerating (`pnpm gen:api`).

Commit message format:
<type>(scope?): subject

Optional body separated by a blank line. If needed, include:
- Motivation / Summary of change
- Implementation notes
- Migration steps or required follow-ups

Footer for metadata (issue IDs, breaking changes, co-authored-by).

Allowed types (use lower-case):
- feat: new feature
- fix: bug fix
- refactor: code change that neither fixes bug nor adds feature
- docs: documentation only changes
- style: formatting, lint, no code logic change
- perf: performance improvements
- test: adding or fixing tests
- chore: maintenance tasks (deps, tooling)
- build: CI/build system changes
- revert: reverts a previous commit

Scope gợi ý cho frontend:
- `auth`, `api`, `ui`, `query`, `config`, `build`, và tên module (`users`, `admin`, ...)

Examples:
- feat(auth): add httpOnly cookie login route handler
- feat(users): add login form with react-hook-form + zod
- fix(api): unwrap business error when http status is 200
- refactor(query): centralize query keys
- docs(templates): update component guideline
- chore(deps): bump next to 15.1

Subject rules:
- Max ~72 characters for subject line
- Use imperative mood: "Add", "Fix", "Update"
- No trailing period
- Keep scope optional (module or file area)

Body rules:
- Wrap at ~100 characters
- Explain why, not just what
- Mention migration steps or config impacts
- Never paste secrets or private keys

Branch naming:
- Feature / task branches: task/[TASK_IDENTIFIER]_[YYYY-MM-DD]_[N]
    - Example: task/users-login-form_2026-07-14_1
- Hotfix: hotfix/[short-desc]_[YYYYMMDD]
- Release: release/vX.Y.Z
- Use lowercase, hyphens or underscores as project convention requires

Pull request checklist:
- Link to relevant issue or task
- Include testing steps and screenshots (UI changes bắt buộc có ảnh)
- Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
- Confirm no secrets checked in
- Regenerate API types nếu OpenAPI backend đổi (`pnpm gen:api`)
- Xem thêm `templates/07_PR_Review_Checklist.md`

Committing rules:
- Stage only related changes per commit
- Husky + lint-staged sẽ chạy eslint/prettier trước mỗi commit
- Rebase and squash locally when appropriate for a clean history before merging

This file should be updated when workflow or CI requirements change.
