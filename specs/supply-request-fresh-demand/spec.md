# Tính nhu cầu nguyên liệu tươi theo khối và đợt giao

- Tính theo trường, ngày giao, thực đơn đã duyệt, công thức theo khối và số suất của cả bữa chính lẫn bữa xế. Quy đổi về đơn vị đặt và cộng theo nguyên liệu. Báo lỗi khi thiếu dữ liệu bắt buộc hoặc phạm vi thực đơn bị trùng.
- Đợt 1 lấy phần nguyên của một nửa số suất kế hoạch theo từng khối. Lượng đặt được làm tròn xuống và phần lẻ được lưu để chuyển sang Đợt 2. Lưu chung mốc số suất và lượng chuyển theo trường và ngày giao cho các nhà cung cấp.
- Đợt 2 lấy số suất đã chốt trừ mốc Đợt 1 theo khối, tối thiểu bằng 0, rồi cộng lượng chuyển. Với các đơn Đợt 1 cũ, khôi phục mốc suất còn thiếu. Khi tạo đơn khô, tiếp tục dùng quy trình hiện hành.
- API nhận ngày giao và số đợt. Phạm vi trường lấy từ phiên đăng nhập. Bảng nhập hàng hiển thị các lượng tính tự động ở chế độ chỉ đọc. Đợt 2 cho nhập lượng giao thêm.
