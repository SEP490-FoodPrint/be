# Tasks: Gỡ khiếu nại gửi System Admin (C06)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Code

- [x] T001 Xóa module `system-complaint`, mount trong `src/routes/index.ts`, resource trong `resource-access.ts`, hằng C06 trong `complaint-ticket.lifecycle.ts` (FR-001).
- [x] T002 Bỏ quyền và grant `system_complaint.*` khỏi `permission-catalog.ts` (FR-001).
- [x] T003 Bỏ `SC` khỏi `BUSINESS_CODE_TYPES`, thêm vào danh sách dành riêng (FR-004).

## Phase 2: Schema

- [x] T004 Migration `20261209000100_remove_system_complaints` (FR-002).
- [x] T005 Prisma: bỏ `SystemComplaint`, `Complaint.systemComplaint`, `SystemComplaintCategory` (FR-003).

## Phase 3: Tài liệu & kiểm thử

- [x] T006 Xóa `tests/system-complaint.test.ts` (và khỏi `test:unit`), ca C06 trong `authorization.integration.test.ts`, nhánh resource trong `authorization.test.ts`; cập nhật `business-code.test.ts`, `complaint-email.test.ts`; mở rộng test migration (SC-001).
- [x] T007 `docs/AUTHORIZATION.md`, `src/modules/README.md` (FR-005).
- [x] T008 `npm run validate`, `test:unit`, `test:local:migrations`, `test:local:authorization`, spec gate.
