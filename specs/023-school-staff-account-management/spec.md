# Feature Specification: Quản lý tài khoản nhân viên trường học

**Feature Branch**: `feat/023-school-staff-account-management`

**Created**: 2026-11-13

**Status**: Đã triển khai và kiểm chứng

**Input**: Quản lý danh sách và vòng đời tài khoản nhân sự trường học thuộc 6 vai trò nhân viên: Ban giám hiệu (`SCHOOL_MANAGEMENT_BOARD`), Cán bộ dinh dưỡng/y tế (`SCHOOL_NUTRITION_OFFICER`), Nhân viên bếp (`SCHOOL_KITCHEN_STAFF`), Giáo viên chủ nhiệm (`HOMEROOM_TEACHER`), Ban đại diện cha mẹ học sinh (`PARENTS_COMMITTEE`), Ban quản lý nguyên liệu (`INGREDIENT_MANAGEMENT_DEPARTMENT`). Danh sách không hiển thị tài khoản Quản trị trường (`SCHOOL_ADMINISTRATION`). Mật khẩu khởi tạo mặc định là `123456`. Cho phép tạo tài khoản mới, cập nhật thông tin và chuyển đổi trạng thái hoạt động (ACTIVE / INACTIVE).

## Clarifications

### Session 2026-11-13

- Q: Danh sách tài khoản nhân sự trường học hiển thị những vai trò nào? → A: Chỉ hiển thị 6 vai trò nhân viên trường học: `SCHOOL_MANAGEMENT_BOARD`, `SCHOOL_NUTRITION_OFFICER`, `SCHOOL_KITCHEN_STAFF`, `HOMEROOM_TEACHER`, `PARENTS_COMMITTEE`, `INGREDIENT_MANAGEMENT_DEPARTMENT`. Không bao gồm tài khoản Quản trị trường (`SCHOOL_ADMINISTRATION`) và các tài khoản thuộc tổ chức khác.
- Q: Mật khẩu mặc định khi tạo tài khoản mới cho nhân viên trường là gì? → A: Mật khẩu mặc định khởi tạo là `123456`, được mã hóa bằng bcrypt với salt rounds tiêu chuẩn trước khi lưu trữ vào cơ sở dữ liệu.
- Q: Quyền hạn yêu cầu để thao tác quản lý tài khoản nhân viên trường là gì? → A: Yêu cầu quyền `school_user.manage` và người thực hiện phải thuộc đúng trường học (`schoolId`).
- Q: Quy tắc kích hoạt / hủy kích hoạt tài khoản nhân viên trường? → A: Chuyển đổi trạng thái giữa `ACTIVE` và `INACTIVE`. Không cho phép tự đổi trạng thái tài khoản của chính mình.
- Q: Mã vai trò Ban quản lý nguyên liệu được đồng bộ như thế nào giữa frontend và backend? → A: Frontend gửi `INGREDIENT_MANAGEMENT`, backend ánh xạ linh hoạt sang mã vai trò chuẩn trong cơ sở dữ liệu là `INGREDIENT_MANAGEMENT_DEPARTMENT`.

## User Scenarios & Testing

### User Story 1 - Truy vấn danh sách tài khoản nhân viên trường học (Priority: P1)

Là Quản trị viên trường học (`SCHOOL_ADMINISTRATION`), tôi muốn xem danh sách nhân viên trong trường thuộc các vai trò nghiệp vụ (BGH, dinh dưỡng, bếp, GVCN, ban phụ huynh, quản lý nguyên liệu) để nắm bắt và quản lý phân quyền nhân sự.

**Why this priority**: Đây là màn hình cơ bản phục vụ toàn bộ nghiệp vụ quản lý nhân sự tại trường học.

**Independent Test**: Gửi `GET /api/schools/:schoolId/accounts` với query phân trang, tìm kiếm theo tên/email/username/phone, lọc theo role hoặc status.

**Acceptance Scenarios**:

1. **Given** người dùng có quyền `school_user.manage` của trường, **When** gửi yêu cầu lấy danh sách tài khoản, **Then** hệ thống trả về danh sách nhân viên thuộc trường kèm thông tin vai trò, trạng thái, họ tên, email, số điện thoại.
2. **Given** trong DB có tài khoản `SCHOOL_ADMINISTRATION` thuộc trường, **When** lấy danh sách tài khoản nhân viên, **Then** danh sách kết quả loại trừ tài khoản `SCHOOL_ADMINISTRATION`.
3. **Given** người dùng gửi bộ lọc theo vai trò hợp lệ (ví dụ `HOMEROOM_TEACHER` hoặc `INGREDIENT_MANAGEMENT`), **When** thực thi truy vấn, **Then** kết quả chỉ chứa các tài khoản đúng vai trò đã lọc.

---

