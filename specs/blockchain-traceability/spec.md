# Spec: Blockchain Traceability

## Background & Goals

Module truy xuất nguồn gốc cho phép tra cứu toàn bộ chuỗi cung ứng từ suất ăn/lớp học ngược về lô nấu, mẫu lưu, lô nguyên liệu và đơn nhập hàng, đồng thời đối chiếu hash on-chain với Smart Contract `FoodPrintHashRegistry` để xác minh tính toàn vẹn.

## User Stories

- Là người dùng / phụ huynh / thanh tra, tôi có thể tra cứu toàn bộ mắt xích từ suất ăn về nhà cung cấp.
- Là người dùng, tôi có thể bấm nút kiểm chứng tính toàn vẹn để hệ thống đối chiếu dữ liệu off-chain với hash ghi trên blockchain, trả về kết quả Hợp lệ (`VERIFIED`) hoặc Cảnh báo sai lệch (`MISMATCH`).

## Functional Requirements

- FR-001: Query chuỗi cung ứng ngược từ `mealAllocationId`:
  `MealAllocation -> CookingBatch (+ dishes) -> IngredientLot -> Delivery (+ supplier)`.
- FR-002: Đọc bản ghi bằng chứng từ `traceability_anchors`.
- FR-003: Đối chiếu `payloadHash` trong DB với `onChainHash` từ `FoodPrintHashRegistry.getHash(recordId)`.
- FR-004: Endpoint dev `GET /api/dev/blockchain-traceability/trace/:mealAllocationId` và `GET /api/dev/blockchain-traceability/verify/:anchorId`.
- FR-005: Xử lý ngoại lệ an toàn nếu node blockchain chưa sẵn sàng hoặc không tìm thấy bản ghi.
