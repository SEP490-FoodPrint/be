# Feature Specification: Nhập danh sách lớp học từ Excel

**Feature Branch**: `feat/017-class-excel-import`  
**Status**: In progress  
**Liên quan**: spec 016 (quản lý lớp học cho Ban Giám hiệu)

## User story

Trường có nhiều lớp (ví dụ 50 lớp) thì Ban Giám hiệu (BGH) mất nhiều thời gian nếu phải tạo từng lớp qua form. BGH tải file Excel mẫu, điền tên lớp, số suất đăng ký và tài khoản GVCN (tùy chọn), rồi tải file lên. Hệ thống cho xem trước kết quả từng dòng và chỉ lưu khi file không còn lỗi. BGH cũng xuất được danh sách lớp của một niên khóa ra Excel.

Frontend tạo file mẫu, đọc file `.xlsx` và xuất Excel. Backend không nhận file: nó nhận danh sách dòng đã đọc dưới dạng JSON, kiểm tra toàn bộ quy tắc nghiệp vụ và lưu.

## Functional requirements

- **FR-001**: BGH MUST gửi được `POST /api/classes/import` với `academicYear`, `dryRun` và `rows` (1–300 dòng). Mỗi dòng có `rowNumber` (số dòng trong file, để hiển thị), `name`, `registeredMealPortions` (tùy chọn) và `teacherUsername` (tùy chọn).
- **FR-002**: `academicYear` MUST thỏa quy tắc ghi của spec 016 (đã cấu hình cho trường, dạng `N-N+1`, hiện tại hoặc sắp tới); nếu không, trả 409 cho cả request.
- **FR-003**: Backend MUST kiểm tra từng dòng và trả trạng thái `CREATE`, `SKIP` hoặc `ERROR` kèm danh sách lý do:
  - `name` sau khi trim phải dài 1–120 ký tự.
  - `registeredMealPortions` để trống thì bằng 0; nếu có, phải là số nguyên ≥ 0 (chấp nhận chuỗi số từ Excel).
  - Tên trùng với một dòng khác trong file (không phân biệt hoa thường) là `ERROR` ở dòng xuất hiện sau.
  - Tên đã tồn tại trong niên khóa, kể cả lớp INACTIVE, là `SKIP` (giống sao chép lớp). Dòng `SKIP` không gán GVCN.
  - `teacherUsername` nếu có phải là tài khoản `HOMEROOM_TEACHER` ACTIVE của trường (so sánh không phân biệt hoa thường), chưa là GVCN hiện tại của lớp khác trong niên khóa và không được dùng cho hai dòng `CREATE` trong file.
- **FR-004**: Khi `dryRun = true`, backend MUST không ghi gì và trả kết quả từng dòng cùng tổng số dòng theo trạng thái.
- **FR-005**: Khi `dryRun = false`, nếu còn dòng `ERROR` thì MUST trả 409 và không ghi gì. Nếu không có lỗi, backend MUST tạo mọi lớp `CREATE` cùng phân công GVCN của chúng trong một transaction và trả về các lớp đã tạo (`ClassItemDTO`).
- **FR-006**: Endpoint MUST yêu cầu `class.manage` và role BGH. Nếu có dòng nào điền `teacherUsername`, actor MUST có thêm `class_assignment.manage`. Phạm vi trường lấy từ principal, không lấy từ body.

## Acceptance scenarios

1. Xem trước 3 dòng hợp lệ "1A", "1B" (kèm GVCN rảnh), "1C" trả 3 dòng `CREATE`, không ghi dữ liệu.
2. Lưu chính file đó trả 201, tạo 3 lớp và lớp "1B" có GVCN.
3. Dòng có tên đã tồn tại trong niên khóa (kể cả "1a" so với "1A", lớp INACTIVE) là `SKIP`; lưu file chỉ có dòng `CREATE`/`SKIP` vẫn thành công.
4. Tên rỗng, dài 121 ký tự, số suất âm hoặc không phải số, tên trùng trong file, GVCN không tồn tại, GVCN đang chủ nhiệm lớp khác, một GVCN cho hai dòng: mỗi trường hợp là `ERROR` với lý do tương ứng.
5. Lưu khi còn dòng `ERROR` trả 409 và không tạo lớp nào.
6. Niên khóa chưa cấu hình hoặc đã qua trả 409; tài khoản không phải BGH nhận 403; có `teacherUsername` mà thiếu `class_assignment.manage` nhận 403.
7. Body thừa trường, `rows` rỗng hoặc hơn 300 dòng trả 400.

## Constraints and edge cases

- Không migration, không DDL, không thêm dependency cho backend.
- Body JSON 300 dòng nằm trong giới hạn mặc định 100kb của `express.json()`.
- `withSchoolTransaction` khóa dòng `schools`, nên kết quả kiểm tra khi lưu nhất quán với dữ liệu tại thời điểm ghi; kết quả xem trước có thể khác nếu dữ liệu đổi giữa hai lần gọi.
