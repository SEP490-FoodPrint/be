# Feature Specification: Đồng bộ thực đơn theo tuần học và khối cho tổ chức trường học

**Branch**: `feat/organization-public-menu-weeks` | **Nhánh gốc**: `dev` | **Date**: 2026-11-16

## Bối cảnh

Phân hệ thực đơn công khai của trường học cần hỗ trợ hiển thị thực đơn theo tuần học (tính từ Thứ Hai đầu tuần) và lọc theo khối lớp học đã được phê duyệt trong năm học hiện tại.

## User Story (P1)

Là người dùng xem thực đơn công khai của trường, tôi muốn xem danh sách các tuần học hợp lệ trong năm học và chi tiết thực đơn theo khối lớp, để nắm bắt chính xác khẩu phần và thành phần bữa ăn của học sinh.

### Acceptance Scenarios

1. Truy vấn thực đơn tuần của trường với mã trường và ngày mục tiêu: trả về thông tin tuần học, khoảng ngày Thứ Hai - Thứ Sáu (weekStartDate đến weekEndDate), và danh sách khối học có thực đơn.
2. Sinh danh sách tuần học trong năm học: hỗ trợ tính toán số thứ tự tuần học chính xác từ ngày bắt đầu năm học và xác định tuần hiện tại.
3. Không làm thay đổi quyền hạn hoặc phá vỡ cấu trúc API công khai hiện có.

## Functional Requirements

- **FR-001**: Chuẩn hóa hàm tính toán tuần học và ngày Thứ Hai đầu tuần trong src/utils/date-time.ts.
- **FR-002**: Bổ sung truy vấn năm học hiện tại, các tuần đã duyệt và các khối của tuần trong organization.repository.ts.
- **FR-003**: Cập nhật DTO và service trong module organization để trả về đúng cấu trúc tuần học và khối lớp.

## Bổ sung 2026-11-19: Tách danh sách khối khỏi thực đơn tuần

**Vấn đề**: `GET /public/:schoolCode/weekly-menu` trả `portionGroups`/`gradeGroups` được suy ra từ thực đơn; khi tuần không gắn khối, service lấy nhóm suất ăn (`menu_meal_portion_groups`: Tiêu chuẩn, Dị ứng…) làm "khối", khiến bộ chọn khối ở trang công khai hiện sai.

- **FR-004**: Bổ sung `GET /public/:schoolCode/grades` trả danh mục khối gốc (`school_grades`) của trường, độc lập với thực đơn; 404 nếu không tìm thấy trường.
- **FR-005**: `PublicWeeklyMenuDTO` không còn trường `portionGroups` và `gradeGroups`; service không còn truy vấn khối của tuần hay nhóm suất ăn cho API này.
- **FR-006**: Tham số `grade` của daily-menu/weekly-menu tiếp tục lọc thực đơn theo khối (thực đơn của khối hoặc thực đơn toàn trường).

### Acceptance Scenarios (bổ sung)

4. Trường có thực đơn toàn trường kèm nhóm suất ăn dị ứng: `/grades` chỉ trả các khối của trường; weekly-menu không chứa nhóm suất ăn.
5. Tuần không có thực đơn hoặc weekly-menu lỗi: `/grades` vẫn trả đủ danh sách khối.

- **FR-007**: `/grades` nhận `week` (YYYY-MM-DD, tùy chọn, mặc định tuần hiện tại) và trả `hasMenu` cho từng khối: `true` nếu tuần đó có thực đơn toàn trường (áp dụng cho mọi khối) hoặc thực đơn riêng gán cho khối. Trang công khai bỏ lựa chọn "Toàn trường" và mặc định chọn khối đầu tiên có thực đơn (nếu không khối nào có thì chọn khối đầu tiên).

## Bổ sung 2026-11-19: Định lượng / suất theo khối và nguyên liệu món ở thực đơn ngày

**Vấn đề**: daily-menu chỉ trả tên món và `portionSize` (thường trống), không trả nguyên liệu, nên trang Chi tiết thực đơn không hiện định lượng theo khối, popup nguyên liệu trống và cột món thay thế dị ứng không có dữ liệu.

- **FR-008**: Mỗi món trong daily-menu trả `ingredients` (tên, định lượng/suất, vai trò MAIN/SEASONING, nhóm nguyên liệu, nhà cung cấp) và `recipeSource`. Nguồn định lượng theo khối `grade`: thực đơn riêng của khối → nguyên liệu đã chốt trong thực đơn (`menu_day_dish_ingredients`); thực đơn toàn trường → định lượng riêng của khối (`dish_grade_recipes`), nếu không có thì nguyên liệu đã chốt, cuối cùng là định lượng chuẩn (`dish_ingredient_entries`).
- **FR-009**: `portion` = `portionSize portionUnit` nếu có; nếu không, tổng khối lượng nguyên liệu chính quy đổi sang gam; chuỗi rỗng khi không quy đổi được.
- **FR-010**: Món thay thế dị ứng: với mỗi nhóm suất ăn không mặc định của bữa, món tiêu chuẩn không có trong nhóm được ghép (theo thứ tự hiển thị) với món chỉ nhóm đó có, trả trong `alternativeDish` kèm `allergyGroup`; món chỉ dành cho nhóm dị ứng không xuất hiện ở danh sách món chính.
