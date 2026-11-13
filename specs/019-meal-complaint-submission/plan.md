# Kế hoạch

1. Sinh và kiểm tra migration backfill từ meal_allocations. Đặt khóa mới bắt buộc trước khi bỏ cột cũ.
2. Bổ sung GET /api/meal-complaints/meal-options, đổi POST sang dailyMealPortionId và siết phạm vi đọc. Giữ enum, trạng thái và luồng Ban Giám hiệu.
3. Dựng màn từ mẫu CreateAndViewComplain bằng MUI, Module SCSS và domain service. Kết nối route/sidebar theo vai trò.
4. Kiểm tra migration, phân quyền, vòng đời, build và phối hợp phát hành FE/BE.
