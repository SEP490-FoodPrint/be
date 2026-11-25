# Tasks: Triển khai lại migration gỡ khiếu nại System Admin

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Migration

- [x] T001 Tăng thời gian chờ khóa và lấy khóa trước trong migration (FR-001, FR-002).
- [x] T002 Kiểm tra chỉ đọc trạng thái Azure: chưa có thay đổi nào được áp dụng (FR-003).

## Phase 2: Kiểm thử & triển khai

- [x] T003 `npm run validate`, `npm run test:local:migrations`, spec gate (SC-001).
- [ ] T004 Operator chạy `prisma migrate resolve --rolled-back` trên Azure, merge PR, xác nhận CD (FR-003, SC-001).
