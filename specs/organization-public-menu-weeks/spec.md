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
