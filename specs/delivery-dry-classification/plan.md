# Plan

## Constitution Check

- Chỉ sửa service/repository của module `delivery`; repository giữ toàn bộ điều kiện Prisma, service giữ quy tắc nghiệp vụ.
- Không có migration, seed hay thao tác DB từ xa.

## Approach

1. `delivery.repository.ts`: xóa `drySupplierIds`, `dryDeliveryWhere`, `markDrySupplier` và trường `supplierIsDry`; điều kiện ẩn xe đồ khô dùng `dryOnlyDeliveryWhere`.
2. `delivery.service.ts`: `isDryDelivery` chỉ xét dòng hàng (mọi dòng là `DRY_STOCK`).
3. Thay unit test hành vi "NCC đồ khô" bằng test xe hỗn hợp khô + tươi là xe đồ tươi.

## Verification

- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:unit`.
