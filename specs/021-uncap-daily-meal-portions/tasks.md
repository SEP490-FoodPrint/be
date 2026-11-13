# Tasks: Bỏ giới hạn trần suất ăn bán trú và sắp xếp lịch sử theo ngày

## Backend

- [x] T001 Bỏ kiểm tra `input.totalPortions > assigned.registeredMealPortions` trong `saveDraft`.
- [x] T002 Cập nhật `orderBy: [{ mealDate: "desc" }, { mealType: "asc" }, { id: "desc" }]` trong `getAll`.
- [x] T003 Thêm unit test xác minh GVCN khai báo vượt số suất đăng ký đầu năm thành công.
- [x] T004 Kiểm tra `npm run test:unit`, `npm run typecheck`, `npm run build`.
