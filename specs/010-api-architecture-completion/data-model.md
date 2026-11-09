# Data Model: Giữ nguyên schema

Phạm vi implementation chỉ menu/kitchen/retained-sample. Các thực thể module khác bên dưới chỉ được đọc qua code hiện có, không sửa module đó.

Không tạo model/column/enum/index hoặc migration. Schema/migrations từ dev mới nhất chỉ được đọc và generate client.

- WeeklyMenu/MenuDay/MenuDayDish và nhóm suất giữ quan hệ, định mức, trạng thái và duyệt nguyên tuần.
- CookingBatch/CookingBatchLot/InventoryTransaction giữ invariant kho, row locks và một transaction cho các ghi liên quan.
- RetainedFoodSample giữ enum và trường hiện có. expiresAt được tính sampledAt +24h khi đọc; không thêm cột. Search dùng quan hệ CookingBatch/Dish; count/list cùng scope.
- Account/Role/Permission/UserPermissionDenial, hồ sơ và outbox giữ current-principal recheck, thứ tự ghi và safe projections.
- School/Supplier/contracts/certifications/ingredients và mọi module danh sách giữ định danh, pagination và ownership.
- Request/Response DTO là hợp đồng chương trình, không phải persistence model.
