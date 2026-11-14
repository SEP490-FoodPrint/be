# Kế hoạch

1. Bổ sung quan hệ `Supplier` và trường `description` trong `ingredientLegacySelect` tại `src/modules/ingredient/ingredient.repository.ts`.
2. Mở rộng Response DTO `IngredientResponse` và `LegacyIngredientResponse` trong `src/modules/ingredient/ingredient.response.dto.ts`.
3. Cập nhật mapper trong `src/modules/ingredient/ingredient.service.ts` để gán `supplierName`, `supplier` và `description`.
4. Kiểm thử kết nối dữ liệu danh mục nguyên liệu với frontend.

## Constitution Check

- I. Module phân lớp và DTO tách riêng (`ingredient.request.dto.ts` và `ingredient.response.dto.ts`).
- II. Endpoint được bảo vệ bằng middleware phân quyền và phạm vi tổ chức.
- III. Không làm thay đổi schema database hay migration không cần thiết.
- IV. Ghi/đọc thông qua Prisma Repository, không viết câu lệnh Prisma trực tiếp trong Service.
- V. Giữ envelope và ánh xạ DTO tường minh.
- VI. Spec, kế hoạch và công việc nằm cùng nhánh tính năng `feat/026-ingredient-management`.
