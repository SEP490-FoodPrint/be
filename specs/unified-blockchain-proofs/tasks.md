# Công việc

## U0. Chốt với nhóm

- [ ] Duyệt spec này.
- [ ] Thống nhất với tác giả `feat/blockchain-modules` về mục 7 và `traceability_anchors`.
- [ ] Chốt quyền NCC xem bằng chứng khai báo.
- [ ] Chốt cách `feat/meal-traceability` lấy bằng chứng cho mục 8.

## U1. Migration và schema

- [ ] Migration: kiểm tra 5 bảng cũ rỗng, xóa bảng và enum cũ, tạo `blockchain_proofs` với CHECK và index.
- [ ] Cập nhật `prisma/schema.prisma`; `prisma validate`, `prisma generate`.
- [ ] Chạy trên PostgreSQL local dùng một lần; `prisma migrate diff` không còn khác biệt.

## U2. Chuyển 4 loại hiện có

- [ ] Repository dùng bảng cấu hình theo `kind`.
- [ ] Kiểm nhận, mẻ nấu, mẫu lưu, hồ sơ đăng ký ghi vào `blockchain_proofs`; `recordId` mới.
- [ ] `kitchen.service` đếm `blockchainProof`; xóa module `traceability`.
- [ ] Test hiện có chạy qua với bảng mới.

## U3. Mục 3: khai báo giao hàng

- [ ] Payload `DELIVERY_DECLARED`, gắn vào `dispatch`.
- [ ] Kiểm nhận thêm `declarationHash`, `payload_version = 2`.
- [ ] Kind `delivery-declarations`, quyền trường và NCC.
- [ ] Test.

## U4. Mục 7: phân phối suất ăn

- [ ] Payload `MEAL_DISTRIBUTED`, gắn vào `confirmDistribution`.
- [ ] Kind `meal-distributions`.
- [ ] Test.

## U5. Mục 8: chuỗi kiểm chứng

- [ ] `GET /api/blockchain-proofs/chains/meal-allocations/:mealAllocationId`, có `verify=true`.
- [ ] Đối chiếu nghiệp vụ: kiểm nhận so với khai báo, phân phối so với mẻ nấu.
- [ ] Test: sửa một lô thì các nút phía sau báo không khớp.

## U6. Tài liệu và kiểm tra

- [ ] `docs/AUTHORIZATION.md`, `README.md`, `src/modules/README.md`.
- [ ] `lint`, `typecheck`, `build`, `test:unit`, `test:spec-gate`.
- [ ] Thử thật trên Sepolia với DB local: đi hết chuỗi khai báo → kiểm nhận → mẻ → mẫu → phân phối, rồi xác minh cả chuỗi.
