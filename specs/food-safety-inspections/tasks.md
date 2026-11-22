# Tasks: Đợt kiểm tra ATTP và kết luận theo NCC (PR6a)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261201000100_food_safety_inspections` (FR-001–FR-003).
- [x] T002 Prisma schema; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 Quyền `food_safety_inspection.manage` + grant (FR-008).

## Phase 3: Module `food-safety-inspection` (US1–US4)

- [x] T004 Validation, request/response DTO.
- [x] T005 Repository.
- [x] T006 Service: lập đợt, ghi kết quả, đóng hồ sơ, NCC được kết luận (FR-004–FR-006).
- [x] T007 Controller, routes, mount tại `/api/food-safety-incidents`.
- [x] T008 Chi tiết hồ sơ hiển thị đợt kiểm tra; `allowedActions` (FR-007).

## Phase 4: Tài liệu & kiểm thử

- [x] T009 `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T010 Unit `tests/food-safety-inspection.test.ts`, thêm vào `test:unit`.
- [x] T011 Integration + migration tests.
- [x] T012 `npm run validate`, `test:unit`, `test:local:*`; ghi kết quả thật.
