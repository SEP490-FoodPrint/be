# Feature Specification: Chặn tạo niên khóa sai định dạng hoặc đã qua

**Branch**: `feat/academic-year-create-guard` | **Nhánh gốc**: `dev` | **Date**: 2026-11-14

## Bối cảnh

Màn Cấu hình năm học cho phép Ban Giám hiệu (BGH) nhập nhãn niên khóa tự do và tạo cả những niên khóa đã qua. Trong khi đó, module lớp học chỉ chấp nhận niên khóa dạng `N-N+1` thuộc năm hiện tại hoặc sắp tới. Vì vậy BGH có thể tạo ra niên khóa mà sau đó không dùng được để tạo lớp.

## User Story (P1)

Là BGH, khi tạo niên khóa, tôi muốn hệ thống chặn ngay các nhãn sai định dạng và các năm đã qua, để niên khóa nào tạo ra cũng dùng được cho lớp học.

### Acceptance Scenarios

1. Tạo niên khóa "2026-2027" vào tháng 11/2026: tạo thành công.
2. Nhãn "Năm 2026" hoặc "2026-2028": trả về 400 với thông báo "Niên khóa phải có dạng N-N+1, ví dụ 2026-2027".
3. Tạo niên khóa "2025-2026" vào tháng 11/2026: trả về 409 và không truy cập DB.
4. Ngày bắt đầu và kết thúc không bị ràng buộc theo nhãn.

## Functional Requirements

- **FR-001**: khi tạo, `academicYear` phải đúng dạng `N-N+1`. Kiểm tra bằng `academicYearEnd`.
- **FR-002**: khi tạo, chỉ chấp nhận niên khóa hiện tại hoặc sắp tới. Dùng `isAssignableAcademicYear`, tính theo giờ Việt Nam.
- **FR-003**: chỉ áp dụng cho thao tác tạo. Không đổi thao tác sửa, schema, quyền hay dữ liệu đã có.
