# Plan

1. DB (FR-001, FR-003): migration `prisma/migrations/20261204000100_ingredient_entry_waste_rate` thêm cột + CHECK, thêm quyền `ingredient_waste_rate.manage` và cấp cho `SCHOOL_KITCHEN_STAFF`; `prisma/schema.prisma` thêm `IngredientEntry.wasteRate`; `src/constants/permission-catalog.ts` thêm quyền và grant.
2. Helper (FR-002): `src/utils/waste-rate.ts` với `grossFromNet`, `netFromGross` (Prisma.Decimal, kiểm tra 0 <= r < 1).
3. API (FR-003): module `ingredient-entry` thêm validation, request/response DTO, repository, service (`listWasteRates`, `updateWasteRate` trong `withSchoolTransaction`), controller và route.
4. Đặt hàng (FR-004): `supply-order/fresh-demand.service.ts` đọc `entry.wasteRate`, `perPortion = grossFromNet(requiredQuantity, r) × factor`.
5. Kho (FR-005): `warehouse.repository` + `warehouse.stock-alerts` đổi dòng món sang lượng sống; `menu.repository.ingredientStockEntries` + `menu.service` (bảng nhu cầu–tồn kho bữa) tương tự.
6. Bếp (FR-006): `kitchen.repository` chọn `wasteRate`; `kitchen.service` dựng công thức lập mẻ theo lượng sống, `planCookingBatches.take` làm tròn lên 3 chữ số, DTO lô có `cookedQuantity`.
7. Phân bổ (FR-007): `meal-allocation.repository` chọn `wasteRate`; `material-allocation.service` quy nguồn về thành phẩm, kiểm tra lịch sử theo lượng sống; `verifyStoredMaterialAllocations` giữ cận trên theo lượng sống.
8. Tài liệu: `docs/AUTHORIZATION.md`.
9. Test: `tests/waste-rate.test.ts` (helper, validation, fresh-demand, planCookingBatches); thêm vào `test:unit`.
