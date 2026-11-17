# Feature Specification: General Improvements & Batch Number Tracking

**Feature Branch**: `feat/general-improvements`  
**Status**: Implemented

## User story

Nhân viên bếp và BGH cần theo dõi số thứ tự lô chế biến (Lô 1, Lô 2, ...) khi hệ thống chia nhỏ suất ăn theo chế độ nấu (nấu riêng theo lô hoặc nấu chung). Số thứ tự này giúp nhân viên bếp dễ dàng nhận biết và phân biệt từng mẻ chế biến trong danh sách, bảng kanban và chi tiết lô.

## Functional requirements

- **FR-001**: Model `CookingBatch` lưu trữ trường `batchNumber` kiểu số nguyên (`INTEGER`, ánh xạ tới cột `batch_number`).
- **FR-002**: Khi chia lô chế biến (`SEPARATE_BY_LOT` hoặc `COMBINE_LOTS`), mỗi mẻ con được tự động gán số thứ tự lô tăng dần bắt đầu từ 1 (`batchNumber: index + 1`).
- **FR-003**: DTOs và API trả về `batchNumber` cho các endpoint danh sách lô và chi tiết lô.
- **FR-004**: Migration versioned `20261121000100_cooking_batch_number` bổ sung cột `batch_number` vào bảng `foodprint.cooking_batches`, tương thích dữ liệu cũ với giá trị `NULL`.
- **FR-005**: Bảo toàn các ràng buộc dữ liệu, phân quyền trường học và kiểm thử đơn vị.

## Acceptance scenarios

1. Khi tạo mẻ chế biến cho ca ăn có nhiều lô nguyên liệu, các mẻ con được gán số thứ tự lần lượt: Lô 1, Lô 2,...
2. Khi xem danh sách và chi tiết lô qua API, trường `batchNumber` được trả về chính xác trong payload.
3. Khi chạy migration trên cơ sở dữ liệu mới hoặc nâng cấp cơ sở dữ liệu hiện tại, cột `batch_number` được tạo an toàn và các bản ghi lịch sử được giữ nguyên.
