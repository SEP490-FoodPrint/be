# Thông tin phân bổ và xác nhận giao suất

- Nhân viên bếp có hai tab Phân bổ suất ăn và Thông tin phân bổ suất ăn. Tab thông tin đọc dữ liệu đã lưu và cho xem theo lô hoặc theo lớp, lọc tất cả, trưa hoặc chiều.
- Tab phân bổ đặt nút Áp dụng phân bổ ở cuối. Tab thông tin gom bộ lọc vào một thanh, cho mở hoặc thu gọn tất cả lô đang hiển thị. Thẻ chi tiết làm nổi bật tên lớp hoặc lô và số suất, với tối đa sáu thẻ mỗi hàng.
- Một lần xác nhận áp dụng cho toàn bộ ngày tại trường, bất kể bộ lọc. Mọi lớp–bữa có nhu cầu dương phải đã chốt và được phân bổ đủ. Xác nhận sau khi đã giao xong cả ngày.
- Yêu cầu vai trò SCHOOL_KITCHEN_STAFF và quyền meal_allocation.update. Trường và ngày Việt Nam do server xác định. Xác nhận nguyên tử, kiểm tra revision, ghi người và thời điểm giao, hỗ trợ gửi lại và khóa sửa suất đã giao.
- Số suất lô–lớp là số suất hoàn chỉnh, mỗi món trong lô phải có cùng số suất. Phần khiếu nại nằm ngoài phạm vi.
