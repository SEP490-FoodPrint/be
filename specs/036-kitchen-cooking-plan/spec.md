# Spec: Kitchen Cooking Plan & Dish Catalog Recipe Enhancements

## 1. Tổng quan

Tính năng cập nhật quy trình lập kế hoạch nấu ăn (`kitchen`, `supply-round`, `supplier-order`) và phân quyền `cooking_plan_permissions` ở Backend, đồng thời cập nhật giao diện `DishCatalog` và `KitchenCooking` (`CreateBatch`, `CreateBatchSeparate`, `CookingBatches`) ở Frontend.

## 2. Yêu cầu chức năng

- Bổ sung migration `20261211000100_cooking_plan_permissions` cho phân quyền kế hoạch nấu ăn.
- Cập nhật logic lập kế hoạch lô/mẻ nấu (`lot-batch-planner.ts`, `kitchen.service.ts`).
- Cập nhật logic lập kế hoạch món ăn theo đợt cung ứng (`round-dish-planning.ts`, `supply-round.repository.ts`, `supply-round.service.ts`) và đơn đặt hàng nhà cung cấp (`supplier-order.repository.ts`, `supplier-order.service.ts`).
- Cập nhật unit test tương ứng (`lot-batch-planner.test.ts`, `supply-round.test.ts`).

## 3. Trạng thái làm rõ

Đặc tả đã đầy đủ, không còn điểm chưa làm rõ.
