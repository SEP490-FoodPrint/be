# Plan

1. Kitchen (`src/modules/kitchen/`):
   - Repository `findDayProgress` (thực đơn đã duyệt trong ngày, món, lô nấu, mẫu lưu theo món).
   - Service `summarizeDayProgress` (hàm thuần) + `dayProgress`; controller, route `GET /day-progress` đặt trước `/:id`; DTO trong `kitchen.response.dto.ts`.
   - `planCookingBatches` (`SEPARATE_BY_LOT`): gom lô theo nguyên liệu + cơ sở nguồn; `readPlanningStock` trả `sourceFacilityId` (lô hoặc dòng hàng).
2. Warehouse (`src/modules/warehouse/`):
   - Repository `readStockAlertSource`: mục nguyên liệu, ngày thực đơn đã duyệt từ hôm nay, định mức món, gia vị chung, nhóm suất, lớp (số đăng ký + suất đã chốt), phân bổ của bữa, lô trong kho, phần đang giữ, yêu cầu nhập đồ lưu kho đang chờ.
   - `warehouse.stock-alerts.ts`: `mealDishPortions`, `buildStockAlertSource`, `computeStockAlerts` (hàm thuần, mô phỏng theo ngày, quy đổi đơn vị bằng `convertQuantity`).
   - Service `stockAlerts`, controller, route `GET /stock-alerts`; `warehouse.response.dto.ts`.
3. Sample storage: refine `compartmentCount <= capacity`, giới hạn 1–500.
4. Menu approval: `weekNumber` cho từng tuần (`academicWeekNumber`), chỉ đọc năm học khi đã có tuần gửi duyệt.
5. Supply order: `orderBy` danh sách NCC theo ngày giao dự kiến giảm dần.
6. Delivery: `completeRequestIfDone` sau khi chuyến `RECEIVED`.
7. Đổi chữ hiển thị "đồ khô" → "đồ lưu kho" trong thông báo lỗi / chú thích.
8. Test: `kitchen-day-progress`, `warehouse-stock-alerts`, `supply-request-completion` (thêm vào `test:unit`); cập nhật `dish-recipes`, `kitchen-nutrition-lists`, `sample-storage`, `menu-weekly-approval`, `supply-order-intake`, `delivery-inspections`, `supplier-order-creation`.
