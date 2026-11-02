# API Tổng quan trường học

`GET /api/school-overview` đọc dữ liệu thực từ PostgreSQL cho các biểu đồ Tổng quan.
API dùng phiên đăng nhập hiện hành, yêu cầu `dashboard.view` và tài khoản thuộc
trường hợp lệ. `schoolId` lấy từ principal, không nhận trường do client chỉ định.

Response trong envelope chuẩn gồm:

- `school`: ID và tên trường.
- `menus`: các tuần thực đơn, title, status và weekStartDate; cần `menu.view`.
- `complaints`: số phản ánh theo status/type; cần `meal_complaint.view`.
- `suppliers`: số quan hệ theo status; cần `supplier_relationship.view` hoặc
  `supplier_relationship.manage`.
- `incidents`: ID, tiêu đề, status, occurredAt và createdAt; cần
  `food_safety_incident.view`.
- `updatedAt`: thời điểm tạo kết quả trả về.

Thiếu quyền đọc một nhóm trả `null`; có quyền nhưng chưa có bản ghi trả mảng rỗng.
Quyền dashboard không thay thế quyền nghiệp vụ. Mọi query đều giới hạn trong
trường của principal và chạy trong cùng transaction đọc.

Endpoint không ghi dữ liệu, không tạo seed, không thay đổi schema hoặc role grants.
Các biểu đồ FE tính số lượng/phân bổ từ dữ liệu trả về, không bổ sung chỉ số
hài lòng, tỷ lệ đạt chuẩn hoặc tỷ lệ đúng hạn chưa có nguồn.

Kiểm thử trong `tests/school-overview.test.ts`, được đăng ký vào `test:unit`, kiểm
tra permission, phạm vi trường và sự khác nhau giữa dữ liệu rỗng với thiếu quyền.
