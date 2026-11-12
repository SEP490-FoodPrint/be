# Feature Specification: Nền tảng lưu lịch năm học toàn trường

**Feature Branch**: `feat/005-school-academic-year`

**Created**: 2026-11-07

**Status**: Implemented — storage only; deployment pending review

**Input**: Người dùng chốt thêm đúng một bảng SchoolAcademicYear: thuộc một trường, có nhãn năm học, ngày bắt đầu/kết thúc và danh sách ngày nghỉ kèm lý do trong JSON; lịch dùng chung toàn trường, không thiết lập riêng cho từng lớp.

## User Scenarios & Testing

### User Story 1 - Lưu khoảng thời gian năm học của trường (Priority: P1)

Nhà trường cần có nơi lưu từng năm học cùng khoảng thời gian học chung cho tất cả lớp, giữ được cấu hình các năm trước.

**Why this priority**: Khoảng ngày học là nền tảng cho chức năng BGH thiết lập lịch ở giai đoạn tiếp theo.

**Independent Test**: Lưu hai năm học cho một trường và cùng nhãn năm học cho trường khác; kiểm tra các bản ghi độc lập, không trùng năm trong cùng trường.

**Acceptance Scenarios**:

1. **Given** trường đã tồn tại, **When** lưu năm học với nhãn và khoảng ngày hợp lệ, **Then** bản ghi gắn đúng trường và giữ nguyên hai mốc ngày.
2. **Given** một trường đã có năm học cùng nhãn, **When** lưu thêm bản ghi cùng nhãn cho trường đó, **Then** việc lưu bị từ chối; trường khác được dùng cùng nhãn.
3. **Given** nhãn năm học rỗng hoặc ngày bắt đầu sau ngày kết thúc, **When** lưu cấu hình, **Then** việc lưu bị từ chối.

### User Story 2 - Lưu danh sách ngày nghỉ chung (Priority: P2)

Nhà trường cần lưu danh sách ngày nghỉ với ngày và lý do cùng cấu hình năm học, không tạo bảng riêng hoặc nhân bản theo lớp.

**Why this priority**: Đáp ứng lựa chọn một bảng của người dùng và giữ ngày nghỉ đi cùng năm học tương ứng.

**Independent Test**: Lưu và đọc lại danh sách gồm ngày nghỉ/lý do tiếng Việt; năm chưa cấu hình ngày nghỉ trả danh sách rỗng.

**Acceptance Scenarios**:

1. **Given** chưa khai báo ngày nghỉ, **When** lưu năm học, **Then** danh sách ngày nghỉ mặc định rỗng.
2. **Given** danh sách ngày nghỉ đã có ngày và lý do, **When** lưu rồi đọc lại, **Then** nội dung được giữ nguyên cho đúng năm học/trường.
3. **Given** giá trị ngày nghỉ không phải danh sách, **When** lưu, **Then** việc lưu bị từ chối.

### User Story 3 - Bảo toàn dữ liệu khi mở rộng (Priority: P3)

Nhà trường cần bổ sung nơi lưu lịch mà không thay đổi lớp, thực đơn, suất ăn và lịch sử vận hành đang có.

**Why this priority**: Việc thêm cấu trúc lưu trữ không được tự gán lịch hoặc làm gián đoạn các luồng hiện tại.

**Independent Test**: Áp lịch sử thay đổi lên môi trường kiểm thử trống và môi trường có trường cũ; xác nhận dữ liệu cũ nguyên vẹn, không sinh cấu hình mẫu và cấu trúc đích khớp thiết kế.

**Acceptance Scenarios**:

1. **Given** hệ thống đã có dữ liệu trường, **When** thêm cấu trúc năm học, **Then** dữ liệu trường được giữ nguyên và chưa có năm học tự tạo.
2. **Given** năm học đang tham chiếu một trường, **When** xóa trường đó trực tiếp, **Then** quan hệ không bị âm thầm mất hoặc chuyển sang trường khác.

### Edge Cases

- Không cho phép bản ghi năm học tham chiếu trường không tồn tại.
- Hai mốc ngày bằng nhau được phép; chưa chốt thời lượng tối thiểu hay định dạng cứng cho nhãn năm học.
- Chưa chặn khoảng ngày chồng lấn giữa các nhãn năm khác nhau vì người dùng chưa chốt quy tắc đó.
- Ngày nghỉ được lưu như danh sách; kiểm tra sâu từng phần tử, ngày lịch hợp lệ, lý do bắt buộc/không trắng, ngày trùng và ngày nằm trong năm học thuộc hợp đồng validation khi triển khai chức năng nhập lịch. Giai đoạn này không cung cấp API ghi ngày nghỉ.

