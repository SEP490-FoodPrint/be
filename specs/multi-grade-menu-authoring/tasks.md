# Tasks: Multi-grade menu authoring

## Phase 1 - Specification

- [x] T001 Ghi yêu cầu và phạm vi trong specs/multi-grade-menu-authoring/spec.md.
- [x] T002 Đối chiếu hiến chương và chốt giao dịch trong specs/multi-grade-menu-authoring/plan.md.

## Phase 2 - Backend foundation

- [ ] T003 [US1] Tách thao tác lưu draft trong src/modules/menu/menu.service.ts để dùng chung cùng transaction.
- [ ] T004 [US1] Thêm validation, Request/Response DTO và route grade-batch trong src/modules/menu/.
- [ ] T005 [US2] Bổ sung submit-group nguyên tử, ownership và quyền trong src/modules/menu/.
- [ ] T006 [US2] Kiểm thử batch, công thức khối và rollback trong tests/menu-create-allergies.test.ts.

## Phase 3 - Frontend

- [ ] T007 [US1] Preview công thức/dị ứng từng khối trong fe/src/services/MenuService/ và CreateMenuDayModal.jsx.
- [ ] T008 [US1] Gửi batch, phục hồi lịch cùng món và xem định lượng từng khối trong fe/src/pages/SCHOOL/MenuPlanning/CreateMenu/.
- [ ] T009 [US3] Gộp danh sách và chuyển khối chi tiết bằng fe/src/services/MenuService/listGrades.js và các màn danh sách.
- [ ] T010 [US3] Kiểm thử API và grouping trong fe/tests/kitchen-nutrition-api.test.mjs.

## Phase 4 - Verification

- [ ] T011 Chạy BE validate/test:unit/spec gate và FE test/build, ghi kết quả vào specs/multi-grade-menu-authoring/quickstart.md.
- [ ] T012 Commit các file thuộc tính năng, giữ nguyên thay đổi giao diện người dùng đang làm ngoài phạm vi.

## Dependencies

T003 -> T004/T005 -> T006; T007 -> T008 -> T009 -> T010; T011/T012 sau tất cả. Có thể kiểm tra FE và BE độc lập; không yêu cầu phân công agent.
