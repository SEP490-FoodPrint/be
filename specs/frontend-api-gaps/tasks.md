# Tasks: Bổ sung API còn thiếu cho frontend

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Code

- [x] T001 `ticketStatusFilter` trong `complaint-ticket.lifecycle.ts`; áp dụng ở `feedback` và `authority-complaint` (service + repository) (FR-001).
- [x] T002 `receivedAt` trong danh sách `reporting` (repository, Response DTO, service) (FR-002).
- [x] T003 `supplierIntakeState` trong `GET /api/supplier-staff` (repository, Response DTO, service) (FR-003).

## Phase 2: Tài liệu & kiểm thử

- [x] T004 Test: `tests/meal-complaint.test.ts`, `tests/authority-complaint.test.ts` (ánh xạ bộ lọc theo vai trò, `400`), `tests/reporting-receive.test.ts` (`receivedAt`), `tests/supplier-staff-management.test.ts` (fixture, envelope HTTP, `404`) (SC-001).
- [x] T005 `src/modules/README.md`, `docs/AUTHORIZATION.md` (FR-004).
- [x] T006 `npm run validate`, `npm run test:unit`, spec gate.
