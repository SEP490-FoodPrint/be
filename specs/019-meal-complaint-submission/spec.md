# Gửi và theo dõi khiếu nại suất ăn

Spec này cập nhật luồng người gửi và hợp đồng tạo đơn của spec 012.

- GVCN gửi cho lớp được phân công trong ngày ăn và niên khóa áp dụng. Đại diện phụ huynh gửi cho các lớp thuộc trường mình.
- Chỉ gửi cho bữa hôm nay theo giờ Việt Nam đã phân phối hoặc đã chốt. Mỗi người gửi chỉ đọc đơn của chính mình. Ban Giám hiệu đọc và xử lý trong phạm vi trường.
- Tài khoản thuộc SYSTEM có quyền hiệu lực `meal_complaint.view` được đọc khiếu nại toàn hệ thống.
- Lưu liên kết trực tiếp đến DailyMealPortion, bảo toàn đơn và phản hồi hiện có.
- Màn người gửi có danh sách, drawer gửi và chi tiết. GVCN không thấy mã hoặc tên lớp trong mọi trạng thái giao diện.
