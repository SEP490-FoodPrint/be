# Implementation Plan: Đồng bộ thực đơn theo tuần học và khối cho tổ chức trường học

**Branch**: `feat/organization-public-menu-weeks` | **Spec**: [spec.md](spec.md)

## Thay đổi

- `src/utils/date-time.ts`: bổ sung các hàm tiện ích getSchoolMonday, getSchoolWeekSchedule, calculateAcademicWeekNumber, generateAcademicWeeks.
- `src/modules/menu/menu.service.ts`: tái sử dụng các hàm tiện ích ngày học từ src/utils/date-time.ts.
- `src/modules/organization/organization.repository.ts`: thêm findCurrentAcademicYear, findApprovedWeekStartDates, findWeekGrades.
- `src/modules/organization/organization.response.dto.ts`: bổ sung các trường tuần học và khối lớp trong DTO.
- `src/modules/organization/organization.service.ts`: tích hợp tính toán tuần học và lọc thực đơn theo khối.
- `tests/organization.test.ts`: cập nhật mock repository cho unit tests.

## Constitution Check

- I. Phân lớp kiến trúc: Pass (Controller -> Service -> Repository).
- II. Scope theo principal: Pass (API công khai tuân thủ phạm vi trường học).
- III. Không DDL/migration: Pass (không thay đổi schema database).
- IV. Transaction: Pass (các truy vấn đọc dữ liệu tuân thủ chuẩn read transaction).
- V. DTO tương thích: Pass.
- VI. Spec đi cùng PR: Pass.

## Bổ sung 2026-11-19: Tách danh sách khối

- `organization.routes.ts`/`controller`/`validation`/`service`/`repository`: thêm `GET /public/:schoolCode/grades` (findSchoolGrades).
- `organization.service.ts`: bỏ khối `dynamicGroups` trong getPublicWeeklyMenu; `organization.repository.ts`: bỏ findWeekGrades, findPortionGroupsRaw, RawPortionGroup.
- `organization.response.dto.ts`: bỏ `PortionGroupDTO`, `portionGroups`, `gradeGroups` khỏi PublicWeeklyMenuDTO.
- `tests/organization.test.ts`: bỏ stub đã gỡ.
- Constitution: không DDL/migration; API công khai chỉ đọc, scope theo mã trường. Thay đổi phá vỡ hợp đồng có chủ đích: client duy nhất (FoodPrintFE public pages) được cập nhật cùng lúc.
- `/grades?week=`: thêm `publicSchoolGradesQuerySchema`, `findWeekMenuCoverage` (thực đơn APPROVED/PENDING_APPROVAL có ngày đã duyệt), `PublicSchoolGradeDTO { id, name, hasMenu }`.
- Thực đơn ngày: `publicMenuDayInclude` lấy thêm `WeeklyMenu.isSchoolWide`, danh mục món, định lượng chuẩn, định lượng theo khối, nguyên liệu đã chốt và nhóm suất ăn; service chọn nguồn định lượng theo khối, tính định lượng/suất, ghép món thay thế (`buildPublicMealDishes`). DTO: `PublicDishIngredientDTO`, `PublicRecipeSource`, trường tùy chọn mới trong `DishItemDTO`.
