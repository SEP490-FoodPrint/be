# Kế hoạch thực thi

1. Mở rộng GET /api/meal-allocations với distribution gồm dữ liệu lớp–bữa, phân bổ theo lô, tổng số suất và khả năng xác nhận. Giữ hợp đồng biên tập hiện tại.
2. Thêm POST /api/meal-allocations/confirm-distribution nhận revision. Dùng giao dịch trường hiện có, cập nhật các allocation ALLOCATED sang DISTRIBUTED, giữ nguyên lịch sử đã giao. Dùng schema hiện có.
3. Dùng tab MUI theo mẫu Cấu hình trường học và token FoodPrint. Dữ liệu đã lưu cho hai góc nhìn, một hộp thoại xác nhận cả ngày, giữ bản nháp khi đổi tab.
4. Kiểm tra projection, tính toàn vẹn giao dịch, phạm vi ngày/trường/vai trò và build hai repo.
