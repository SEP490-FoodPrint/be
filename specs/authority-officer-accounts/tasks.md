# Tasks: Tài khoản cán bộ ATTP theo phường/xã

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

Chia 2 PR: **PR A** (`feat/authority-officer-accounts`) gồm Phase 2–4 và tài liệu tương ứng, không migration; **PR B** (`feat/authority-officer-accounts-login`) gồm Phase 1, 5, 6 (migration `users.email`).

## Phase 1: Schema

- [x] T001 Migration `20261208000100_authority_officer_accounts`: `users.email` nullable + `chk_users_email_required` (FR-001).
- [x] T002 Prisma `User.email String?`; `prisma:validate`, `prisma:generate`; sửa các chỗ đọc `email` theo typecheck.

## Phase 2: Nền tảng quyền

- [x] T003 `permission-catalog.ts`: thêm `authority_school.view` + grant officer; bỏ grant `dashboard.view` của officer (FR-010, US5).
- [x] T004 Resource `authority-school` trong `resource-access.ts` (FR-009).

## Phase 3: Phường/xã của trường và NCC (US3)

- [x] T005 Onboarding: `locationId` bắt buộc trong hồ sơ trường và NCC, kiểm tra phường/xã, ghi vào trường/NCC khi duyệt, trả kèm trong chi tiết hồ sơ (FR-007).
- [x] T006 `PUT /api/schools/:schoolId/location` và `PUT /api/suppliers/:supplierId/location` cho System Admin (FR-008).

## Phase 4: Danh sách và chi tiết trường của ATTP (US4)

- [x] T007 `GET /api/commune-food-safety-units/me/schools` (validation, DTO, repository, service, route) (FR-009).
- [x] T007a `GET /api/commune-food-safety-units/me/schools/:schoolId` kèm NCC liên kết với trường, ẩn NCC đã hủy liên kết hoặc ngừng hoạt động (FR-011).

## Phase 5: Tài khoản ATTP (US1)

- [x] T008 Module `authority-officer`: tạo, danh sách, chi tiết; mount `/api/authority-officers` (FR-002, FR-003).

## Phase 6: Email lần đầu (US2)

- [x] T009 `emailSetupRequired` trong login/`me`; tách khỏi onboarding (FR-004).
- [x] T010 `POST /api/auth/email-setup/request|verify` (FR-005).
- [x] T011 Đăng nhập: từ chối username khi tài khoản ATTP đã có email (FR-006).

## Phase 7: Tài liệu & kiểm thử

- [x] T012 `src/modules/README.md`, `docs/AUTHORIZATION.md`, `docs/ONBOARDING.md`, `docs/AUTH_SESSIONS.md`, `docs/EMAIL_VERIFICATION.md` (PR A đã cập nhật README, AUTHORIZATION, ONBOARDING).
- [x] T013 Unit tests (thêm file mới vào `test:unit`).
- [x] T014 Integration + migration tests.
- [x] T015 `npm run validate`, `test:unit`, `test:local:migrations`, `test:local:authorization`, spec gate; ghi kết quả thật.
