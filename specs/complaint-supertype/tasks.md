# Tasks: Bảng cha khiếu nại và luồng ticket chung (PR1)

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Schema

- [x] T001 Viết migration `prisma/migrations/20261126000100_complaint_supertype/migration.sql`: guard bảng rỗng, enum mới, `complaints`, dựng lại 2 bảng con, `complaint_comments`, `complaint_status_histories`, gỡ enum/sequence cũ.
- [x] T002 Cập nhật `prisma/schema.prisma` khớp migration; `prisma:validate`, `prisma:generate`.

## Phase 2: Lõi ticket dùng chung

- [x] T003 `src/modules/complaint-ticket/complaint-ticket.lifecycle.ts` (quy tắc thuần) + test `tests/complaint-ticket.test.ts`.
- [x] T004 `src/modules/complaint-ticket/complaint-ticket.repository.ts`.

## Phase 3: Khiếu nại suất ăn (US1, US2, US4)

- [x] T005 `feedback` validation/DTO: bỏ `HEALTH_ISSUE` khi tạo, trạng thái lọc mới, body `content`/`reason`.
- [x] T006 `feedback` repository/service/controller/routes theo FR-011.
- [x] T007 Cập nhật `resource-access.ts` scope `feedback`, `school-overview.service.ts`, `seed-week.ts`.

## Phase 4: Phản ánh nguyên liệu (US1, US2, US4)

- [x] T008 `ingredient-quality-feedback` repository/service/controller/routes/DTO theo FR-011; giữ khóa thứ tự và kiểm tra lại actor của NCC.

## Phase 5: Tự đóng (US3)

- [x] T009 `src/utils/complaint-auto-close.ts` + runtime, khởi động trong `server.ts`; test không cần hạ tầng.
- [x] T010 `business-code-backfill.ts`: bỏ `MC`.

## Phase 6: Tài liệu & kiểm thử

- [x] T011 Cập nhật `src/modules/README.md`, `docs/AUTHORIZATION.md`.
- [x] T012 Cập nhật test unit (`meal-complaint`, `ingredient-quality-feedback`, `school-overview`, `business-code*`) và integration (`authorization`, `supplier-onboarding`, `migrations`); thêm test mới vào `test:unit`.
- [x] T013 `npm run validate`, `npm run test:unit`, `npm run test:local:*` liên quan; ghi kết quả thật vào PR.
