# Feature Specification: Tích hợp cấu hình trường và quy trình GVCN

## Mục tiêu

Tích hợp các hành vi đã được duyệt từ PR #66, #65, #46 và #47 lên backend `dev` hiện tại mà không thay đổi migration đã áp dụng.

## Yêu cầu

- BGH có quyền `school_meal_times.manage` được xem và cập nhật giờ bữa trưa/bữa phụ của chính trường; giờ hợp lệ theo `HH:mm`, bữa trưa phải trước bữa phụ.
- BGH có quyền `class_assignment.manage` được xem niên khóa, giáo viên hợp lệ, gán, thay hoặc kết thúc phân công GVCN trong trường.
- Chỉ lớp ACTIVE của niên khóa hiện tại hoặc tương lai được thay đổi phân công; phân công cũ phải được đóng và giữ lịch sử.
- GVCN chỉ xem và thao tác dữ liệu suất ăn của lớp có assignment hiện hành với chính tài khoản đó.
- Backend tự xác định lớp của GVCN; không nhận `classId` tùy ý trong payload khai báo suất ăn.
- GVCN được lưu/cập nhật DRAFT, chốt FINALIZED idempotent và không được sửa bản đã chốt.
- Số suất và số suất dị ứng không được vượt dữ liệu tổng hợp của lớp.
- API giữ envelope HTTP hiện tại và tương thích các đường dẫn FE `/schools`, `/classes`, `/meal-portions` dưới prefix `/api`.

## Ràng buộc dữ liệu

- Không tạo migration mới.
- Không sửa, đổi tên hoặc format `20261107000100_class_homeroom_assignments/migration.sql`.
- Không thay đổi các bản ghi `DailyMealPortion` hiện hữu ngoài thao tác API được xác thực.

## Tiêu chí chấp nhận

- Các endpoint mới kiểm tra permission, role và school scope.
- Truy vấn GVCN dùng `teacherUserId` và `endedAt = null`, không dùng `confirmedByUserId` làm ownership.
- Kiểm tra type, build, unit test và checksum migration được báo cáo trung thực.