## Requirements

### Functional Requirements

- **FR-001**: Hệ thống MUST bổ sung đúng một cấu trúc lưu năm học thuộc trường, với định danh, nhãn năm học, ngày bắt đầu/kết thúc, danh sách ngày nghỉ và thời điểm tạo/cập nhật.
- **FR-002**: Mỗi trường MUST có tối đa một bản ghi cho cùng nhãn năm học; các năm và các trường khác nhau được lưu độc lập.
- **FR-003**: Nhãn năm học MUST không rỗng sau khi bỏ khoảng trắng hai đầu; ngày bắt đầu MUST không sau ngày kết thúc.
- **FR-004**: Danh sách ngày nghỉ MUST mặc định rỗng khi không truyền; không nhận SQL NULL, JSON null hoặc giá trị không phải danh sách. Biểu diễn dự kiến cho mỗi mục là ngày `YYYY-MM-DD` và lý do.
- **FR-005**: Bản ghi MUST tham chiếu một trường tồn tại và được bảo toàn khi thao tác xóa trường vi phạm quan hệ tham chiếu.
- **FR-006**: Việc mở rộng MUST không sửa/xóa dữ liệu cũ, tự tạo năm học/ngày nghỉ hoặc gán cấu hình vào lớp/thực đơn hiện có.
- **FR-007**: Phạm vi lần này MUST chỉ bổ sung nền tảng lưu trữ và kiểm thử. Không thêm màn hình, endpoint, quyền, thay đổi cách tính tuần/học kỳ hoặc tự áp ngày nghỉ vào thực đơn/suất ăn.
- **FR-008**: Khi khắc phục lỗi CD sau phát hành, hệ thống MUST khôi phục nguyên bản migration phân công GVCN đã được Azure ghi nhận và model tương ứng, để lịch sử đã áp dụng tiếp tục là prefix hợp lệ trước migration năm học. Không sửa SQL/checksum lịch sử, không bỏ qua guard hoặc thêm API phân công GVCN trong bản sửa.

### Key Entities

- **Trường**: Chủ sở hữu lịch năm học; tất cả lớp cùng trường dùng chung cấu hình khi chức năng lịch được triển khai.
- **Năm học của trường**: Một nhãn năm học, khoảng ngày học và danh sách ngày nghỉ có lý do; các năm trước được giữ riêng.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Lưu và đọc đúng 100% mốc ngày/danh sách ngày nghỉ trong các tình huống hợp lệ đã mô tả.
- **SC-002**: Từ chối 100% trường hợp trùng trường/nhãn năm, trường không tồn tại, nhãn trống, ngày đảo ngược và danh sách nghỉ sai loại trong kiểm thử.
- **SC-003**: Dữ liệu trường cũ giữ nguyên sau nâng cấp; không có cấu hình năm học hoặc ngày nghỉ được tự tạo.
- **SC-004**: Toàn bộ các luồng hiện hữu giữ hợp đồng đầu vào/đầu ra và cơ chế phân quyền hiện tại.

## Assumptions

- Yêu cầu đã xác nhận là lịch toàn trường; thiết lập theo lớp và phương án hai bảng đã được thay thế.
- BGH là người sử dụng chức năng cấu hình trong tương lai; bước này chưa cung cấp thao tác nhập lịch cho người dùng.
- Không yêu cầu bổ sung số tuần 18/17 hoặc học kỳ trong thay đổi một bảng này.
- Kiểm thử thay đổi cấu trúc chỉ trên PostgreSQL local disposable; triển khai Azure theo quy trình review/merge/CD đã duyệt, không chạy thủ công trong tác vụ này.

## Release repair — 07/11/2026

CD của commit `194ac5c` dừng vì Azure đã hoàn tất `20261107000100_class_homeroom_assignments` trong khi Git thiếu thư mục đó. Kiểm tra chỉ đọc xác nhận SQL gốc ở nhánh `origin/feat/bgh-menu-approval-class-assignment`, dưới tên cũ `20261102000200_class_homeroom_assignments`, có SHA-256 trùng hoàn toàn với lịch sử Azure: `b1fe455a26a60267d045f2602e61dbdeb9a37ec6367909963f423604cb146f5e`.

Bản sửa trên `fix/005-restore-applied-migration` phục hồi đúng file dưới tên đã applied và model `ClassHomeroomAssignment` từ cùng nguồn. Đây là khôi phục cấu trúc đã có trên đích triển khai, không mở rộng nghiệp vụ lịch năm học hoặc đưa toàn bộ nhánh GVCN cũ vào dev. Migration năm học giữ nguyên.
