# Feature Specification: Cấu hình chế độ nấu của trường

**Feature Branch**: `feat/003-school-cooking-mode`

**Created**: 2026-11-06

**Status**: Ready

**Input**: User description: "Ban Giám hiệu đọc và cập nhật chế độ nấu của chính trường đang đăng nhập; không cho client truyền schoolId và chỉ chấp nhận hai chế độ nấu đã có."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Xem chế độ nấu hiện tại (Priority: P1)

Là thành viên Ban Giám hiệu có quyền quản lý chế độ nấu, tôi muốn xem chế độ nấu của trường trong phiên đăng nhập để màn hình cấu hình luôn phản ánh đúng dữ liệu hiện tại.

**Why this priority**: Đây là dữ liệu đầu vào bắt buộc để hiển thị màn hình và giúp người dùng biết trạng thái trước khi thay đổi.

**Independent Test**: Đăng nhập bằng tài khoản Ban Giám hiệu có quyền, gọi API đọc và xác nhận kết quả chỉ thuộc `schoolId` trong phiên.

**Acceptance Scenarios**:

1. **Given** tài khoản Ban Giám hiệu thuộc một trường và có quyền cấu hình, **When** gọi API đọc chế độ nấu, **Then** hệ thống trả về `cookingMode` của đúng trường trong phiên.
2. **Given** tài khoản không có quyền hoặc không phải Ban Giám hiệu, **When** gọi API đọc, **Then** hệ thống từ chối với HTTP 403.

---

### User Story 2 - Cập nhật chế độ nấu (Priority: P1)

Là thành viên Ban Giám hiệu có quyền quản lý chế độ nấu, tôi muốn chọn một trong hai chế độ hợp lệ để các kế hoạch nấu được tạo sau đó áp dụng lựa chọn mới.

**Why this priority**: Đây là hành vi quản trị chính của tính năng và ảnh hưởng trực tiếp tới cách lập kế hoạch nấu tiếp theo.

**Independent Test**: Gửi từng giá trị enum hợp lệ, đọc lại kết quả và xác nhận chỉ trường trong phiên được cập nhật; gửi payload sai và xác nhận không có ghi dữ liệu.

**Acceptance Scenarios**:

1. **Given** Ban Giám hiệu có quyền, **When** gửi `SEPARATE_BY_LOT`, **Then** trường trong phiên được cập nhật và response trả cùng giá trị.
2. **Given** Ban Giám hiệu có quyền, **When** gửi `COMBINE_LOTS`, **Then** trường trong phiên được cập nhật và response trả cùng giá trị.
3. **Given** payload có enum không hợp lệ, thiếu `cookingMode`, có `schoolId` hoặc trường dư, **When** gửi yêu cầu, **Then** hệ thống trả HTTP 400 và không cập nhật dữ liệu.
4. **Given** tài khoản mất quyền hoặc đổi phạm vi tổ chức trước lúc ghi, **When** transaction kiểm tra lại danh tính, **Then** hệ thống từ chối và không cập nhật trường.

### Edge Cases

