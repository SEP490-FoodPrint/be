# Tasks: Thông báo ngắn gọn, dễ hiểu cho người dùng

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Thông báo

- [x] T001 Rà soát và thay các câu dài, câu in mã kỹ thuật (FR-001).
- [x] T002 Rút gọn danh sách trong thông báo bằng `shortList` (FR-002).
- [x] T003 Rút gọn câu chung cho lỗi validation và lỗi hệ thống (FR-003, FR-004).

## Phase 2: Kiểm thử & gộp dev

- [x] T004 Cập nhật unit test so khớp thông báo (SC-001).
- [x] T005 Giải quyết xung đột với `dev`, giữ logic của `dev` (FR-005).
- [x] T006 ESLint, `tsc --noEmit`, Prettier, `npm run test:unit` sau khi gộp (SC-001).
- [x] T007 Xác nhận câu cũ không quay lại ở các file đã sửa (SC-002).
- [ ] T008 Spec gate và CI đạt trên PR; chạy test tích hợp trên môi trường có CSDL.
