# Tasks: Luồng báo cáo sự cố ATTP (PR5)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261129000100_food_safety_incident_workflow` (FR-001–FR-003).
- [x] T002 Prisma schema; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 Quyền `food_safety_incident.report` + grant (FR-009); resource/scope `food-safety-incident` (FR-005).
- [x] T004 Cập nhật nơi đọc trạng thái cũ: `retained-sample`, `school-overview`, `reporting` (FR-008, FR-010).

## Phase 3: Module `food-safety-incident` (US1–US6)

- [x] T005 Validation, request/response DTO.
- [x] T006 Repository.
- [x] T007 Service (report, direct, forward, cancel, allocations, list/detail theo người xem).
- [x] T008 Controller, routes, mount tại `/api/food-safety-incidents`; xóa module `inspection`.

## Phase 4: Tài liệu & kiểm thử

- [x] T009 `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T010 Unit `tests/food-safety-incident.test.ts`, thêm vào `test:unit`; cập nhật test hiện có.
- [x] T011 Integration + migration tests.
- [x] T012 `npm run validate`, `test:unit`, `test:local:*`; ghi kết quả thật.
