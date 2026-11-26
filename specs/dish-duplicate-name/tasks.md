# Tasks: Báo rõ khi tạo món trùng tên

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Trùng tên món

- [x] T001 Kiểm tra trùng tên trước khi lưu món (FR-001, FR-003).
- [x] T002 Đổi lỗi ràng buộc duy nhất khi ghi món thành 409 (FR-002).

## Phase 2: Kiểm thử

- [x] T003 Test trùng tên và cập nhật mock lưu món trong `tests/menu-create-allergies.test.ts` (SC-001).
- [x] T004 ESLint, `tsc --noEmit`, Prettier, `npm run test:unit` (SC-001).
- [ ] T005 Spec gate và CI đạt trên PR.
