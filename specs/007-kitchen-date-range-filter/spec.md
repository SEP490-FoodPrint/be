# Feature Specification: Lọc danh sách mẻ nấu theo khoảng ngày

**Feature Branch**: `feat/007-kitchen-date-range-filter`

**Created**: 2026-11-08

**Status**: Existing implementation confirmed by user

**Input**: Người dùng yêu cầu commit thay đổi local theo quy tắc rồi kéo dev; đã xác nhận hai file kitchen thêm startDate/endDate làm xong và được đưa vào commit. Spec ghi lại đúng hành vi của diff đã xác nhận, không mở rộng triển khai.

## User Scenarios & Testing

### User Story 1 - Xem mẻ nấu trong khoảng ngày (Priority: P1)

Người dùng có quyền xem danh sách mẻ nấu muốn lọc theo ngày thực đơn bắt đầu/kết thúc thay vì chỉ một ngày.

**Independent Test**: Truyền hai mốc và kiểm tra bộ lọc ngày thực đơn nhận cả hai biên; truyền một mốc thì chỉ giới hạn phía tương ứng.

**Acceptance Scenarios**:

1. Có startDate/endDate: danh sách giới hạn menuDate từ startDate đến endDate, gồm cả hai ngày.
2. Chỉ có startDate: lấy menuDate từ ngày đó trở đi; chỉ có endDate: lấy tới ngày đó.
3. Không có hai tham số mới: giữ bộ lọc date và hành vi hiện tại.
4. Có tham số khoảng cùng date: khoảng ngày được ưu tiên như implementation đã xác nhận.

### Edge Cases

- Ngày sai kiểu/định dạng bị parser ngày hiện tại từ chối.
- Không tự thêm quy tắc đổi chỗ hai mốc hoặc lỗi mới cho khoảng đảo ngược trong commit này.
- Không thay đổi quyền, phạm vi trường, phân trang hoặc những bộ lọc khác.

## Requirements

### Functional Requirements

- **FR-001**: Parser danh sách MUST nhận startDate/endDate optional và chuẩn hóa bằng parser ngày hiện hữu.
- **FR-002**: Query danh sách MUST áp gte/lte lên ngày thực đơn khi có mốc tương ứng.
- **FR-003**: Query MUST giữ date khi không có khoảng và ưu tiên khoảng khi hai loại cùng có mặt.
- **FR-004**: Thay đổi MUST giữ nguyên tenant scope, quyền truy cập, response và schema database.
- **FR-005**: Commit MUST chỉ lưu hai file kitchen đã được xác nhận cùng spec; không tự sửa các commit role local đã có.

### Key Entities

- Mẻ nấu và ngày thực đơn: thực thể hiện có, không thêm bảng/field persistence.

## Success Criteria

- **SC-001**: Khoảng hai đầu, khoảng một đầu và date cũ được biểu diễn đúng trong query của implementation đã xác nhận.
- **SC-002**: Thay đổi qua kiểm tra lint, format, kiểu và build; kết quả bộ test hiện hữu được ghi đúng thực tế.
- **SC-003**: Code mới từ dev được đồng bộ, các commit và thay đổi local đã xác nhận được bảo toàn.

## Assumptions

- Phạm vi là lưu và đồng bộ code đã làm xong, không thiết kế lại module kitchen hoặc mở rộng API thống kê.
- Cấu trúc legacy kitchen hiện tại được giữ; không tự tách toàn bộ module chỉ trong tác vụ commit.
- Không push hoặc triển khai database trong tác vụ này.
