# Data Model: Đổi trạng thái nguyên liệu

## Persistence hiện có

Sử dụng model Ingredient trong prisma/schema.prisma, bảng foodprint.ingredients. Không thêm model, cột, enum, constraint hoặc migration.

| Trường                                   | Kiểu hiện có                       | Quy tắc trong thao tác status                             |
| ---------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| id                                       | UUID, khóa chính                   | Định danh cố định; nhận qua params, kiểm tra UUID hiện có |
| supplierId                               | UUID, FK Supplier                  | Phạm vi từ principal đã xác thực, không nhận từ body      |
| status                                   | EntityStatus: ACTIVE hoặc INACTIVE | Trường nghiệp vụ duy nhất được thay đổi                   |
| updatedAt                                | Timestamptz, @updatedAt            | Chỉ thay khi có UPDATE thực sự; no-op giữ nguyên          |
| createdAt                                | Timestamptz                        | Giữ nguyên                                                |
| name, defaultUnit, description           | Các trường nội dung hiện có        | Giữ nguyên                                                |
| categoryId, coverImage, imageDescription | Phân loại và ảnh hiện có           | Giữ nguyên, bao gồm thứ tự imageDescription               |

Unique (supplierId, name), các index supplier/category và FK giữ nguyên. Mở lại không kiểm tra trùng tên mới vì không sửa tên hoặc tạo bản ghi.

## Quan hệ cần bảo toàn

- Ingredient thuộc một Supplier.
- Ingredient có danh mục tùy chọn, các ingredientEntries, contractItems, deliveryItems và menuDishIngredients.
- Những hồ sơ kho/truy xuất liên quan gián tiếp vẫn giữ định danh và snapshot hiện có. Thao tác status không tải hoặc ghi các quan hệ này.
- Tài khoản quản trị, role/grants/denials và membership là dữ liệu xác thực hiện có, không tạo bản ghi mới trong thao tác status.

## Bảng chuyển trạng thái

| Hiện tại | Đích     | Kết quả                   | Ghi DB     | updatedAt           |
| -------- | -------- | ------------------------- | ---------- | ------------------- |
| ACTIVE   | INACTIVE | Ẩn                        | Chỉ status | Cập nhật bởi Prisma |
| INACTIVE | ACTIVE   | Hiện lại                  | Chỉ status | Cập nhật bởi Prisma |
| ACTIVE   | ACTIVE   | Thành công, vẫn hoạt động | Không      | Giữ nguyên          |
| INACTIVE | INACTIVE | Thành công, vẫn ẩn        | Không      | Giữ nguyên          |

Mọi hàng đều yêu cầu đủ quyền, supplier ACTIVE và đúng chủ sở hữu, kể cả no-op. Không có xóa hoặc tạo bản sao.

## Input và validation

- Params: ingredientId theo requestUuidSchema hiện có; UUID hợp lệ được chuẩn hóa chữ thường.
- Body: object strict có đúng status bắt buộc, chỉ chấp nhận chuỗi chính xác ACTIVE hoặc INACTIVE.
- Không trim, viết hoa, ép kiểu, mặc định hoặc tự đảo trạng thái.
- Body thiếu, {}, null, array, status thiếu/null/sai kiểu/sai giá trị, hoặc trường thừa đều không hợp lệ.
- Request DTO suy từ schema; repository dùng input nội bộ, không phụ thuộc DTO.

## Output

Tái sử dụng IngredientResponse và hàm dto trong service: id, supplierId, supplierName/supplier theo projection hiện có, name, defaultUnit, description, categoryId/category, coverImage, imageDescription, status, createdAt, updatedAt. Ngày giờ là chuỗi ISO; không trả record Prisma trực tiếp.

## Toàn vẹn và cạnh tranh

Tất cả recheck actor/supplier, khóa supplier/target, đọc, so trạng thái, ghi và đọc kết quả dùng cùng tx Serializable hiện có. Service quyết định chuyển trạng thái; repository áp scope vào cả khóa, WHERE cập nhật và lần đọc lại.

Yêu cầu lặp sau khi retry có thể trở thành no-op; không đổi timestamp vì không UPDATE. Thứ tự ghi được transaction xác định, không lấy thứ tự HTTP response làm thứ tự commit. Lỗi không để lại cập nhật một phần và không được trả thành công trước commit.

## Ý nghĩa khi đọc nghiệp vụ

Quản trị và quyền đọc supplier hiện hành có thể thấy cả hai trạng thái. Các lựa chọn mới chỉ nhận ACTIVE theo bộ lọc hiện có; hiện lại chỉ phục hồi điều kiện status. Supplier, đối tác, entry hoặc hồ sơ khác đang dừng không tự được mở lại.
