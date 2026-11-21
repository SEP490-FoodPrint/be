# Plan

1. Cảnh báo đồ lưu kho (FR-001) — `src/modules/warehouse/warehouse.stock-alerts.ts`:
   - `computeStockAlerts`: nguồn `PENDING` bỏ qua `availableFrom`; chỉ lô (`LOT`) còn xét ngày dùng được.
   - Sắp xếp nguồn: hạn sớm trước, cùng hạn thì `LOT` trước `PENDING`.
   - Repository giữ nguyên trạng thái đang chờ `SENT | ACCEPTED | IN_PROGRESS`, nên đơn `CANCELLED` tự rơi khỏi phần đã đặt.
2. Lọc ngày kiểm tra giao hàng (FR-002) — `src/modules/delivery/delivery.repository.ts`:
   - Nhánh `SupplyRequest.requestedDeliveryDate` trong `inspectionWhere` chỉ áp dụng khi `arrivedAt` và `expectedArrivalAt` đều null.
3. Dị ứng theo nhóm (FR-003):
   - Migration `prisma/migrations/20261128000100_class_allergy_groups`: thêm `group_no` (1–50) vào hai bảng; PK `class_allergies (class_id, group_no, ingredient_entry_id)`, PK `daily_allergy_portions (daily_meal_portion_id, class_id, group_no, ingredient_entry_id)`; bỏ FK `daily_allergy_portions → class_allergies`, thêm FK `ingredient_entry_id → ingredient_entries`; chỉ mục `class_allergies (ingredient_entry_id)`.
   - `prisma/schema.prisma`: `groupNo` trên `ClassAllergy`, `DailyAllergyPortion`; quan hệ `DailyAllergyPortion.IngredientEntry`.
   - `src/utils/allergy-match.ts`: `groupAllergies`, `totalAllergyPortions`, `allergyGroupTarget`; `splitPortionsIntoGroups` và `expectedSpecialGroupCounts` gom theo `groupNo` (thiếu = nhóm 1, giữ hành vi danh sách chung).
   - `meal-attendance`: validation nhóm cho hồ sơ lớp và báo suất; `saveClassAllergies` ghi lại toàn bộ nhóm; `saveDraft` kiểm tra theo nhóm và lưu bản chụp mỗi nguyên liệu của nhóm; `autoSplitPortionGroups`, `savePortionGroups` truyền `groupNo`; bỏ việc tự tạo dòng dị ứng từ nhóm suất GVCN chia tay.
   - `kitchen.service` (`readMealPortionDemand`), `meal-allocation` (repository + `allergy-dish-demand`), `menu` (`affectedStudentsByClass`), `allergy` (DTO `groupNo`) đọc tên nguyên liệu qua `IngredientEntry` và cộng theo nhóm.
4. Test: `warehouse-stock-alerts`, `allergy-match` (kịch bản A, B, A + B), `meal-submission`, `meal-allocation`, `allergy-catalog`, `modules`, `authorization.integration` (nhóm 1).
