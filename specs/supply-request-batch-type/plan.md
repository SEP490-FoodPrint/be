# Plan

1. Prisma + migration `20261126000100_supply_request_batch_type` + script báo cáo `db:report:supply-batch`.
2. supplier-onboarding: validation, kiểm tra loại dòng hàng, quy tắc Đợt 2 theo `batchNo`.
3. supply-order / delivery / supplier-order: select, DTO, filter, `isDryDelivery` ưu tiên `orderType`.
4. Test T1–T8 (tests/supply-request-batch-type.test.ts, supplier-onboarding.test.ts); T9 (migration test) chờ được phép dùng DB local.
5. FE: payload 3 luồng, helper `batchTypeOf`, bỏ đoán text.
6. Migration 2 sau khi báo cáo rỗng.
