# Tasks: Khiếu nại leo thang lên ATTP (C05, PR4)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261128000100_authority_complaints` (FR-001).
- [x] T002 Prisma schema; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 Đăng ký `AC`; lifecycle `ESCALATE`, `authorityComplaintTitle`; `mapTicketFields` nhận `canEscalate`.
- [x] T004 Quyền + grant trong `permission-catalog.ts`; resource/scope `authority-complaint`.

## Phase 3: Gắn địa bàn (US4)

- [x] T005 `PUT /api/commune-food-safety-units/:id/location` (repository, DTO, service, controller, route).

## Phase 4: Module `authority-complaint` (US1–US3)

- [x] T006 Validation, request/response DTO.
- [x] T007 Repository.
- [x] T008 Service (escalate + ticket).
- [x] T009 Controller, routes, mount `/authority-complaints`.
- [x] T010 C03: `ESCALATE` trong `allowedActions`, `escalatedAuthorityComplaint`.

## Phase 5: Tài liệu & kiểm thử

- [x] T011 `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T012 Unit `tests/authority-complaint.test.ts`, thêm vào `test:unit`; cập nhật test hiện có.
- [x] T013 Integration + migration tests.
- [x] T014 `npm run validate`, `test:unit`, `test:local:*`; ghi kết quả thật.
