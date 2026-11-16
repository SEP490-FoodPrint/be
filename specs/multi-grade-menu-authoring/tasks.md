# Tasks: Multi-grade menu authoring

## Phase 1 - Specification

- [x] T001 Ghi yêu cầu và phạm vi trong specs/multi-grade-menu-authoring/spec.md.
- [x] T002 Đối chiếu hiến chương và chốt giao dịch trong specs/multi-grade-menu-authoring/plan.md.

## Phase 2 - Backend foundation

- [x] T003 [US1] Tách thao tác lưu draft trong src/modules/menu/menu.service.ts để dùng chung cùng transaction.
- [x] T004 [US1] Thêm validation, Request/Response DTO và route grade-batch trong src/modules/menu/.
- [x] T005 [US2] Bổ sung submit-group nguyên tử, ownership và quyền trong src/modules/menu/.
- [x] T006 [US2] Kiểm thử batch, công thức khối và rollback trong tests/menu-create-allergies.test.ts.

## Phase 3 - Frontend

- [x] T007 [US1] Preview công thức/dị ứng từng khối trong fe/src/services/MenuService/ và CreateMenuDayModal.jsx.
- [x] T008 [US1] Gửi batch, phục hồi lịch cùng món và xem định lượng từng khối trong fe/src/pages/SCHOOL/MenuPlanning/CreateMenu/.
- [x] T009 [US3] Gộp danh sách và chuyển khối chi tiết bằng fe/src/services/MenuService/listGrades.js và các màn danh sách.
- [x] T010 [US3] Kiểm thử API và grouping trong fe/tests/kitchen-nutrition-api.test.mjs.

## Phase 4 - Verification

- [x] T011 Chạy BE validate/test:unit/spec gate và FE test/build, ghi kết quả vào specs/multi-grade-menu-authoring/quickstart.md.
- [x] T012 Commit các file thuộc tính năng, giữ nguyên thay đổi giao diện người dùng đang làm ngoài phạm vi.

## Dependencies

- [x] T013 Correct explicit grade scope and reopening safeguards in FE/BE.
- [x] T014 Share complete-week checks for submission and both approval paths; keep holiday exemptions.
- [x] T015 Separate week/day presentation and add regressions, then run checks and commit.
- [x] T016 Hide unassigned menus before pagination/counts and from all frontend choices; verify and commit without deleting database records.
- [x] T017 Add versioned dish meal classification, validation, persistence and DTOs without changing historical menu meal types.
- [x] T018 Add the catalogue column, create/edit input and detail label using existing FoodPrint styling.
- [x] T019 Verify API, legacy preservation and browser workflows; add migration coverage for CI and commit on the current branches.
- [ ] T020 Apply the reviewed migration to Azure dev after explicit task-specific confirmation and verify legacy rows and migration history.

T003 -> T004/T005 -> T006; T007 -> T008 -> T009 -> T010; T011/T012 sau tất cả. Có thể kiểm tra FE và BE độc lập; không yêu cầu phân công agent.
