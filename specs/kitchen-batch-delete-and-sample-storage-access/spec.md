# Spec: Gỡ API xóa lô chế biến và giới hạn quyền tủ lưu mẫu

## Bối cảnh

- Nghiệp vụ không còn dùng chức năng xóa lô chế biến; FE đã gỡ nút xóa, nhưng BE vẫn mở `DELETE /v1/kitchen/:id`.
- API tủ lưu mẫu (`/v1/sample-storage-units`, `/v1/kitchen/sample-storage-units`, `/sample-storage-units`) chỉ kiểm tra đăng nhập và phạm vi trường: mọi role của trường đều xem / thêm / sửa / xóa tủ được, trong khi tủ lưu mẫu chỉ dành cho nhân viên bếp.

## Yêu cầu chức năng

- **FR-001**: Gỡ `DELETE /v1/kitchen/:id` cùng controller, service (`remove`) và repository (`removeEmptyGroup`) chỉ dùng cho việc xóa lô. Không còn đường nào xóa lô chế biến qua API.
- **FR-002**: Xem tủ lưu mẫu (`GET /`, `GET /:id`) yêu cầu quyền `retained_sample.view`.
- **FR-003**: Thêm / sửa / xóa tủ lưu mẫu (`POST /`, `PUT /:id`, `DELETE /:id`) yêu cầu quyền `retained_sample.update`.
- **FR-004**: Thiếu quyền trả 403 qua xử lý lỗi chung; phạm vi trường giữ nguyên như hiện tại.

## Ngoài phạm vi

- Không thêm hay xóa mã quyền trong danh mục; `cooking_batch.update` giữ nguyên (hiện không còn API dùng).
- Không thay đổi cấu trúc DB, không có migration.
