# Tasks: Chặn xử lý lô nấu ngoài khung giờ bữa

**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## Phase 1: Chặn theo khung giờ

- [x] T001 Thêm `assertMealWindow` và tiêm `now` vào dịch vụ bếp (FR-001, FR-002, FR-004).
- [x] T002 Kiểm tra khung giờ trong `confirm` và `complete`, giữ hành vi gọi lại (FR-003).

## Phase 2: Kiểm thử

- [x] T003 `tests/meal-window.test.ts`, thêm vào `test:unit` (SC-001).
- [x] T004 Cố định thời điểm cho test tích hợp xử lý lô (SC-002).
- [x] T005 ESLint, `tsc --noEmit`, Prettier, `npm run test:unit` (SC-001).
- [ ] T006 Spec gate và test tích hợp đạt trên CI (SC-002).
