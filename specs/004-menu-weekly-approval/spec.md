# Feature Specification: Duyệt thực đơn theo tuần

**Feature Branch**: `fix/004-menu-weekly-approval`  
**Created**: 2026-11-06  
**Status**: In progress  
**Input**: Sửa luồng duyệt thực đơn để Ban Giám hiệu xem hồ sơ và quyết định nguyên cả tuần.

## User Scenarios & Testing

### User Story 1 - Xem hồ sơ duyệt của một tuần (Priority: P1)

Là thành viên Ban Giám hiệu, tôi muốn xem thực đơn, số suất đã được giáo viên chốt và thông tin thẩm định của một tuần thuộc trường mình trước khi quyết định.

**Independent Test**: Gọi API chi tiết bằng tài khoản Ban Giám hiệu có `menu.view`; kết quả chỉ lấy thực đơn trong trường hiện tại, sắp xếp ngày tăng dần và lấy số suất từ `DailyMealPortion` trạng thái `FINALIZED`.

**Acceptance Scenarios**:

1. **Given** tuần thuộc trường của tài khoản, **When** Ban Giám hiệu xem hồ sơ, **Then** API trả thông tin tuần, các ngày, món ăn, nhà cung cấp, thẩm định gần nhất và số suất đã chốt.
2. **Given** cùng ngày có nhu cầu bữa trưa và bữa phụ, **When** hiển thị số suất của ngày, **Then** hệ thống dùng giá trị lớn nhất giữa các ca ăn, không cộng hai ca thành hai lần học sinh.
3. **Given** tuần đang chờ duyệt lại, **When** xem hồ sơ, **Then** quyết định Ban Giám hiệu của vòng trước không được hiển thị như quyết định hiện tại.
4. **Given** mã tuần không thuộc trường hiện tại, **When** xem hồ sơ, **Then** API trả `404` và không làm lộ dữ liệu trường khác.
5. **Given** tài khoản không mang vai trò Ban Giám hiệu, **When** xem hồ sơ, **Then** API trả `403` kể cả khi tài khoản có quyền `menu.view`.

---

### User Story 2 - Quyết định nguyên tuần (Priority: P1)

Là thành viên Ban Giám hiệu, tôi muốn phê duyệt hoặc yêu cầu chỉnh sửa nguyên `WeeklyMenu` trong một giao dịch để trạng thái tuần và các ngày không lệch nhau.

**Independent Test**: Gọi API quyết định cho tuần `PENDING_APPROVAL`; kiểm tra một bản ghi lịch sử cấp tuần được tạo, toàn bộ ngày và tuần đổi cùng trạng thái trong một transaction.

**Acceptance Scenarios**:

1. **Given** tuần `PENDING_APPROVAL` hợp lệ, **When** Ban Giám hiệu chọn `APPROVED`, **Then** toàn bộ ngày và tuần đổi thành `APPROVED`, `approvedAt` nhận thời điểm duyệt và một `MenuReviewRecord` cấp tuần được tạo.
2. **Given** tuần `PENDING_APPROVAL`, **When** Ban Giám hiệu chọn `REVISION_REQUESTED` kèm lý do, **Then** toàn bộ ngày và tuần đổi thành `REVISION_REQUIRED`, `approvedAt` được xóa và lịch sử duyệt được giữ lại.
3. **Given** một số ngày mang trạng thái cũ khác nhau, **When** quyết định nguyên tuần, **Then** hệ thống vẫn cập nhật mọi ngày trong tuần, không chỉ các ngày đang chờ.
4. **Given** tuần không ở `PENDING_APPROVAL`, **When** gửi quyết định, **Then** API trả `409` và không ghi dữ liệu.
5. **Given** quyết định phê duyệt nhưng tuần không có ngày hoặc có ngày thiếu món/định mức, **When** gửi quyết định, **Then** API trả `422` và không ghi dữ liệu.
6. **Given** tài khoản không mang vai trò Ban Giám hiệu, **When** gửi quyết định, **Then** API trả `403` kể cả khi được gán quyền tương ứng.
7. **Given** body có `menuDayId` hoặc trường lạ, **When** gửi quyết định, **Then** API trả `400` vì endpoint chỉ quyết định cấp tuần.

### Edge Cases

- `REVISION_REQUESTED` bắt buộc có `feedback` sau khi trim; `APPROVED` cho phép không có feedback.
- Quyết định `APPROVED` yêu cầu `menu.approve`; yêu cầu chỉnh sửa cần `menu.review`.
- Ghi lịch sử mới với `menuDayId = null`; dữ liệu `menuDayId` cũ vẫn được giữ để đọc lịch sử, không migration/xóa dữ liệu.
- Hồ sơ không có ngày hoặc không có nhu cầu đã chốt vẫn trả cấu trúc ổn định; số suất mặc định là `0`.
- Date/DateTime được serialize rõ ràng, không trả trực tiếp Prisma record.

## Requirements

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp `GET /api/v1/menus/:menuId/approval-detail` cho Ban Giám hiệu có `menu.view`.
- **FR-002**: API chi tiết MUST giới hạn dữ liệu theo `schoolId` tin cậy từ phiên đăng nhập.
- **FR-003**: API chi tiết MUST lấy số suất từ `DailyMealPortion` có trạng thái `FINALIZED` của các lớp trong cùng trường.
- **FR-004**: Hệ thống MUST dùng `POST /api/v1/menus/:menuId/reviews` để quyết định nguyên tuần; body chỉ nhận `decision` và `feedback`.
- **FR-005**: Hệ thống MUST chỉ cho phép vai trò `SCHOOL_MANAGEMENT_BOARD` quyết định tuần.
- **FR-006**: Hệ thống MUST chỉ quyết định tuần đang ở trạng thái `PENDING_APPROVAL`.
- **FR-007**: Quyết định MUST cập nhật toàn bộ `MenuDay`, `WeeklyMenu` và tạo `MenuReviewRecord` trong cùng transaction.
- **FR-008**: Bản ghi quyết định mới MUST là bản ghi cấp tuần với `menuDayId = null`.
- **FR-009**: Phê duyệt MUST kiểm tra tuần có ngày và mọi món có định mức, món còn hoạt động trước khi ghi.
- **FR-010**: API MUST giữ response envelope hiện hữu và map output bằng allowlist DTO.
- **FR-011**: Module mới MUST tuân thủ controller, Zod validation, Request DTO, service, repository và Response DTO; service không tạo Prisma query arguments.
- **FR-012**: Thay đổi MUST không sửa Prisma schema/migration, CI/CD hoặc logic phân công lớp.

### Key Entities

- **WeeklyMenu**: Thực đơn cấp tuần, nguồn trạng thái duyệt tổng thể.
- **MenuDay**: Ngày ăn thuộc tuần; trạng thái phải đồng bộ với quyết định cấp tuần.
- **MenuReviewRecord**: Lịch sử quyết định; bản ghi mới của luồng này không gắn `menuDayId`.
- **DailyMealPortion**: Nhu cầu suất ăn theo lớp/ca; chỉ bản ghi `FINALIZED` được hiển thị.

## Success Criteria

- **SC-001**: Một quyết định hợp lệ tạo đúng một lịch sử và cập nhật tuần cùng toàn bộ ngày trong một transaction.
- **SC-002**: 100% yêu cầu sai trường hoặc sai vai trò bị từ chối mà không ghi dữ liệu.
- **SC-003**: Body quyết định cấp ngày bị từ chối ở validation trước khi vào service.
- **SC-004**: Spec gate, lint, formatting, typecheck, build và unit tests liên quan đều pass.
