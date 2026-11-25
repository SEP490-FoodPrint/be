# Tasks: File đính kèm khiếu nại (PR-F)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Migration `20261210000100_complaint_attachments` (FR-001, FR-006).
- [x] T002 Prisma schema `ComplaintAttachment`, `IngredientIssueType`; `prisma:validate`, `prisma:generate`.

## Phase 2: Nền tảng

- [x] T003 `src/utils/evidence-files.ts` (FR-002, FR-003).
- [x] T004 `complaint-ticket`: repository `addAttachments`, select file; service `withEvidence`, `mapTicketAttachment` (FR-003, FR-004).

## Phase 3: Module

- [x] T005 `feedback` (C01/C03): `title`, file khi tạo/bình luận/xử lý (US1, US2).
- [x] T006 `ingredient-quality-feedback` (C02): `title`, `issueType`, file (US1, US2).
- [x] T007 `authority-complaint` (C05): file khi chuyển/bình luận/xử lý; file của C03 gốc (US2, US3).

## Phase 4: Tài liệu & kiểm thử

- [x] T008 `src/modules/README.md`, `docs/AUTHORIZATION.md`, plan v6.
- [x] T009 Unit `tests/complaint-attachments.test.ts`, thêm vào `test:unit`; cập nhật test hiện có.
- [x] T010 `npm run validate`, `npm run test:unit`.
