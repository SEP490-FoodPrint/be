# Kế hoạch

1. Tạo migration danh mục khối và FK ghép nullable.
2. Thêm CRUD và tích hợp gán khối vào API lớp.
3. Dựng màn khối và tích hợp sidebar, form, bảng và bộ lọc lớp.
4. Kiểm thử migration, quyền và build FE/BE.

## Constitution Check

- I. Module phân lớp và DTO tách riêng.
- II. Kiểm tra class.manage, vai trò BGH và phạm vi phiên. Scope SYSTEM trả bộ lọc rỗng sau kiểm tra quyền, service từ chối SYSTEM.
- III. Migration mới và kiểm thử trên PostgreSQL tạm.
- IV. Ghi qua giao dịch trường, dùng chung transaction client.
- V. Giữ envelope và ánh xạ DTO tường minh.
- VI. Spec, kế hoạch và công việc nằm cùng nhánh tính năng.
