# Contract: API upload ảnh nguyên liệu

## Authentication và phạm vi

Hai API dưới `/api/ingredients/management` dùng session/cookie hoặc Bearer theo hệ thống hiện hành. POST cần `X-CSRF-Protection: 1`; nếu gửi Origin thì phải khớp client origin. Rate limit `/api` giữ nguyên.

Chỉ ACTIVE `INGREDIENT_SUPPLIER_ADMIN`, SUPPLIER membership hợp lệ đang ACTIVE, quyền `ingredient.manage` hiệu lực. Staff/System/role khác không bypass. Supplier được service kiểm trước multipart; sau đọc body, service nạp lại actor/quyền/supplier và chặn nếu supplierId đổi. Không nhận supplierId, ingredientId, namespace, publicId, folder hoặc visibility từ client.

## Endpoints

| Method | Path                                      | Multipart field | Số tệp |
| ------ | ----------------------------------------- | --------------- | ------ |
| POST   | /api/ingredients/management/upload-image  | image           | Đúng1  |
| POST   | /api/ingredients/management/upload-images | images (lặp)    | 1–5    |

Không query params, text fields hoặc field tệp khác. Content-Type phải multipart/form-data với boundary hợp lệ. Không dùng JSON/base64/URL upload. Mỗi tệp JPEG/PNG/WebP1..5MiB; MIME và bytes phải khớp, ảnh phải giải mã được.

Multer dùng memoryStorage với parser fileSize=5MiB+1byte, files1/5, fields0 và parts=maxFiles+1, giới hạn fieldName/header hữu hạn theo parser. Validator sau parse vẫn bắt buộc size<=5MiB. Khoảng đệm kỹ thuật này cần vì Busboy phát limit ngay khi đạt ngưỡng; không nâng giới hạn nghiệp vụ và không nhận thêm tệp/text field. Đầu vào vượt size trả413; thiếu/thừa tệp, sai field hoặc text trả400. Không tăng express.json limit.

## Single response — HTTP201

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Tải ảnh thành công",
  "data": {
    "publicId": "foodprint/uploads/ingredients/<supplier-uuid>/<asset-uuid>",
    "url": "https://res.cloudinary.com/<cloud>/image/upload/v1/<public-id>.jpg",
    "format": "jpg",
    "bytes": 12345,
    "width": 800,
    "height": 600
  }
}
```

URL ví dụ chỉ minh họa shape; lấy URL trả thực tế để lưu. Single upload error503, không trả data tài nguyên giả.

## Many response — HTTP200

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Đã xử lý lượt tải ảnh",
  "data": {
    "results": [
      {
        "index": 0,
        "status": "success",
        "asset": {
          "publicId": "foodprint/uploads/ingredients/<supplier-uuid>/<asset-uuid>",
          "url": "https://res.cloudinary.com/<cloud>/image/upload/v1/<public-id>.png",
          "format": "png",
          "bytes": 12345,
          "width": 800,
          "height": 600
        }
      },
      {
        "index": 1,
        "status": "failed",
        "error": {
          "code": "UPLOAD_TIMEOUT",
          "message": "Quá thời gian tải tệp lên dịch vụ lưu trữ"
        }
      }
    ]
  }
}
```

HTTP200 và envelope success=true nghĩa là lượt hợp lệ đã được xử lý xong. Luôn đọc từng result.status, kể cả mọi tệp đều failed. Không trả207 và không biến partial failure thành lỗi chung làm mất asset thành công. Index theo vị trí trong request hiện tại; upload lại riêng tệp lỗi sẽ có index mới.

## Lỗi trước lượt hoặc single failure

| HTTP | Tình huống                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------- |
| 400  | Sai multipart/field/query/body/count, thiếu/rỗng tệp, MIME/signature/decode sai, buffer metadata sai                |
| 401  | Chưa đăng nhập hoặc session không hợp lệ                                                                            |
| 403  | CSRF/origin sai; sai role/quyền/membership; supplier không ACTIVE hoặc scope thay đổi                               |
| 413  | Tệp vượt5MiB                                                                                                        |
| 429  | Rate limit hiện hành                                                                                                |
| 503  | Cấu hình lưu trữ thiếu/placeholder hoặc phụ thuộc không sẵn sàng trước lượt; single upload/timeout/invalid response |

Dùng sendError và error handler hiện có. Validation trả `error.fields` với đường dẫn tệp, ví dụ `files.2.mimeType`, tiếng Việt và không lộ giá trị raw. Lỗi cấu hình/transport dùng HttpError503 + safe code; lỗi DB đọc phân quyền dùng quy tắc databaseOperation hiện hành. Không có upload network trước khi vượt qua xác thực, phạm vi và toàn bộ validation.

## Lưu ảnh vào nguyên liệu

Giữ POST `/api/ingredients/management` và PATCH `/api/ingredients/management/:ingredientId` nhận JSON. Đặt `data.url` single hoặc `asset.url` từ các result success vào coverImage/imageDescription; không gửi metadata upload vào body create/update. Quyền và business validation được kiểm lại ở request lưu này.

Không cập nhật nguyên liệu chỉ vì upload thành công, không giảm giới hạn tổng số ảnh đã lưu xuống5, không xóa Cloudinary asset khi thay URL hoặc lưu lỗi. Không có document upload HTTP API trong feature này.
