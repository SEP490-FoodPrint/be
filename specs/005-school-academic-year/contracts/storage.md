# Storage Contract: SchoolAcademicYear

Đây là hợp đồng persistence nội bộ. Không có endpoint mới, không mở quyền cho client và không thay response HTTP trong tác vụ này.

- Một bản ghi sở hữu bởi đúng School; unique schoolId/academicYear.
- Các trường và SQL constraints theo [data-model.md](../data-model.md).
- Holidays được đọc như JSON array, mặc định []; từng mục dự kiến có date YYYY-MM-DD và reason. Array CHECK không bảo đảm nội dung từng mục.
- Prisma ghi updatedAt tự động; raw SQL phải đặt updated_at tường minh khi cập nhật.
- Không được suy ra từ việc thêm bảng rằng hệ thống đã bỏ ngày nghỉ khỏi thực đơn, chốt suất ăn hoặc lịch các lớp.
- Chức năng BGH nhập/sửa lịch và phân quyền truy cập trường cần spec/API riêng hoặc mở rộng spec trước khi triển khai.