### User Story 2 - Tạo tài khoản nhân viên mới với mật khẩu mặc định (Priority: P1)

Là Quản trị viên trường học, tôi muốn tạo tài khoản mới cho nhân sự vào làm việc tại trường, với mật khẩu ban đầu là `123456`.

**Why this priority**: Cần thiết để cấp tài khoản cho nhân sự mới vận hành hệ thống.

**Independent Test**: Gửi `POST /api/schools/:schoolId/accounts` với thông tin họ tên, username, email, số điện thoại, vai trò và ghi nhận tài khoản được tạo thành công với mật khẩu mặc định đã băm.

**Acceptance Scenarios**:

1. **Given** dữ liệu hợp lệ và vai trò thuộc 6 vai trò nhân viên trường học, **When** quản trị viên tạo tài khoản, **Then** hệ thống tạo bản ghi người dùng với mật khẩu băm của `123456`, trạng thái `ACTIVE`, gán đúng `schoolId` và vai trò tương ứng.
2. **Given** email hoặc username đã tồn tại trong hệ thống, **When** gửi yêu cầu tạo tài khoản, **Then** hệ thống từ chối với mã lỗi 409 Conflict.
3. **Given** vai trò không thuộc danh mục vai trò nhân viên trường học được phép (hoặc cố tình tạo `SCHOOL_ADMINISTRATION`), **When** gửi yêu cầu, **Then** hệ thống từ chối với mã lỗi 400 Bad Request.

---

### User Story 3 - Cập nhật thông tin và trạng thái tài khoản nhân viên (Priority: P1)

Là Quản trị viên trường học, tôi muốn cập nhật họ tên, số điện thoại, vai trò hoặc bật/tắt trạng thái hoạt động của nhân viên khi có thay đổi nhân sự.

**Why this priority**: Đảm bảo thông tin nhân viên luôn chính xác và có thể thu hồi quyền truy cập khi nhân viên nghỉ việc hoặc tạm dừng công tác.

**Independent Test**: Gửi `PUT /api/schools/:schoolId/accounts/:userId` và `PATCH /api/schools/:schoolId/accounts/:userId/status`.

**Acceptance Scenarios**:

1. **Given** tài khoản nhân viên thuộc trường, **When** quản trị viên cập nhật họ tên, số điện thoại hoặc vai trò, **Then** thông tin được lưu lại và phản hồi dữ liệu cập nhật mới nhất.
2. **Given** tài khoản đang `ACTIVE`, **When** quản trị viên gọi PATCH chuyển đổi trạng thái thành `INACTIVE`, **Then** trạng thái người dùng đổi thành `INACTIVE`.
3. **Given** quản trị viên cố gắng cập nhật hoặc đổi trạng thái tài khoản thuộc trường khác hoặc tài khoản của chính mình, **When** gửi yêu cầu, **Then** hệ thống từ chối với mã lỗi 403 Forbidden hoặc 404 Not Found.

## Requirements

### Functional Requirements

- **FR-001**: API `GET /api/schools/:schoolId/accounts` trả về danh sách nhân viên trường phân trang, hỗ trợ `search`, `role`, `status`. Loại trừ vai trò `SCHOOL_ADMINISTRATION`.
- **FR-002**: API `POST /api/schools/:schoolId/accounts` tạo người dùng mới thuộc trường, thiết lập mật khẩu khởi tạo mặc định là `123456` (được băm bằng bcryptjs).
- **FR-003**: API `PUT /api/schools/:schoolId/accounts/:userId` cập nhật thông tin nhân viên trường (`fullName`, `phone`, `roleId`/`role`).
- **FR-004**: API `PATCH /api/schools/:schoolId/accounts/:userId/status` cập nhật trạng thái `status` (`ACTIVE` hoặc `INACTIVE`).
- **FR-005**: Mọi thao tác đều được bảo vệ bởi middleware xác thực và quyền hạn `school_user.manage` với phạm vi tổ chức trường học (`schoolId`).
- **FR-006**: Hỗ trợ 6 vai trò nhân viên trường học: `SCHOOL_MANAGEMENT_BOARD`, `SCHOOL_NUTRITION_OFFICER`, `SCHOOL_KITCHEN_STAFF`, `HOMEROOM_TEACHER`, `PARENTS_COMMITTEE`, `INGREDIENT_MANAGEMENT_DEPARTMENT` (cho phép alias `INGREDIENT_MANAGEMENT`).

### Non-Functional Requirements

- **NFR-001**: Bảo mật mật khẩu: không bao giờ lưu trữ plain text password, sử dụng bcryptjs để hash mật khẩu.
- **NFR-002**: Phản hồi DTO nhất quán theo format chuẩn `successResponse` với ISO date string.
- **NFR-003**: Dữ liệu được bọc trong database transaction đảm bảo tính toàn vẹn và nguyên tử.
