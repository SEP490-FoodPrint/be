# Tasks: Email thông báo cho người gửi khiếu nại (PR-E)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261203000100_complaint_email_outbox` (FR-001).
- [x] T002 Prisma schema; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 Renderer `src/utils/complaint-email.ts` (FR-004).
- [x] T004 Repository `findEmailRecipient`/`queueEmail` + helper `queueRequesterEmail` (FR-006).
- [x] T005 Worker/script outbox theo nguồn (FR-005).

## Phase 3: Gắn vào luồng ticket (US1–US3)

- [x] T006 `feedback`, `ingredient-quality-feedback`, `authority-complaint`, `system-complaint`: tạo đơn, bình luận của bên xử lý, Đã xử lý (FR-002, FR-003).

## Phase 4: Tài liệu & kiểm thử

- [x] T007 Unit test renderer + helper; thêm vào `test:unit`.
- [x] T008 Migration test và integration test outbox.
- [x] T009 Cập nhật `docs/MAILER.md`, `docs/ONBOARDING.md` (outbox), `src/modules/README.md`.
- [x] T011 Logo dự án inline + bố cục lá thư 343px cho email đăng ký, mã xác minh, đặt lại mật khẩu, thực đơn; bỏ `renderBrandedEmail` (FR-007, FR-008).
- [x] T010 `npm run validate`, `test:unit`, `test:local:migrations`, `test:local:authorization`, spec gate.
