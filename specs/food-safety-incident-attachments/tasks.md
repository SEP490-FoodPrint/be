# Tasks: File đính kèm hồ sơ sự cố ATTP (PR-G)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261212000100_food_safety_incident_attachments` (FR-001).
- [x] T002 Prisma schema `FoodSafetyIncidentAttachment`, `FoodSafetyIncidentAttachmentStage`; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 `src/utils/evidence-files.ts`: tham số `area`, `signedEvidenceUrl` (FR-003, FR-004).

## Phase 3: Module

- [x] T004 `food-safety-incident`: file `REPORT` khi báo cáo/tự lập, `SCHOOL_REVIEW` khi chuyển ATTP; projection file; payload snapshot v2 (US1, US2, FR-005).
- [x] T005 `food-safety-inspection`: file `INSPECTION_RESULT` khi ghi kết quả; `findings` chuỗi JSON trong multipart (US3).
- [x] T006 Routes/controller: `receiveEvidenceFiles` sau kiểm tra quyền, ghép `req.files` vào body (FR-002).

## Phase 4: Tài liệu & kiểm thử

- [x] T007 `src/modules/README.md`, `docs/AUTHORIZATION.md`, plan v6.
- [x] T008 Unit `tests/food-safety-incident-attachments.test.ts`, thêm vào `test:unit`; cập nhật test hiện có.
- [x] T009 `npm run validate`, `npm run test:unit`.
