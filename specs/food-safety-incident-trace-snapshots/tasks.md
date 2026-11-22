# Tasks: Snapshot truy xuất sự cố ATTP (PR5b)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261130000100_food_safety_incident_trace_snapshots` (FR-001–FR-003).
- [x] T002 Prisma schema; `prisma:validate`, `prisma:generate`.

## Phase 2: Module `food-safety-incident` (US1–US3)

- [x] T003 Repository: chuỗi truy xuất, phiên bản, tạo/đọc snapshot, đơn vị nhận bổ sung (FR-004, FR-007).
- [x] T004 Service: dựng payload + lý do thiếu + hash; snapshot ở `forward`/`createDirect`/`addAllocations`, bản chuyển bổ sung (FR-004–FR-006).
- [x] T005 Đọc: chi tiết đầy đủ thêm snapshot (FR-009); `GET /:id/trace-snapshots/:version` (FR-008).

## Phase 3: Tài liệu & kiểm thử

- [x] T006 `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T007 Unit `tests/food-safety-incident.test.ts`.
- [x] T008 Integration + migration tests.
- [x] T009 `npm run validate`, `test:unit`, `test:local:*`; ghi kết quả thật.
