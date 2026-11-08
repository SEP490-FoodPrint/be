# Contract: Ingredient Supplier Admin

## Quyền và đường dẫn

Base /api/ingredients/management. Mọi endpoint cần đăng nhập, role INGREDIENT_SUPPLIER_ADMIN, orgType SUPPLIER, membership hợp lệ, supplier ACTIVE và ingredient.manage hiệu lực. Staff bị chặn kể cả có manage. Scope supplier từ principal; không nhận supplierId từ query/body.

GET /api/ingredients cũ giữ quyền đọc hiện có. Danh mục dùng chung chỉ đọc sau khi xác minh supplier của actor; không thêm permission catalog mới.

| Method | Path từ base        | Input                    | Thành công                                |
| ------ | ------------------- | ------------------------ | ----------------------------------------- |
| GET    | /                   | page, limit              | 200, nguyên liệu riêng ACTIVE và INACTIVE |
| GET    | /categories         | page, limit              | 200, danh mục dùng chung                  |
| GET    | /:ingredientId      | UUID                     | 200, chi tiết thuộc sở hữu                |
| POST   | /                   | CreateBody               | 201, nguyên liệu vừa tạo                  |
| PATCH  | /:ingredientId      | UUID, UpdateBody         | 200, nguyên liệu sau sửa                  |
| POST   | /:ingredientId/hide | UUID, không body hoặc {} | 200, nguyên liệu INACTIVE                 |

Đăng ký categories trước param route. Mọi danh sách qua scope helper quản trị ở resource-access; repository áp scope cho ingredients. Danh mục không có supplierId giả. Giữ auth middleware/limiter hiện hành.

## Input

Ví dụ CreateBody:

```json
{
  "name": "Cà rốt",
  "defaultUnit": "kg",
  "description": "Nguyên liệu tươi",
  "categoryId": "11111111-1111-4111-8111-111111111111",
  "coverImage": "https://example.com/carrot.jpg",
  "imageDescription": ["/images/1.jpg", "/images/2.jpg", "/images/3.jpg"]
}
```

- name/defaultUnit bắt buộc khi tạo, trim, không rỗng, tối đa 255/30 ký tự.
- description là string/null tùy chọn; categoryId UUID/null, nếu có phải tồn tại.
- coverImage là một string/null; không mảng hoặc chuỗi rỗng.
- imageDescription là string[], mặc định []; không null; giữ thứ tự, không tự deduplicate.
- Ảnh: trim, tối đa 2048 ký tự, HTTP/HTTPS tuyệt đối không credentials hoặc đường dẫn bắt đầu / nhưng không //; không control character/backslash/scheme khác. Server không fetch/kiểm tra nội dung ảnh.
- UpdateBody dùng cùng editable fields nhưng đều tùy chọn, ít nhất một trường. Bỏ qua giữ nguyên; null xóa các nullable fields, [] xóa ảnh mô tả.
- Strict object từ chối supplierId/id/status/category cũ/createdAt/updatedAt và trường lạ.
- Query chỉ page/limit dạng số nguyên dương, mặc định 1/20, limit ≤100; giữ giới hạn offset hiện tại. Không filter mới.
- Giữ JSON body limit hiện có 100 KiB, quá giới hạn trả 413; không multipart upload.

## Output

Giữ sendSuccess envelope: { success: true, statusCode, message, data }. Item quản trị:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "supplierId": "33333333-3333-4333-8333-333333333333",
  "name": "Cà rốt",
  "defaultUnit": "kg",
  "description": null,
  "categoryId": null,
  "category": null,
  "coverImage": null,
  "imageDescription": [],
  "status": "ACTIVE",
  "createdAt": "2026-11-08T00:00:00.000Z",
  "updatedAt": "2026-11-08T00:00:00.000Z"
}
```

Khi có danh mục, category là { id, categoryName, categoryDescription }, categoryId trùng category.id. categoryDescription nullable. Danh sách có data: { items: [...], pagination: { page, limit, hasNext } }; order id tăng dần, lấy thêm một dòng. Category item đúng ba trường, không timestamps/status/supplierId. Ẩn lại thành công không thay dữ liệu.

## Errors

Giữ sendError: { success: false, statusCode, message, error? }. Tiếng Việt, gom validation issues với field path như imageDescription.1; không nhúng input thô.

| HTTP    | Điều kiện                                                                                |
| ------- | ---------------------------------------------------------------------------------------- |
| 400     | Input/query/UUID sai, trường lạ, sửa rỗng, categoryId không tồn tại                      |
| 401     | Chưa đăng nhập hoặc token không hợp lệ                                                   |
| 403     | Sai role/quyền, account không ACTIVE, membership/supplier không hợp lệ hoặc không ACTIVE |
| 404     | Không tồn tại hoặc ngoài sở hữu, cùng thông báo “Không tìm thấy nguyên liệu”             |
| 409     | Tên trùng cùng supplier, kể cả ghi đồng thời                                             |
| 413     | Vượt giới hạn body hiện hành                                                             |
| 429/503 | Giữ limiter hiện có; DB lỗi/transaction hết retry xử lý an toàn                          |

Recheck actor/supplier, kiểm tra target/category và ghi cùng transaction. Không chỉ dựa vào middleware, không lưu một phần khi lỗi.

## Tương thích legacy

- API đọc cũ/menu/supplier discovery giữ category string/null từ categoryName, không đổi object.
- Filter category chuỗi so tên chính xác; distinct category cũ tiếp tục chỉ dựa trên ingredients ACTIVE.
- Select/map allowlist, không vô tình trả cột ảnh hoặc relation mới ở endpoint cũ.
- Lựa chọn mới lọc ACTIVE; hồ sơ lịch sử không thêm filter làm mất nguyên liệu đã ẩn.
