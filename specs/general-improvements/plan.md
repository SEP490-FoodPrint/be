# Plan: General Improvements & Batch Number Tracking

## Constitution Check

- Bổ sung schema và versioned migration tương thích ngược, không xóa hoặc phá vỡ cấu trúc hiện tại.
- Giữ nguyên các ràng buộc toàn vẹn dữ liệu, phân quyền trường học và kiểm thử đơn vị.
- Tự động gán `batchNumber` khi tạo mẻ chế biến và trả về qua API.

## Implementation Details

1. Schema & Migration:
   - Thêm `batchNumber Int? @map("batch_number") @db.Integer` vào model `CookingBatch` trong `prisma/schema.prisma`.
   - Tạo migration `20261121000100_cooking_batch_number` với câu lệnh `ALTER TABLE "foodprint"."cooking_batches" ADD COLUMN "batch_number" INTEGER;`.
2. Backend Repository & Service:
   - Thêm `batchNumber: true` vào `kitchenDetailSelect` và `kitchenSummarySelect`.
   - Gán `batchNumber: i + 1` khi tạo danh sách các mẻ con `CookingBatch`.
   - Cập nhật DTOs `CookingBatchDetailDTO` và `CookingBatchSummaryDTO`.
3. Validation:
   - Kiểm tra `npm run test:unit`, `npm run test:spec-gate`.
