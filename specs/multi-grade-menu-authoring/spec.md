# Feature Specification: Soạn thực đơn chung, định lượng riêng từng khối

**Feature Branch**: `feat/multi-grade-menu-authoring`
**Created**: 2026-11-15
**Status**: Approved requirements
**Input**: Chọn món một lần cho nhiều khối hoặc toàn trường; lấy định lượng theo từng khối; thực đơn cùng lịch món hiển thị một mục.

## User Scenarios & Testing

### User Story 1 - Chọn lịch món một lần (Priority: P1)

Nhân viên dinh dưỡng chọn các khối và lập lịch món chung; mỗi khối dùng định lượng của chính mình.

**Independent Test**: Hai khối cùng món, định lượng 80 g và 100 g; lưu một lần và đối chiếu từng khối.

**Acceptance Scenarios**:

1. Given hai khối có công thức khác định lượng, When chọn chung lịch món và lưu, Then mỗi khối có định lượng đúng, không phải nhập lại lịch món.
2. Given một món thiếu công thức của khối đã chọn, When xem trước hoặc lưu, Then báo rõ khối/món thiếu, không lấy công thức gốc hoặc của khối khác.
3. Given chọn Toàn trường, When thêm món, Then áp dụng tất cả khối hiện có và kiểm tra riêng từng khối.

### User Story 2 - Lưu và gửi duyệt an toàn (Priority: P1)

**Independent Test**: Một khối lỗi giữa thao tác lưu; không khối nào được lưu dở dang. Dị ứng của từng khối được kiểm tra trước gửi duyệt.

**Acceptance Scenarios**:

1. Given bất kỳ khối nào không thuộc trường, công thức lỗi, hoặc thực đơn bị khóa, When lưu chung, Then toàn bộ thao tác thất bại nguyên tử.
2. Given dị ứng chưa xử lý ở một khối, When lưu và yêu cầu gửi duyệt, Then giữ bản nháp và chỉ rõ khối chưa an toàn; không gửi duyệt một phần.
3. Given tất cả khối đủ điều kiện, When gửi duyệt chung, Then tất cả thực đơn cùng chuyển Chờ duyệt trong một thao tác.

### User Story 3 - Xem thực đơn chung (Priority: P2)

**Independent Test**: Danh sách có hai khối cùng lịch món khác định lượng; chỉ một mục chung và có thể chọn khối xem định lượng.

**Acceptance Scenarios**:

1. Given lịch món, suất riêng và trạng thái giống nhau, When xem tất cả khối, Then gộp một mục, giữ lựa chọn xem từng khối.
2. Given thay đổi món hoặc trạng thái một khối, When tải lại, Then tách hiển thị để không che khác biệt hoặc thao tác nhầm.

### Edge Cases

- Không có khối; trùng khối; khối thuộc trường khác; món/gia vị không còn hoạt động.
- Hai khối chung món nhưng khác thành phần công thức; dị ứng chỉ tồn tại ở một khối.
- Đã có thực đơn nhiều khối dùng chung theo cơ chế cũ: từ chối ghi đè bằng từng khối; yêu cầu mở thực đơn hiện có.
- Ngày đã duyệt/đã dùng lập lô; gửi lại thao tác; hai yêu cầu đồng thời; lỗi API không được biến thành kết quả an toàn.

## Requirements

### Functional Requirements

- **FR-001**: Tạo lịch món chung và xem định lượng theo từng khối từ công thức đã cấu hình.
- **FR-002**: Lưu riêng ảnh chụp định lượng cho mỗi khối; sửa danh mục sau đó không đổi thực đơn đã lưu.
- **FR-003**: Không giữ kho, tạo lô hoặc thay đổi số suất khi xem trước hay lưu thực đơn.
- **FR-004**: Chỉ đọc/ghi dữ liệu trong trường đăng nhập; kiểm tra lại quyền trong giao dịch.
- **FR-005**: Ghi nhiều khối và gửi duyệt chung nguyên tử; giữ quy tắc dị ứng, ngày đã duyệt và lịch sử chế biến.
- **FR-006**: Gộp trình bày theo lịch món, suất riêng và trạng thái; khác định lượng vẫn gộp; không gộp quyền sở hữu, ID ngày, số suất hoặc dữ liệu kho.

### Key Entities

- Lịch món chung: các ngày/bữa và danh sách món do người dùng chọn.
- Thực đơn khối: lịch món, khối áp dụng, trạng thái và định lượng đã lưu độc lập.
- Công thức khối: nguyên liệu chính, gia vị, định lượng/suất và đơn vị đã cấu hình.

## Success Criteria

- **SC-001**: Một thao tác chọn lịch món và lưu tạo đủ thực đơn cho ít nhất hai khối có định lượng khác nhau.
- **SC-002**: Kiểm thử chứng minh lỗi một khối không để lại dữ liệu lưu hoặc gửi duyệt một phần.
- **SC-003**: Tất cả khối được kiểm tra dị ứng riêng; không bỏ qua công thức thiếu.
- **SC-004**: Hai thực đơn chỉ khác định lượng hiển thị một mục và xem được định lượng từng khối.

## Assumptions

Toàn trường là chọn mọi khối trong danh mục, không dùng công thức gốc. Không tự chuyển dữ liệu thực đơn chung cũ hoặc chỉnh dữ liệu Azure. Các khối khác trạng thái được hiển thị riêng để bảo toàn thao tác duyệt.
