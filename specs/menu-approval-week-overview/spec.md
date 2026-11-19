# Feature Specification: Duyệt thực đơn theo tuần (nhiều khối trên một màn)

**Branch**: `feat/menu-approval-week-overview` | **Nhánh gốc**: `dev` | **Date**: 2026-11-19

## Bối cảnh

Màn duyệt của BGH chỉ mở một thực đơn mỗi lần dù bộ lọc khối mặc định "Tất cả khối". Muốn xem đủ các khối của một tuần, FE phải gọi `approval-detail` N lần.

## User Story (P1)

Là BGH, tôi chọn một tuần và thấy toàn bộ thực đơn của các khối trong tuần đó, mỗi thực đơn có tên khối, nút duyệt và bảng món riêng.

### Acceptance Scenarios

1. `GET /api/v1/menus/approval-week?date=2026-11-06` (thứ Sáu) → trả các thực đơn có `weekStartDate = 2026-11-02`, `weekEndDate = 2026-11-06`.
2. Không truyền `date` → chọn tuần còn thực đơn `PENDING_APPROVAL` mới nhất; không có thì tuần mới nhất; trường chưa gửi thực đơn nào → `weekStartDate = null`, `menus = []`.
3. Mỗi phần tử `menus[]` có cùng cấu trúc với `approval-detail`, thêm `isSchoolWide` và `grades[{ id, name }]`; thực đơn toàn trường đứng đầu, sau đó theo tên khối (so sánh số tự nhiên).
4. `weeks[]` liệt kê mọi tuần có thực đơn đã gửi, mới nhất trước, kèm `total` và `pending`.

## Functional Requirements

- **FR-001**: chỉ BGH của trường hiện tại với quyền `menu.view` (như `approval-detail`); phạm vi trường lấy từ principal.
- **FR-002**: bỏ qua thực đơn `DRAFT`.
- **FR-003**: số suất mỗi ngày giữ quy tắc của `approval-detail`, tính theo khối của từng thực đơn.
- **FR-004**: `weekNumber` theo năm học chứa tuần (null nếu ngoài năm học).
- **FR-005**: `approval-detail` bổ sung `isSchoolWide`, `grades` (chỉ thêm trường, không đổi trường cũ).
- **FR-006**: không đổi schema, quyền hay luồng quyết định.

## Ngoài phạm vi

Duyệt hàng loạt nhiều thực đơn trong một lần gọi.
