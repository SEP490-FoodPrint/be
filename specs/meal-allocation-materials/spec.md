# Phân bổ theo nguyên liệu và suất thập phân

## Yêu cầu

- FR-010 Với bữa chưa có nhóm suất, trừ số suất dị ứng đã chốt một lần cho từng lớp và món có nguyên liệu khớp. Dùng cùng nhu cầu khi mở phân bổ, lưu và xác nhận giao. Giữ tổng chốt và số liệu chế biến, lưu mẫu. Đối soát khi thiếu dữ liệu để xác định số suất hoặc món.

- FR-001 Phương án tự động theo bữa, khối, món và lớp dựa trên lượng nguyên liệu của lô và định lượng từng khối đã chụp khi chế biến. Mọi thành phần phải đủ, đơn vị không tương thích bị chặn.
- FR-002 allocatedPortions Decimal(20,2), tổng mỗi lớp-món bằng nhu cầu nguyên; phân phối 0.01 theo phần dư lớn nhất, tie ưu tiên giá trị nhỏ rồi thứ tự lô. Lưu suất lý thuyết và lượng nguồn riêng, cho phép 0.00 chỉ khi có lượng nguồn dương.
- FR-003 Lưu nháp và áp dụng kiểm tra revision, quyền, phạm vi, nhu cầu theo món và nguồn nguyên liệu trong transaction. Cho phép sửa bản đã áp dụng đến khi xác nhận giao.
- FR-004 Ưu tiên ít liên kết lớp-lô, ít khối dùng chung lô, thứ tự lô ổn định. Giới hạn solver 10 giây, chỉ chấp nhận nghiệm kiểm tra hợp lệ.
- FR-005 FE xem trước, tổng nguyên liệu kg và suất chuỗi hai chữ số, xác nhận áp dụng; giữ chọn bữa và chế độ lịch sử.
- FR-006 Xác nhận giao cả ngày, truy xuất và blockchain phiên bản mới chứa lượng cấp chính xác và suất thập phân.
- FR-007 Lô cũ thiếu snapshot dùng định lượng thực đơn đã duyệt; với thực đơn toàn trường dùng công thức khối hiện có nếu đầy đủ. Kiểm tra từng nguyên liệu với nguồn thực dùng, revision bao gồm định lượng đang áp dụng. Khi lưu ghi định lượng thực áp dụng vào chi tiết nguyên liệu; không sửa lịch sử đã giao. Migration bảo toàn lịch sử.
- FR-008 Nhánh dữ liệu cũ phải hiển thị số lô cấp / nhu cầu của riêng khối, không lấy tổng lô toàn trường làm mẫu số. Lượng dư dùng chung tính từ tất cả khối. Chỉnh bản nháp một khối bảo toàn khối khác và trừ số lớp đã nhận từ các lô khác.

- FR-009 Sau khi bữa đủ mẫu và READY, tác vụ nền tạo đề xuất DRAFT cho mỗi trường, ngày, bữa nếu chưa có nháp hoặc phân bổ. GET chỉ đọc. PUT nháp hoặc áp dụng nhận revision và các dòng đã chỉnh, dùng kiểm tra nguồn thay cho chạy lại solver. Lưu nháp giữ nguyên bản ALLOCATED cho đến khi áp dụng.
