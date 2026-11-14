# Công việc

- [x] T001 Cập nhật `ingredientLegacySelect` với quan hệ `Supplier` và `description` trong `src/modules/ingredient/ingredient.repository.ts`.
- [x] T002 Định nghĩa các trường `supplierName`, `supplier`, `description` trong `src/modules/ingredient/ingredient.response.dto.ts`.
- [x] T003 Ánh xạ dữ liệu nhà cung cấp và mô tả trong mapper `legacyDto` tại `src/modules/ingredient/ingredient.service.ts`.
- [x] T004 Kiểm tra tương thích dữ liệu live với frontend và loại bỏ hoàn toàn mock data.
- [x] T005 Bổ sung thông tin nhà cung cấp, đơn đặt hàng, hội đồng 4 bên và chi tiết đợt giao trong `GET /api/deliveries` tại `src/modules/delivery/delivery.service.ts`.
- [x] T006 Mở rộng quyền truy cập API `GET /api/v1/daily-meal-portions` cho `supply_request.create` tại `src/modules/meal-attendance/meal-attendance.routes.ts` và `src/modules/meal-attendance/meal-attendance.service.ts`.
- [x] T007 Bổ sung thông tin mặt hàng, nhà cung cấp, đợt giao nhận và cơ sở nguồn trong `GET /api/ingredient-lots` tại `src/modules/warehouse/warehouse.service.ts`.
- [x] T008 Bổ sung hotline nhà cung cấp và ngày hẹn giao trong `GET /api/deliveries` phục vụ màn hình theo dõi đơn hàng và cập nhật test fixtures.
