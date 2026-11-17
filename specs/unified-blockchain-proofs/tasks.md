# Công việc

## U0. Chốt với nhóm

- [ ] Duyệt spec này (PR #140).
- [ ] Thống nhất với tác giả `feat/blockchain-modules` về mục 7 và `traceability_anchors`.
- [x] Chốt quyền NCC xem bằng chứng khai báo.
- [x] Chốt cách `feat/meal-traceability` lấy bằng chứng cho mục 8.

## U1. Migration và schema

- [x] Migration: kiểm tra 5 bảng cũ rỗng, xóa bảng và enum cũ, tạo `blockchain_proofs` với CHECK và index.
- [x] Cập nhật `prisma/schema.prisma`; `prisma validate`, `prisma generate`.
- [x] Chạy trên PostgreSQL local dùng một lần; `prisma migrate diff` không còn khác biệt.

## U2. Chuyển 4 loại hiện có

- [x] Repository dùng bảng cấu hình theo `kind`.
- [x] Kiểm nhận, mẻ nấu, mẫu lưu, hồ sơ đăng ký ghi vào `blockchain_proofs`; `recordId` mới.
- [x] `kitchen.service` đếm `blockchainProof`; xóa module `traceability`.
- [x] Test hiện có chạy qua với bảng mới.

## U3. Mục 3: khai báo giao hàng

- [x] Payload `DELIVERY_DECLARED`, gắn vào `dispatch`.
- [x] Kiểm nhận thêm `declarationHash`, `payload_version = 2`.
- [x] Kind `delivery-declarations`, quyền trường và NCC.
- [x] Test.

## U4. Mục 7: phân phối suất ăn

- [x] Payload `MEAL_DISTRIBUTED`, gắn vào `confirmDistribution`.
- [x] Kind `meal-distributions`.
- [x] Test.

## U5. Mục 8: chuỗi kiểm chứng

- [x] `GET /api/blockchain-proofs/chains/meal-allocations/:mealAllocationId`, có `verify=true`.
- [x] Đối chiếu nghiệp vụ: kiểm nhận so với khai báo, phân phối so với mẻ nấu.
- [x] Test: sửa một lô thì các nút phía sau báo không khớp.

## U6. Tài liệu và kiểm tra

- [x] `docs/AUTHORIZATION.md`, `README.md`, `src/modules/README.md`.
- [x] `lint`, `typecheck`, `build`, `test:unit`, `test:spec-gate`.
- [x] Thử thật trên Sepolia với DB local: đi hết chuỗi khai báo → kiểm nhận → mẻ → mẫu → phân phối, rồi xác minh cả chuỗi.

Kết quả ngày 17/11/2026:

- `test:unit` 756/756; `test:spec-gate` 26/26.
- Migration chạy được trên DB rỗng và trên bản clone của DB demo đã xóa bằng chứng cũ; `prisma migrate diff` trống. Trên bản clone còn bằng chứng cũ, migration dừng với lỗi và không mất dòng nào.
- Trên Sepolia, với bản clone của DB demo:
  - neo 5 bằng chứng (khai báo, kiểm nhận, mẻ, mẫu, phân phối), cả 5 `CONFIRMED`;
  - API chuỗi `verify=true` cho `intact = true`, mọi liên kết `MATCH`;
  - sửa biển số xe thì khai báo và kiểm nhận `MISMATCH` (`vehiclePlate`); khôi phục thì lại `VERIFIED`.
