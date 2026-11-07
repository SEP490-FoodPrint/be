# Feature Specification: BGH quản lý niên khóa toàn trường

**Feature Branch**: `feat/010-school-academic-year-management`

**Created**: 2026-11-07

**Status**: Implemented locally; not committed or deployed

## User Scenarios

### User Story 1 - Xem lịch sử niên khóa

Ban Giám hiệu xem danh sách cấu hình niên khóa của chính trường mình và chọn một bản ghi để xem đầy đủ khoảng ngày, ngày nghỉ.

### User Story 2 - Tạo cấu hình niên khóa

Ban Giám hiệu tạo một nhãn niên khóa, ngày bắt đầu, ngày kết thúc và danh sách ngày nghỉ tùy chọn. Hệ thống từ chối nhãn trùng trong cùng trường, ngày sai thứ tự, ngày nghỉ trùng hoặc ngoài khoảng.

### User Story 3 - Cập nhật lịch niên khóa

Ban Giám hiệu cập nhật ngày bắt đầu, ngày kết thúc và danh sách ngày nghỉ của bản ghi thuộc trường mình. Nhãn niên khóa bất biến sau khi tạo và dữ liệu lịch sử không bị xóa.

## Functional Requirements

- **FR-001**: Cung cấp `GET /api/schools/me/academic-years`, sắp xếp `startDate DESC`, rồi `academicYear DESC`.
- **FR-002**: Cung cấp `GET /api/schools/me/academic-years/:id`; record ngoài trường được trả như không tồn tại.
- **FR-003**: Cung cấp `POST /api/schools/me/academic-years` với `academicYear`, `startDate`, `endDate`, `holidays`.
- **FR-004**: Cung cấp `PATCH /api/schools/me/academic-years/:id` chỉ nhận `startDate`, `endDate`, `holidays`; không cho đổi nhãn.
- **FR-005**: Ngày dùng `YYYY-MM-DD`, ngày bắt đầu không sau ngày kết thúc.
- **FR-006**: Holiday là mảng `{ startDate, endDate, reason }`; một ngày có hai mốc bằng nhau, nhiều ngày dùng khoảng bao đóng. Reason được trim, không rỗng; khoảng hợp lệ, không chồng lấn và nằm trong niên khóa.
- **FR-007**: Chỉ `SCHOOL_MANAGEMENT_BOARD` thuộc School có quyền hiệu lực tương ứng được truy cập. `schoolId` luôn lấy từ principal.
- **FR-008**: Quyền `school_academic_year.view` dùng cho đọc; `school_academic_year.manage` dùng cho tạo/cập nhật. Không grant mặc định cho School Administration.
- **FR-009**: Unique conflict trả `409`; request sai trả `400`; record không thuộc trường trả `404`.
- **FR-010**: Không có DELETE, không sửa Class, WeeklyMenu, DailyMealPortion, CookingBatch hoặc assignment.
- **FR-011**: Không có migration mới; tái sử dụng `SchoolAcademicYear` và JSONB `holidays` hiện có.

## UI Acceptance Criteria

- BGH có route và menu “Thiết lập niên khóa”, hiển thị loading, empty và API error rõ ràng.
- Có selector lịch sử, thao tác thêm niên khóa, form ngày và quản lý holiday thêm/sửa/xóa trong dữ liệu chưa lưu.
- Save bị khóa khi không thay đổi hoặc dữ liệu sai; chặn submit kép và giữ form khi API lỗi.
- Cảnh báo trước khi đổi niên khóa, tạo mới hoặc hủy khi còn thay đổi chưa lưu.
- Desktop dùng bảng holiday; mobile dùng danh sách đọc được, một cột, không tràn ngang.

## Explicit Exclusions

- Xóa niên khóa; tự sinh ngày lễ; cấm cuối tuần; kiểm tra chồng khoảng.
- Tự động tạo/sửa lớp, GVCN, thực đơn, suất ăn, mẻ nấu hoặc lịch bếp.
- Khóa dữ liệu lịch sử, reconciliation hoặc optimistic concurrency.

## Success Criteria

- Test bao phủ validation, quyền, tenant isolation, unique conflict và create/read/update.
- FE build và BE lint/format/typecheck/build cùng unit tests liên quan chạy thành công.
