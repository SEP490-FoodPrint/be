# Thứ tự danh mục món ăn

Danh mục món ăn trả các món mới tạo trước, không sắp xếp tên theo bảng chữ cái. Thứ tự phải ổn định xuyên suốt các trang, dùng ID làm khóa phụ khi thời điểm tạo trùng nhau. Chỉ lấy món hoạt động của trường hiện tại, giữ nguyên quyền và hợp đồng phân trang.

Giao diện gom các món cùng nhóm liền nhau; thứ tự các nhóm theo món mới nhất của mỗi nhóm và thứ tự món trong nhóm từ mới đến cũ. Nhóm chưa phân loại là một nhóm riêng. Sau khi thêm món thành công, hiển thị danh sách không bị bộ lọc che khuất và đưa về trang đầu.
