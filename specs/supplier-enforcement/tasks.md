# Tasks: Chế tài NCC theo sự cố ATTP (PR6b)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261202000100_supplier_enforcement` (FR-001–FR-004).
- [x] T002 Prisma schema; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 Quyền `supplier_enforcement.request`/`.decide` + grant; resource `supplier-enforcement` (FR-008).

## Phase 3: Module `supplier-enforcement` (US1–US3)

- [x] T004 Validation, request/response DTO.
- [x] T005 Repository.
- [x] T006 Service: đề nghị, danh sách, chi tiết, duyệt/thực thi, từ chối, chạy lại thu hồi phiên (FR-005, FR-006).
- [x] T007 Controller, routes, mount `/api/supplier-enforcement-actions` và `/api/food-safety-incidents/:id/enforcement-actions`.

## Phase 4: Chặn tài khoản (US4)

- [x] T008 `supplier-staff` tạo/mở khóa và `account-lifecycle` mở tiếp nhận → 409 (FR-007).

## Phase 5: Tài liệu & kiểm thử

- [x] T009 `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T010 Unit `tests/supplier-enforcement.test.ts` (thêm vào `test:unit`) + guard tests.
- [x] T011 Integration + migration tests.
- [x] T012 `npm run validate`, `test:unit`, `test:local:*`; ghi kết quả thật.
