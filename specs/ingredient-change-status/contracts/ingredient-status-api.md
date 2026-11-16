# Contract: Đổi trạng thái nguyên liệu nhà cung cấp

## Endpoint

`PATCH /api/ingredients/management/:ingredientId/status`

Thay thế `POST /api/ingredients/management/:ingredientId/hide` trong contract 008. Không có route restore hoặc alias hide. Các endpoint thêm/sửa/đọc/upload khác giữ hợp đồng hiện tại.

## Xác thực và phạm vi

Sử dụng cơ chế đăng nhập hiện có. Bắt buộc tài khoản ACTIVE, role INGREDIENT_SUPPLIER_ADMIN, orgType SUPPLIER, membership hợp lệ, supplier ACTIVE và ingredient.manage hiệu lực.

Không có bypass System Admin; staff bị chặn kể cả có manage. Service nạp lại actor trong transaction; scope phải trùng scope principal ban đầu. Target ngoài supplier hiện tại và không tồn tại trả cùng 404, cùng thông báo “Không tìm thấy nguyên liệu”.

## Request

Content-Type: application/json. Params ingredientId là UUID theo validator hiện có.

Ẩn:

```json
{ "status": "INACTIVE" }
```

Hiện lại:

```json
{ "status": "ACTIVE" }
```

Body phải có đúng một trường status với giá trị chính xác như trên. Không có default hoặc toggle. Thiếu body, {}, null, status không hợp lệ và trường thừa như supplierId/name đều trả 400. PATCH sửa thông tin nguyên liệu tiếp tục không chấp nhận trường status.

## Success — 200

Dùng sendSuccess và IngredientResponse hiện có:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đổi trạng thái nguyên liệu thành công",
  "data": {
    "id": "11111111-1111-4111-8111-111111111111",
    "supplierId": "22222222-2222-4222-8222-222222222222",
    "supplierName": "Nhà cung cấp A",
    "supplier": {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Nhà cung cấp A"
    },
    "name": "Gạo",
    "defaultUnit": "kg",
    "description": null,
    "categoryId": null,
    "category": null,
    "coverImage": null,
    "imageDescription": [],
    "status": "ACTIVE",
    "createdAt": "2026-11-01T00:00:00.000Z",
    "updatedAt": "2026-11-16T00:00:00.000Z"
  }
}
```

Ví dụ chỉ minh họa dữ liệu; trường category khi có giá trị gồm id/categoryName/categoryDescription. Các trường supplierName/supplier giữ nullability và projection hiện có.

- Gửi đúng trạng thái hiện tại vẫn 200, data có trạng thái hiện tại và updatedAt không đổi.
- Chuyển trạng thái thật chỉ đổi status/updatedAt; mọi trường nội dung, định danh, chủ sở hữu và lịch sử giữ nguyên.
- Kết quả phản ánh lần thay đổi của yêu cầu đó sau commit; yêu cầu khác có thể đổi tiếp sau đó.

## Errors

| HTTP | Tình huống                                                                      |
| ---- | ------------------------------------------------------------------------------- |
| 400  | UUID hoặc body không hợp lệ; giữ chi tiết lỗi theo helper, báo paths tiếng Việt |
| 401  | Không có xác thực hợp lệ theo cơ chế đăng nhập hiện có                          |
| 403  | Sai role/quyền/membership, supplier không ACTIVE hoặc scope đã thay đổi         |
| 404  | Target không tồn tại hoặc ngoài sở hữu                                          |
| 503  | Lỗi DB/transaction, gồm hết retry xung đột; không lộ query/driver               |
| 429  | Vượt hạn mức chung hiện có                                                      |

Envelope lỗi dùng sendError; tên trường chứa chi tiết là error, không thêm envelope riêng. Ví dụ body có status sai:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Nội dung yêu cầu không hợp lệ",
  "error": {
    "fields": [
      {
        "field": "status",
        "message": "Trạng thái phải là ACTIVE hoặc INACTIVE"
      }
    ]
  }
}
```

Thuộc tính thừa có path của chính trường thừa; lỗi object gốc có thể dùng path body theo parseRequest hiện có. Không đưa giá trị thô đã gửi vào phản hồi.

## Concurrency và gửi lặp

Đặt trạng thái đích giúp gửi lại an toàn khi chưa biết kết quả lần trước. No-op vẫn kiểm tra quyền và sở hữu. Cùng một nguyên liệu được xử lý theo thứ tự transaction ghi nhận; không có version token hoặc If-Match mới. Hết retry trả lỗi an toàn; client đọc lại và gửi trạng thái đích nếu cần.

## Chuyển client

| Trước                                         | Sau                                                   |
| --------------------------------------------- | ----------------------------------------------------- |
| POST /management/:id/hide, không body hoặc {} | PATCH /management/:id/status, body status INACTIVE    |
| Chưa có thao tác mở lại                       | Cùng PATCH /management/:id/status, body status ACTIVE |

POST hide cũ không còn handler; với danh tính hợp lệ đi vào notFoundHandler 404 và không thay đổi dữ liệu. Auth middleware có thể trả lỗi trước 404 cho danh tính không hợp lệ. Không chuyển hướng hoặc gọi ngầm endpoint mới.

Hiện lại không tự bật supplier, quan hệ đối tác, entry hay giao dịch. Các lựa chọn mới tiếp tục áp mọi bộ lọc ngoài status.
