# Feature Specification: Quản lý lớp học cho Ban Giám hiệu

**Feature Branch**: `feat/014-school-class-management`  
**Status**: In progress  
**Liên quan**: spec 011 (cấu hình năm học), luồng phân công GVCN hiện có trong module `class`

## User story

Mỗi trường là một platform riêng và tự đặt tên lớp (ví dụ "1A", "Lá 2", "10A1"); hệ thống không áp đặt khối hay cấp học. Ban Giám hiệu (BGH) cấu hình năm học, sau đó tạo lớp hoặc sao chép danh sách lớp từ niên khóa trước, rồi phân công GVCN. GVCN khai báo suất ăn cho lớp được phân công. Hiện module `class` chỉ có danh sách và phân công GVCN, nên lớp chỉ có thể được nhập trực tiếp vào cơ sở dữ liệu.

## Functional requirements

- **FR-001**: BGH MUST tạo được lớp với `name`, `academicYear` và `registeredMealPortions` (mặc định 0). `name` được trim, dài 1–120 ký tự; `registeredMealPortions` là số nguyên ≥ 0.
- **FR-002**: `academicYear` MUST là niên khóa đã được cấu hình trong `school_academic_years` của chính trường, có dạng `N-N+1` và là niên khóa hiện tại hoặc sắp tới (cùng quy tắc `isAssignableAcademicYear`). Nếu không thỏa, trả 409.
- **FR-003**: Tên lớp MUST là duy nhất trong cùng trường và niên khóa, so sánh không phân biệt hoa thường sau khi trim, tính cả lớp INACTIVE. Trùng tên trả 409, kể cả khi DB báo vi phạm unique (P2002).
- **FR-004**: BGH MUST sửa được `name` và/hoặc `registeredMealPortions` của lớp thuộc trường mình, với điều kiện niên khóa của lớp vẫn ghi được theo FR-002. Body phải có ít nhất một trường. Niên khóa của lớp không đổi được.
- **FR-005**: BGH MUST ngừng hoạt động (`INACTIVE`) hoặc kích hoạt lại (`ACTIVE`) lớp. Không có thao tác xóa cứng. Ngừng lớp đang có GVCN MUST đóng phân công hiện tại (`ended_at`, `ended_by_user_id`) trong cùng transaction. Kích hoạt lại không gán lại GVCN. Gửi đúng trạng thái hiện tại là thao tác idempotent.
- **FR-006**: BGH MUST sao chép được các lớp ACTIVE từ niên khóa nguồn sang niên khóa đích. Mỗi lớp được copy giữ `name` và `registeredMealPortions`; không copy GVCN và dị ứng. Những tên đã tồn tại ở năm đích (không phân biệt hoa thường) bị bỏ qua và được liệt kê trong kết quả. Năm đích phải thỏa FR-002 và khác năm nguồn; năm nguồn có thể đã qua. Năm nguồn không có lớp ACTIVE nào trả 404.
- **FR-007**: Mọi thao tác ghi MUST yêu cầu permission mới `class.manage`, chỉ gán cho `SCHOOL_MANAGEMENT_BOARD`, và actor phải có role BGH. Phạm vi trường lấy từ principal đã xác thực, không bao giờ từ body hay query. Lớp thuộc trường khác trả 404.
- **FR-008**: Kết quả trả về dùng `ClassItemDTO` hiện có (bao gồm `homeroomTeacher`, `canAssign`) và giữ nguyên envelope HTTP.

## Acceptance scenarios

1. Cho niên khóa 2026-2027 đã cấu hình, khi BGH tạo "1A" thì nhận 201 và lớp ACTIVE, chưa có GVCN.
2. Khi đã có "1A" (ACTIVE hoặc INACTIVE), tạo "1a" hoặc " 1A " trả 409.
3. Tạo lớp cho niên khóa chưa cấu hình, sai định dạng hoặc đã qua trả 409.
4. Tài khoản GVCN, kể cả khi được cấp `class.manage`, nhận 403.
5. Sửa hay đổi trạng thái lớp thuộc trường khác trả 404.
6. Ngừng lớp có GVCN thì phân công bị đóng; kích hoạt lại thì lớp không có GVCN.
7. Sao chép 2026-2027 sang 2027-2028 khi năm đích đã có "1A" thì tạo các lớp còn lại và trả `skipped: ["1A"]`.
8. Body thừa trường, `name` rỗng hoặc dài 121 ký tự, số suất âm trả 400.

## Constraints and edge cases

- Không migration, không DDL: bảng `classes` đã có `name`, `academic_year`, `registered_meal_portions`, `status` và unique `(school_id, name, academic_year)`.
- `school_academic_years.academic_year` là text tự do; nhãn không đúng dạng `N-N+1` không dùng được cho lớp.
- Sửa `registeredMealPortions` chỉ ảnh hưởng các lần GVCN khai báo sau (trần trong `meal-attendance`); suất ăn đã ghi không bị đổi.
- Permission mới cần chạy `npm run auth:bootstrap` sau khi merge; việc chạy trên Azure cần cho phép riêng.
