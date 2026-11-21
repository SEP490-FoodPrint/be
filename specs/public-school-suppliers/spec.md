# Feature Specification: Công khai danh sách nhà cung cấp và nguyên liệu của trường học

**Branch**: `feat/public-school-suppliers` | **Nhánh gốc**: `dev` | **Date**: 2026-11-22

## Bối cảnh

Trang thông tin trường học công khai (School Landing) cần hiển thị danh sách các nhà cung cấp thực phẩm đã liên kết với nhà trường (trạng thái ACTIVE). Đồng thời, khi phụ huynh và cộng đồng bấm xem chi tiết từng nhà cung cấp, hệ thống hiển thị danh sách các mặt hàng nguyên liệu mà nhà trường đã ký hợp đồng sử dụng cũng như toàn bộ danh mục nguyên liệu đạt chuẩn mà nhà cung cấp phân phối.

## User Story (P1)

Là người xem trang công khai của trường học (phụ huynh, cơ quan quản lý, học sinh), tôi muốn xem danh sách các nhà cung cấp thực phẩm đã liên kết với trường cùng danh mục nguyên liệu của họ, để nắm bắt minh bạch nguồn gốc và chất lượng thực phẩm phục vụ bán trú cho học sinh.

### Acceptance Scenarios

1. **Hiển thị danh sách NCC liên kết**: Truy vấn danh sách nhà cung cấp của trường theo mã trường (`schoolCode`); chỉ trả về các nhà cung cấp có quan hệ liên kết đang hoạt động (`status = 'ACTIVE'`).
2. **Chi tiết nguyên liệu và chứng nhận**: Với mỗi nhà cung cấp, trả về thông tin liên hệ, giấy chứng nhận an toàn thực phẩm (VSATTP), danh mục nguyên liệu trường chọn dùng theo hợp đồng (`contractedIngredients`) và danh mục nguyên liệu NCC cung cấp (`availableIngredients`).
3. **Phân loại và đơn vị chuẩn**: Mỗi nguyên liệu bao gồm tên, nhóm thực phẩm, đơn vị tính và mô tả (nếu có).
4. **Xử lý lỗi**: Trả về 404 nếu không tìm thấy trường học theo `schoolCode`.
5. **Bảo mật và toàn vẹn**: API chỉ đọc dữ liệu công khai, không yêu cầu xác thực người dùng và tuân thủ nguyên tắc read transaction.

## Functional Requirements

- **FR-001**: Bổ sung endpoint công khai `GET /schools/public/:schoolCode/suppliers` trong module organization.
- **FR-002**: Bổ sung hàm truy vấn `findPublicSchoolSuppliers(schoolId)` trong `organization.repository.ts`, lọc theo trường và quan hệ `status = 'ACTIVE'`, lấy hợp đồng `status = 'ACTIVE'` cùng các nguyên liệu `status = 'ACTIVE'`.
- **FR-003**: Định nghĩa DTO `PublicSchoolSupplierDTO`, `PublicSupplierCertificationDTO`, `PublicSupplierIngredientDTO` trong `organization.response.dto.ts`.
- **FR-004**: Triển khai `getPublicSchoolSuppliers(schoolCode)` trong `organization.service.ts` thực hiện phân loại nguyên liệu theo hợp đồng đã ký và nguyên liệu có sẵn của nhà cung cấp.