- `cookingMode` hiện tại có thể là `null`; API đọc vẫn trả `{ cookingMode: null }`.
- Client không được chọn trường qua params, query hoặc body; `schoolId` luôn lấy từ phiên đã xác thực.
- Payload JSON phải là object nghiêm ngặt và chỉ có khóa `cookingMode`.
- Trường không còn ACTIVE tại thời điểm ghi không được cập nhật.
- Thay đổi cấu hình không sửa hồi tố các mẻ hoặc kế hoạch nấu đã lập.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Hệ thống MUST cung cấp `GET /api/schools/me/cooking-mode` để đọc chế độ nấu của trường trong phiên.
- **FR-002**: Hệ thống MUST cung cấp `PATCH /api/schools/me/cooking-mode` để cập nhật chế độ nấu của trường trong phiên.
- **FR-003**: PATCH MUST chỉ chấp nhận body nghiêm ngặt `{ cookingMode }`, trong đó giá trị là `SEPARATE_BY_LOT` hoặc `COMBINE_LOTS`.
- **FR-004**: Hệ thống MUST lấy `schoolId` từ `AuthPrincipal`; mọi `schoolId` do client gửi phải bị từ chối hoặc không được hỗ trợ.
- **FR-005**: Cả hai endpoint MUST yêu cầu quyền hiệu lực `school_cooking_mode.manage` và role `SCHOOL_MANAGEMENT_BOARD` thuộc tổ chức `SCHOOL`.
- **FR-006**: Quyền `school_cooking_mode.manage` MUST được thêm vào permission catalog và gán mặc định cho role Ban Giám hiệu.
- **FR-007**: Thao tác ghi MUST chạy trong transaction, nạp lại danh tính/quyền/phạm vi trường và khóa trường theo hạ tầng authorization hiện có trước khi cập nhật.
- **FR-008**: Controller MUST validate input, service MUST xử lý nghiệp vụ và ánh xạ Response DTO, repository MUST sở hữu toàn bộ truy vấn Prisma.
- **FR-009**: Response MUST giữ envelope hiện tại và chỉ trả allowlist `{ cookingMode }`.
- **FR-010**: Tính năng MUST tái sử dụng `School.cookingMode` hiện có; không tạo model, migration, seed hoặc API chọn trường mới.
- **FR-011**: Các mẻ/kế hoạch đã lập MUST giữ chế độ cũ; cấu hình mới chỉ áp dụng cho kế hoạch được tạo sau thay đổi.
- **FR-012**: Test không hạ tầng MUST bao phủ validation, quyền route, phạm vi trường và service; integration test MUST bao phủ từ chối role bếp và cập nhật thành công của Ban Giám hiệu.

### Key Entities

- **School**: Trường trong phiên đăng nhập; sử dụng thuộc tính `cookingMode` hiện có và trạng thái ACTIVE.
- **AuthPrincipal**: Danh tính tin cậy chứa role, loại tổ chức, `schoolId` và quyền hiệu lực được nạp lại từ DB.
- **CookingMode**: Enum hiện có gồm `SEPARATE_BY_LOT` và `COMBINE_LOTS`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Ban Giám hiệu có quyền đọc và cập nhật thành công cả hai giá trị enum qua hai endpoint đã định nghĩa.
- **SC-002**: 100% payload thiếu/sai/dư trường được trả HTTP 400 trước khi ghi DB.
- **SC-003**: 100% tài khoản sai role, sai tổ chức, sai trường hoặc thiếu quyền được trả HTTP 403 và không làm thay đổi dữ liệu.
- **SC-004**: API không chấp nhận organization identifier từ client và chỉ truy cập đúng một trường lấy từ phiên.
- **SC-005**: `npm run validate`, `npm run test:unit`, các test integration CI và Spec gate đều PASS trước khi merge.

## Assumptions

- Prisma schema và database đã có `School.cookingMode` cùng enum `CookingMode`; không cần migration.
- Hệ thống authentication hiện tại luôn cấp `AuthPrincipal` từ dữ liệu ACTIVE mới đọc trong DB.
- Cơ chế tạo kế hoạch nấu đọc cấu hình tại thời điểm tạo; việc thay đổi hành vi tạo kế hoạch ngoài phạm vi PR này.
- Sau khi merge, System Admin chạy quy trình bootstrap authorization đã duyệt để đồng bộ permission catalog trên môi trường đích.

## Out of Scope

- Thay đổi schema Prisma, migration hoặc seed dữ liệu nghiệp vụ.
- Cho role khác Ban Giám hiệu cấu hình chế độ nấu.
- Cho client chọn trường cần cập nhật.
- Sửa hồi tố mẻ, kế hoạch nấu hoặc dữ liệu lịch sử.
