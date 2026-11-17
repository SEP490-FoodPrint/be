# Kế hoạch

1. Bổ sung quan hệ `Supplier` và trường `description` trong `ingredientLegacySelect` tại `src/modules/ingredient/ingredient.repository.ts`.
2. Mở rộng Response DTO `IngredientResponse` và `LegacyIngredientResponse` trong `src/modules/ingredient/ingredient.response.dto.ts`.
3. Cập nhật mapper trong `src/modules/ingredient/ingredient.service.ts` để gán `supplierName`, `supplier` và `description`.
4. Mở rộng truy vấn `select` và response DTO cho danh sách đợt giao nhận `GET /api/deliveries` phục vụ màn hình Phiếu nhập hàng.
5. Kiểm thử kết nối dữ liệu danh mục nguyên liệu và phiếu giao nhận với frontend.
6. Cho phép quyền `supply_request.create` truy cập API tổng hợp suất ăn `GET /api/v1/daily-meal-portions`.
7. Mở rộng truy vấn `select` cho API lô hàng tồn kho `GET /api/ingredient-lots` phục vụ màn hình Quản lý Kho đồ khô.
8. Mở rộng thông tin liên hệ nhà cung cấp và ngày hẹn giao trong API `GET /api/deliveries` phục vụ màn hình Theo dõi đơn hàng & Vận chuyển.
9. Bổ sung trường `note` trong `orderDraftSchema`, lưu thông tin lịch hẹn giao vào `tx.supplyRequest.create` trong `src/modules/supplier-onboarding/`.
10. Mở rộng `listSelect` và mapper `getAll` tại `src/modules/supply-order/` trả về ngày hẹn giao và thông tin nhà cung cấp cho trường học.
11. Bổ sung phương thức `findDetailForSchool` và phân quyền cho tài khoản Trường học xem chi tiết đơn đặt hàng trong `src/modules/supply-order/supply-order.service.ts`.
12. Bổ sung trường `gradeId` và `gradeName` trong `MealAttendanceClassDetailDTO` và phương thức `summary` tại `src/modules/meal-attendance/` phục vụ tính toán sĩ số theo khối lớp.

## Constitution Check

- I. Module phân lớp và DTO tách riêng (`ingredient.request.dto.ts` và `ingredient.response.dto.ts`).
- II. Endpoint được bảo vệ bằng middleware phân quyền và phạm vi tổ chức.
- III. Không làm thay đổi schema database hay migration không cần thiết.
- IV. Ghi/đọc thông qua Prisma Repository, không viết câu lệnh Prisma trực tiếp trong Service.
- V. Giữ envelope và ánh xạ DTO tường minh.
- VI. Spec, kế hoạch và công việc nằm cùng nhánh tính năng `feat/026-ingredient-management`.
