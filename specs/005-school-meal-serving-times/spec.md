# Feature Specification: Cấu hình giờ phục vụ bữa ăn của trường

**Feature Branch**: `feat/005-school-meal-serving-times`

**Created**: 2026-11-07

**Status**: Ready

**Input**: User description: "Ban Giám hiệu cấu hình giờ phục vụ bữa trưa và bữa phụ của trường trong phiên đăng nhập (GET/PATCH /api/schools/me/meal-times). Giờ phục vụ dùng định dạng HH:mm hoặc null (để trống ca không tổ chức); giờ bữa trưa phải trước giờ bữa phụ nếu cả hai được thiết lập. Quyền school_meal_time.manage chỉ dành cho Ban Giám hiệu."

## User Scenarios & Testing

### User Story 1 - Xem giờ phục vụ hiện tại (Priority: P1)

Là thành viên Ban Giám hiệu có quyền quản lý giờ phục vụ, tôi muốn xem khung giờ phục vụ bữa trưa và bữa phụ hiện tại của trường mình để biết cấu hình đang áp dụng.

**Why this priority**: Cần thiết để màn hình Giờ phục vụ hiển thị dữ liệu đã lưu khi người dùng truy cập.

**Independent Test**: Đăng nhập bằng tài khoản Ban Giám hiệu, gọi `GET /api/schools/me/meal-times` và kiểm tra kết quả trả về đúng dữ liệu `lunchTime` và `afternoonMealTime` của trường trong phiên.

**Acceptance Scenarios**:

1. **Given** tài khoản Ban Giám hiệu có quyền `school_meal_time.manage`, **When** gọi `GET /api/schools/me/meal-times`, **Then** hệ thống trả về HTTP 200 kèm `{ lunchTime, afternoonMealTime }` ở định dạng `"HH:mm"` hoặc `null`.
2. **Given** tài khoản không có quyền hoặc không thuộc vai trò Ban Giám hiệu, **When** gọi API đọc, **Then** hệ thống từ chối với HTTP 403.

---

### User Story 2 - Cập nhật giờ phục vụ (Priority: P1)

Là thành viên Ban Giám hiệu có quyền quản lý giờ phục vụ, tôi muốn cập nhật khung giờ phục vụ bữa trưa và bữa phụ để bếp áp dụng khi lập kế hoạch mẻ nấu.

**Why this priority**: Hành vi quản trị cốt lõi cho phép trường điều chỉnh thời gian phục vụ thực tế của các ca ăn.

**Independent Test**: Gửi payload hợp lệ (`HH:mm`, `null`), kiểm tra database cập nhật đúng trường trong phiên; gửi payload vi phạm thứ tự hoặc sai định dạng và xác nhận trả HTTP 400.

**Acceptance Scenarios**:

1. **Given** Ban Giám hiệu có quyền, **When** gửi body hợp lệ với cả `lunchTime` và `afternoonMealTime` thỏa mãn `lunchTime < afternoonMealTime`, **Then** trường trong phiên được cập nhật và trả về HTTP 200 kèm giờ mới.
2. **Given** Ban Giám hiệu có quyền, **When** gửi `afternoonMealTime: null` (trường không tổ chức bữa phụ), **Then** hệ thống cập nhật thành công và lưu `null`.
3. **Given** Ban Giám hiệu gửi giờ bữa trưa muộn hơn hoặc bằng giờ bữa phụ (ví dụ `lunchTime: "15:00"`, `afternoonMealTime: "11:30"`), **When** gửi yêu cầu, **Then** hệ thống từ chối với HTTP 400 và thông báo "Giờ bữa trưa phải trước giờ bữa phụ".
4. **Given** body chứa `schoolId` hoặc các trường không được phép, hoặc giờ sai định dạng `HH:mm`, **When** gửi yêu cầu, **Then** hệ thống từ chối với HTTP 400.

### Edge Cases

- `lunchTime` và `afternoonMealTime` ban đầu có thể là `null`.
- Client không được truyền `schoolId`; `schoolId` luôn lấy từ phiên đăng nhập `AuthPrincipal`.
- Thời gian lưu trữ trong database PostgreSQL dưới dạng kiểu `TIME` (`TIME(6)`).

## Requirements

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp `GET /api/schools/me/meal-times` để đọc giờ phục vụ của trường trong phiên.
- **FR-002**: Hệ thống MUST cung cấp `PATCH /api/schools/me/meal-times` để cập nhật giờ phục vụ của trường trong phiên.
- **FR-003**: Dữ liệu đầu vào của PATCH MUST được kiểm tra bằng Zod strict object gồm `lunchTime` và `afternoonMealTime` nhận chuỗi `"HH:mm"` (00:00 - 23:59) hoặc `null`.
- **FR-004**: Nếu cả hai giờ đều khác `null`, hệ thống MUST kiểm tra `lunchTime < afternoonMealTime`.
- **FR-005**: Cả hai endpoint MUST yêu cầu quyền `school_meal_time.manage` và vai trò `SCHOOL_MANAGEMENT_BOARD` thuộc tổ chức `SCHOOL`.
- **FR-006**: Quyền `school_meal_time.manage` MUST được khai báo trong catalog quyền và gán cho vai trò Ban Giám hiệu.
