# Feature Specification: Thông báo ngắn gọn, dễ hiểu cho người dùng

**Feature Branch**: `fix/user-facing-messages`

**Created**: 2026-11-26

**Status**: Implemented

**Input**: Rà soát mọi thông báo thành công và lỗi hiển thị trên màn hình; sửa các câu quá dài hoặc in mã kỹ thuật để người đọc hiểu vấn đề.

## Bối cảnh

Nhiều thông báo API được FE hiển thị nguyên văn nhưng quá dài, liệt kê hết các mục lỗi, hoặc chứa mã, tên trường và thuật ngữ kỹ thuật.

## Clarifications

### Session 2026-11-26

- Phạm vi là nội dung thông báo hiển thị cho người dùng; không đổi nghiệp vụ, quyền truy cập, mã HTTP hay schema Prisma.
- Khi gộp `dev`, giữ logic mới của `dev` và câu thông báo ngắn của nhánh này tại hai file xung đột.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Hiểu ngay thông báo (Priority: P1)

Người dùng nhận thông báo ngắn bằng tiếng Việt, nêu vấn đề và, khi phù hợp, việc cần làm tiếp.

**Acceptance Scenarios**:

1. **Given** trường chưa cấu hình chế độ nấu, **When** lập kế hoạch món theo đợt, **Then** API trả 409 "Chưa có chế độ nấu. Liên hệ BGH.".
2. **Given** dữ liệu gửi lên sai định dạng, **When** validation thất bại, **Then** API trả 400 "Thông tin chưa đúng. Kiểm tra lại." kèm lỗi theo trường.
3. **Given** lỗi hệ thống không lường trước, **When** API xử lý yêu cầu, **Then** API trả 500 với câu chung, không lộ chi tiết kỹ thuật.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Các thông báo thuộc phạm vi rà soát MUST ngắn gọn, bằng tiếng Việt và không in mã kỹ thuật không cần thiết.
- **FR-002**: Các thông báo được ghép từ danh sách dài trong phạm vi rà soát MUST được rút gọn bằng `shortList`.
- **FR-003**: Lỗi validation dùng chung MUST có câu tổng quát ngắn và giữ chi tiết theo trường.
- **FR-004**: Lỗi không lường trước MUST trả câu chung, không lộ chi tiết nội bộ.
- **FR-005**: Thay đổi của nhánh MUST giữ nguyên logic nghiệp vụ đã có trên `dev`.

## Success Criteria

- **SC-001**: ESLint, `tsc --noEmit`, Prettier và toàn bộ `npm run test:unit` đạt sau khi gộp `dev`.
- **SC-002**: Câu cũ không quay lại ở những file đã được sửa trong nhánh sau khi gộp `dev`. Các file ngoài phạm vi có thể còn câu tương tự.
