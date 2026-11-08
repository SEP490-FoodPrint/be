# Data Model: Supplier Ingredient Management

## IngredientCategory

Prisma model IngredientCategory, @@map("ingredient_categories"), @@schema("foodprint"). Có đúng ba cột persisted; inverse relation không tạo cột.

| Thuộc tính          | Lưu trữ                     | Null/default                | Quy tắc                                       |
| ------------------- | --------------------------- | --------------------------- | --------------------------------------------- |
| id                  | UUID                        | NOT NULL, gen_random_uuid() | Primary key                                   |
| categoryName        | VARCHAR(120), category_name | NOT NULL                    | CHECK không chỉ khoảng trắng; chưa đặt unique |
| categoryDescription | TEXT, category_description  | nullable                    | Mô tả văn bản                                 |

Không status/timestamps/supplierId. Quan hệ một danh mục có nhiều Ingredient; chưa có write API.

## Ingredient

Giữ cột và ràng buộc hiện có, thay category bằng categoryId.

| Thuộc tính           | Lưu trữ                                        | Quy tắc                                               |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| id, supplierId       | UUID như hiện tại                              | Không sửa qua input                                   |
| name                 | VARCHAR(255)                                   | Trim, không rỗng; unique cùng supplier kể cả INACTIVE |
| defaultUnit          | VARCHAR(30)                                    | Trim, không rỗng                                      |
| description          | nullable TEXT                                  | Riêng với ảnh                                         |
| categoryId           | nullable UUID, category_id                     | FK IngredientCategory.id Restrict/NoAction; index mới |
| coverImage           | nullable TEXT, cover_image                     | Một tham chiếu ảnh theo contract                      |
| imageDescription     | NOT NULL TEXT[], image_description, default [] | Giữ thứ tự, CHECK không phần tử null                  |
| status               | EntityStatus ACTIVE/INACTIVE                   | Default ACTIVE, không enum mới                        |
| createdAt, updatedAt | timestamptz như hiện tại                       | Giữ @updatedAt                                        |

Giữ unique supplierId/name, index supplierId và các FK IngredientEntry/MenuDayDishIngredient/SupplierContractItem. CHECK version hóa trong SQL; không function/trigger. Quy tắc URL do validation kiểm tra.

## Validation và output

- Tạo cần name/defaultUnit; nullable field bỏ qua thành null, ảnh mô tả bỏ qua thành [].
- Sửa ít nhất một editable field; bỏ qua giữ nguyên; null xóa description/categoryId/coverImage; [] xóa ảnh mô tả. Không nhận null cho name/defaultUnit/imageDescription.
- Params/categoryId UUID, strict object từ chối supplierId, id, status, category cũ và timestamp.
- Request DTO infer schema, Response DTO riêng; chỉ service dùng DTO và map allowlist, ISO timestamps. Repository dùng operation-specific internal input, không DTO.

## Chuyển trạng thái

| Thao tác | Trước                | Sau                                      |
| -------- | -------------------- | ---------------------------------------- |
| Tạo      | Chưa có              | ACTIVE                                   |
| Sửa      | ACTIVE hoặc INACTIVE | Giữ nguyên                               |
| Ẩn       | ACTIVE               | INACTIVE                                 |
| Ẩn lại   | INACTIVE             | INACTIVE, thành công không đổi timestamp |

Mọi thao tác yêu cầu admin/quyền/supplier hợp lệ, target đúng sở hữu. Không xóa hoặc INACTIVE → ACTIVE, không sửa trạng thái hồ sơ liên quan.

## Migration mới

1. Tạo bảng danh mục và cột mới, FK/index/CHECK; giữ migration cũ bất biến.
2. Chèn một danh mục cho mỗi chuỗi category DISTINCT có ý nghĩa; giữ nguyên chuỗi, description null. Null/chỉ khoảng trắng không tạo danh mục.
3. Backfill category_id theo phép bằng chuỗi cũ chính xác; ảnh cũ thành null/[].
4. Kiểm chứng trước khi drop: mọi category có ý nghĩa có category_id và tên khớp; fail migration nếu sai. Ingredient id/supplierId và toàn bộ FK giữ nguyên.
5. Drop category, hoàn tất migration atomic với transaction SQL rõ ràng phù hợp harness; cập nhật schema và tài liệu deployment status.

Fixture nâng cấp cần category null/blank, cùng tên giữa supplier, hoa/thường và khoảng trắng bao quanh. Không chạy SQL ở bước plan. Test DB tạm local được chọn tường minh; database sử dụng chỉ deploy theo nhiệm vụ hoặc CD được phép. Cần cửa sổ bảo trì vì ứng dụng cũ còn đọc cột đã bỏ; không sửa migration cũ để rollback.
