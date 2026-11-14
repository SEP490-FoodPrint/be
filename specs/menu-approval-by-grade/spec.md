# Feature Specification: Duyệt thực đơn theo khối

**Branch**: `feat/menu-approval-by-grade` | **Nhánh gốc**: `dev` | **Date**: 2026-11-14

## Bối cảnh

Spec 027 đã cho Nhân viên Dinh dưỡng lập thực đơn theo từng khối (`WeeklyMenuGrade`) và lọc số suất theo khối. Tuy vậy, màn duyệt của Ban Giám hiệu (BGH) vẫn còn ba điểm thiếu:

- Người đề xuất và vai trò thẩm định đang bị đặt cứng là "Cán bộ Y tế".
- BGH không thấy chi tiết theo từng khối.
- Không có cảnh báo khi một khối chưa có thực đơn trong tuần.

## User Story (P1)

Là BGH, khi mở một thực đơn chờ duyệt, tôi cần:

- biết ai đã lập thực đơn;
- biết thực đơn áp dụng cho khối nào, mỗi khối có bao nhiêu lớp và bao nhiêu suất;
- được cảnh báo về khối chưa có thực đơn trong tuần và về các lớp chưa gán khối,

để tránh phê duyệt mà bỏ sót học sinh.

### Acceptance Scenarios

1. Thực đơn do người dùng "Nguyễn Dinh Dưỡng" lập thì `summary.proposer` là "Nguyễn Dinh Dưỡng", còn `proposerDetail` là "Nhân viên Dinh dưỡng · <tên trường>".
2. Thực đơn gắn Khối 1 và Khối 3, trong đó Khối 2 có lớp ACTIVE nhưng không thực đơn nào trong tuần phủ tới: response có cảnh báo "Khối chưa có thực đơn trong tuần: Khối 2".
3. Khối áp dụng không có lớp ACTIVE trong niên khóa của tuần: response có cảnh báo tương ứng.
4. Còn lớp ACTIVE chưa gán khối: response có cảnh báo kèm số lớp.
5. Thực đơn toàn trường phủ mọi khối: không có cảnh báo về thiếu khối.

## Functional Requirements

- **FR-001**:
  - `summary.proposer` lấy tên người tạo thực đơn (`WeeklyMenu.createdByUserId`).
  - Nhãn vai trò dùng "Nhân viên Dinh dưỡng" cho cả `proposerDetail` và `medicalReview.role`.
- **FR-002**: response chi tiết có thêm `gradeCoverage { academicYear, grades[], unassignedActiveClasses, warnings[] }`. Mỗi phần tử của `grades[]` gồm `id`, `name`, `activeClasses`, `portions`, `inThisMenu`, `hasMenuThisWeek`.
- **FR-003**: niên khóa dùng để đếm lớp là niên khóa chứa `weekStartDate`, tính theo `currentAcademicYear`.
- **FR-004**: `portions` của một khối = tổng theo từng ngày, trong đó mỗi ngày lấy bữa đông nhất. Bữa trưa và bữa chiều không cộng dồn, cùng quy tắc với `days[].portions`. Chỉ tính suất ở trạng thái FINALIZED.
- **FR-005**: `hasMenuThisWeek` = true khi thỏa một trong các điều kiện:
  - khối thuộc thực đơn này;
  - khối thuộc thực đơn khác của cùng trường trong cùng tuần;
  - tuần đó có thực đơn toàn trường.
- **FR-006**: mọi truy vấn đều lọc theo `schoolId` lấy từ principal. Không đổi quyền, không đổi luồng phê duyệt, không có migration.

## Ngoài phạm vi

- `compliance` và `documents` (vẫn trả mảng rỗng).
- Chặn phê duyệt khi còn cảnh báo. Cảnh báo chỉ để thông tin.
