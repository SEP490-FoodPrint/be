# Feature Specification: Phân công giáo viên chủ nhiệm

**Feature Branch**: `feat/002-class-homeroom-assignment`

**Created**: 2026-11-06

**Status**: Approved

**Input**: BGH cần xem niên khóa, chọn giáo viên chủ nhiệm hợp lệ và gán, đổi hoặc gỡ giáo viên khỏi lớp trong trường của mình.

## User Scenarios & Testing

### User Story 1 - Xem dữ liệu phân công (Priority: P1)

BGH xem danh sách niên khóa, lớp và giáo viên chủ nhiệm hiện tại của từng lớp.

**Why this priority**: Đây là dữ liệu nền để màn hình phân công hoạt động.

**Independent Test**: Đăng nhập bằng tài khoản BGH và gọi API niên khóa, danh sách lớp; kết quả chỉ chứa dữ liệu thuộc trường hiện tại.

**Acceptance Scenarios**:

1. **Given** BGH đã xác thực, **When** lấy danh sách niên khóa, **Then** hệ thống trả các niên khóa có lớp trong trường cùng niên khóa hiện tại.
2. **Given** lớp đã có GVCN còn hiệu lực, **When** lấy danh sách lớp, **Then** kết quả hiển thị đúng GVCN hiện tại.

### User Story 2 - Gán hoặc đổi GVCN (Priority: P1)

BGH gán một tài khoản GVCN đang hoạt động và thuộc cùng trường cho một lớp.

**Why this priority**: Đây là thao tác nghiệp vụ chính của chức năng.

**Independent Test**: Gán giáo viên hợp lệ cho lớp và xác minh phân công mới có hiệu lực, phân công cũ được đóng trong cùng transaction.

**Acceptance Scenarios**:

1. **Given** lớp và giáo viên hợp lệ thuộc cùng trường, **When** BGH thực hiện gán, **Then** phân công mới có hiệu lực và lịch sử cũ được bảo toàn.
2. **Given** giáo viên không thuộc trường, sai vai trò hoặc không ACTIVE, **When** BGH thực hiện gán, **Then** hệ thống từ chối và không thay đổi lịch sử.

### User Story 3 - Gỡ GVCN (Priority: P2)

BGH gỡ phân công GVCN hiện tại khỏi một lớp thuộc trường mình.

**Why this priority**: Cho phép sửa phân công sai mà không xóa lịch sử.

**Independent Test**: Gỡ GVCN hiện tại và xác minh bản ghi được đóng thay vì bị xóa.

**Acceptance Scenarios**:

1. **Given** lớp có GVCN hiện tại, **When** BGH gỡ phân công, **Then** phân công hết hiệu lực và lịch sử vẫn còn.
2. **Given** lớp thuộc trường khác, **When** BGH gọi API gỡ, **Then** hệ thống từ chối truy cập.

### Edge Cases

- Không chấp nhận lớp hoặc tài khoản giáo viên không tồn tại.
- Không chấp nhận GVCN không ACTIVE, sai vai trò hoặc khác trường.
- Không cho phép hai phân công đang hoạt động cho cùng một lớp.
- Không lấy school ID từ query hoặc request body; phạm vi trường phải đến từ principal đã xác thực.

## Requirements

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp `GET /api/classes/academic-years` cho người có quyền xem lớp.
- **FR-002**: Hệ thống MUST cung cấp `GET /api/classes/eligible-teachers?academicYear=` cho người có quyền `class_assignment.manage`.
- **FR-003**: Danh sách giáo viên hợp lệ MUST chỉ gồm tài khoản ACTIVE, vai trò HOMEROOM_TEACHER và cùng trường với BGH.
- **FR-004**: Hệ thống MUST cung cấp `PUT /api/classes/:classId/homeroom-teacher` với body chứa `teacherUserId` hợp lệ.
- **FR-005**: Hệ thống MUST cung cấp `DELETE /api/classes/:classId/homeroom-teacher` để đóng phân công hiện tại.
- **FR-006**: Gán, đổi hoặc gỡ MUST được thực hiện atomically và giữ lịch sử phân công.
- **FR-007**: Mọi thao tác MUST kiểm tra xác thực, quyền và school scope ở backend.
- **FR-008**: Một lớp MUST không có nhiều hơn một phân công đang hoạt động tại cùng thời điểm.
- **FR-009**: Chức năng MUST không tạo tài khoản giáo viên và không thay đổi module School Administration.

### Key Entities

- **Class**: Lớp học thuộc một School và một niên khóa.
- **User**: Tài khoản giáo viên; phải ACTIVE, có vai trò HOMEROOM_TEACHER và thuộc cùng School.
- **ClassHomeroomAssignment**: Lịch sử gán GVCN cho lớp, gồm thời điểm bắt đầu và kết thúc.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Bốn endpoint phân công trả đúng contract và không còn lỗi 404 trên màn hình BGH.
- **SC-002**: 100% test phân công kiểm tra school isolation, eligibility và lịch sử đều pass.
- **SC-003**: Không thể tạo hai phân công đang hoạt động cho cùng một lớp.
- **SC-004**: Prisma validation, typecheck và build backend đều pass.

## Assumptions

- Authentication và permission middleware hiện tại được tái sử dụng.
- Tài khoản GVCN đã được School Administration tạo trước đó.
- Không áp đặt quy tắc một giáo viên chỉ được chủ nhiệm một lớp nếu chưa có quyết định nghiệp vụ.
- Migration chỉ được version-control; việc deploy database do workflow được phê duyệt thực hiện.
