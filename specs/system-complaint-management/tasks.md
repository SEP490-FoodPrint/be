# Tasks: Khiếu nại gửi System Admin theo luồng ticket (C06, PR2)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Viết migration `prisma/migrations/20261127000100_system_complaints/migration.sql` (enum `system_complaint_category`, bảng `system_complaints`, CHECK kind, unique `(id, kind)`, FK tổ hợp).
- [x] T002 Cập nhật `prisma/schema.prisma` (model `SystemComplaint`, enum, quan hệ `Complaint.systemComplaint`); `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng dùng chung

- [x] T003 Đăng ký `SC` trong `src/utils/business-code.ts`; thêm `systemComplaintTitle` vào `complaint-ticket.lifecycle.ts`.
- [x] T004 Thêm 3 quyền + grant vào `src/constants/permission-catalog.ts`; thêm resource/scope `system-complaint` vào `src/utils/resource-access.ts`.

## Phase 3: Module `system-complaint` (US1, US2, US3)

- [x] T005 `system-complaint.validation.ts`, `.request.dto.ts`, `.response.dto.ts`.
- [x] T006 `system-complaint.repository.ts`.
- [x] T007 `system-complaint.service.ts` (gửi, đọc, tiếp nhận, bình luận, đã xử lý, hài lòng, yêu cầu xử lý lại).
- [x] T008 `system-complaint.controller.ts`, `.routes.ts`; mount `/system-complaints` trong `src/routes/index.ts`.

## Phase 4: Tài liệu & kiểm thử

- [x] T009 Cập nhật `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T010 Unit test `tests/system-complaint.test.ts`, thêm vào `test:unit`.
- [x] T011 Integration: luồng C06 trong `tests/authorization.integration.test.ts`; CHECK/FK bảng con trong `tests/migrations.test.ts`.
- [x] T012 `npm run validate`, `npm run test:unit`, `npm run test:local:*` liên quan; ghi kết quả thật vào PR.
