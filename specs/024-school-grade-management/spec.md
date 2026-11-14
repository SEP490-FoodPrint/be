# Quản lý khối và lớp học

- Ban Giám hiệu có quyền class.manage được xem, tạo, sửa và xóa khối trong trường mình.
- Tên khối được trim và duy nhất theo trường. ID là định danh của khối. Khối còn lớp tham chiếu không được xóa.
- Lớp có thể chưa gán khối. FK ghép bảo đảm lớp và khối cùng trường. Không suy khối từ tên lớp cũ.
- API lớp nhận gradeId tùy chọn, hỗ trợ lọc theo khối và chưa gán. Khi sửa, null bỏ gán và bỏ trường giữ nguyên. Sao chép giữ khối, Excel giữ mẫu cũ.
- Sidebar có nhóm Khối & Lớp học với Khối học và Lớp học & GVCN. Hai nhóm sidebar mở độc lập.
