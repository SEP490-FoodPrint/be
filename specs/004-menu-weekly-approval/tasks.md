# Tasks: Duyệt thực đơn theo tuần

## Phase 1 - Specification

- [x] T001 Ghi yêu cầu và acceptance scenarios trong `spec.md`.
- [x] T002 Ghi thiết kế kiến trúc, transaction và kiểm soát scope trong `plan.md`.
- [x] T003 Tạo danh sách công việc triển khai và xác minh.

## Phase 2 - Contracts and data access

- [x] T004 Tạo Zod schemas cho params và body quyết định.
- [x] T005 Tạo Request DTO suy ra từ Zod schemas.
- [x] T006 Tạo Response DTO allowlist cho chi tiết và kết quả quyết định.
- [x] T007 Tạo repository đọc hồ sơ, tổng hợp suất và ghi quyết định bằng transaction client.

## Phase 3 - Business and HTTP layers

- [x] T008 Tạo service kiểm tra role/permission/school scope và map response DTO.
- [x] T009 Tạo controller parse input và dùng response helper.
- [x] T010 Gắn endpoint chi tiết và endpoint quyết định tuần vào menu router.
- [x] T011 Cập nhật tài liệu endpoint trong `src/modules/README.md`.

## Phase 4 - Verification

- [x] T012 Thêm unit tests cho validation, scope, role, trạng thái và transaction writes.
- [x] T013 Thêm test bảo đảm chi tiết dùng nhu cầu lớp đã FINALIZED.
- [x] T014 Đăng ký test mới trong `npm run test:unit`.
- [x] T015 Chạy Prettier cho các file thay đổi.
- [ ] T016 Chạy Prisma validate/generate, lint, typecheck, build và unit tests.
- [ ] T017 Chạy Spec gate và commitlint so với `origin/dev`.
- [ ] T018 Push branch và xác nhận CI/PR.
