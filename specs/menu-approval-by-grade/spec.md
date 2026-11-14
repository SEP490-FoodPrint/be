# Feature Specification: Duyệt thực đơn theo khối

**Branch**: `feat/menu-approval-by-grade` | **Nhánh gốc**: `dev` | **Date**: 2026-11-14

## Bối cảnh

Spec 027 đã có thực đơn theo khối và lọc khối ở màn duyệt. Màn duyệt của BGH vẫn ghi cứng "Cán bộ Y tế" làm người đề xuất.

## User Story (P1)

Là BGH, khi duyệt thực đơn, tôi cần thấy đúng người đã lập thực đơn.

### Acceptance Scenarios

1. Thực đơn do "Nguyễn Dinh Dưỡng" lập → `summary.proposer` = "Nguyễn Dinh Dưỡng", `proposerDetail` = "Nhân viên Dinh dưỡng · <tên trường>".
2. `medicalReview.role` = "Nhân viên Dinh dưỡng".

## Functional Requirements

- **FR-001**: `summary.proposer` lấy tên người tạo thực đơn (`WeeklyMenu.createdByUserId`).
- **FR-002**: nhãn vai trò là "Nhân viên Dinh dưỡng".
- **FR-003**: số suất mỗi ngày giữ quy tắc lấy bữa đông nhất (đã kiểm tra, không đổi).
- **FR-004**: không đổi quyền, luồng phê duyệt hay schema.

## Ngoài phạm vi

Bảng chi tiết theo khối và cảnh báo khối thiếu thực đơn (đã bỏ theo yêu cầu: màn này chỉ để duyệt).
