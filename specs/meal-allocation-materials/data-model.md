# Dữ liệu phân bổ nguyên liệu

- CookingBatchDish thêm allocationRecipeSnapshot JSON tùy chọn. Phiên bản 1 gồm profiles theo gradeId và fallback, mỗi dòng có ingredientId, quantityPerPortion và unit.
- MealAllocationBatch đổi allocatedPortions sang numeric(20,2), thêm allocationVersion mặc định 1 và theoreticalPortions numeric(24,12).
- MealAllocationMaterial liên kết bản ghi phân bổ với CookingBatchLot qua khóa ghép, lưu ingredientId, quantity và quantityPerPortion numeric(24,9), unit chuẩn.
- Phiên bản 1 giữ điều kiện số suất dương. Phiên bản 2 cho phép 0.00 với suất lý thuyết dương, lượng nguồn dương được kiểm tra tại service.
- Thay thế phân bổ chỉnh được trong cùng transaction. FK cascade xóa chi tiết cũ, FK restrict bảo vệ nguồn nguyên liệu.
- Migration giữ dữ liệu số nguyên cũ và không suy diễn bản chụp cho lô lịch sử.
