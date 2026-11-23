# Plan

Triển khai cùng [kế hoạch tỷ lệ hao hụt nguyên liệu](ingredient-waste-rate/plan.md).

1. DB (FR-001): migration `prisma/migrations/20261205000100_dish_standard_portion` thêm cột nullable + CHECK, comment DEPRECATED cho `dish_grade_recipe_lines`; `prisma/schema.prisma` thêm `Dish.standardQuantity`, `Dish.standardUnit`, `DishGradeRecipe.portionQuantity`, sửa comment `DishIngredientEntry.requiredQuantity`, đánh dấu `DishGradeRecipeLine` deprecated.
2. Helper (FR-003, FR-004): `src/utils/dish-portion.ts` với `standardQuantityIssue`, `scaleDishQuantity`, `scaleDishLines`.
3. Module dish (FR-004–FR-006, FR-008, FR-009): validation, repository (`saveGradeRecipes` ghi `portionQuantity`, không ghi lines), service (`save`, `selectDishGradeRecipes`, `recipeDTO`, `readDatabaseMealRecipe`), response DTO.
4. Module khác (FR-007): `kitchen` (allocationGradeRecipes + snapshot), `meal-allocation` (gradeLines), `supply-order/fresh-demand` (đọc công thức mốc chuẩn + khẩu phần), `organization` (thực đơn công khai), `scripts/seed-week.ts`.
5. FE: form món (mốc chuẩn, khẩu phần từng khối), xem món, xem trước công thức thực đơn.
6. Test: `tests/dish-recipes.test.ts` (helper + validation) và cập nhật test liên quan; typecheck, lint, `npm run test:unit`.
7. Đợt dọn dẹp (FR-010–FR-012): `isScaledUnit` trong `src/utils/dish-portion.ts`; migration `20261206000100_dish_standard_portion_cleanup`; `schema.prisma` bỏ model `DishGradeRecipeLine` và đổi ba trường sang bắt buộc; `menu.service` báo 422 thay vì tạo món theo tên; cập nhật test và FE.

## Constitution Check

- I–II. API món và hao hụt giữ phân lớp module. Truy vấn và cập nhật theo phạm vi trường đã xác thực.
- III–IV. Các thay đổi schema đi kèm migration có phiên bản và bước dừng khi còn dữ liệu chưa chuyển. Các thao tác ghi giữ ranh giới transaction hiện hành.
- V. API giữ envelope và serialize định lượng Decimal theo hợp đồng.
- VI. Bản thay đổi này đi cùng spec, kế hoạch và công việc của hai luồng tính định lượng.
- VII. Tính năng không tạo mã nghiệp vụ mới.
