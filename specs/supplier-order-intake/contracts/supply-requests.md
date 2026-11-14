# HTTP Contract: Supplier order intake

**Base path**: `/api/supply-requests` (mount hiện có).

## Quyền chung

JWT chỉ cung cấp danh tính; authenticate nạp tài khoản ACTIVE/quyền/membership hiện hành. Tính năng supplier yêu cầu org SUPPLIER và role `INGREDIENT_SUPPLIER_ADMIN` hoặc `INGREDIENT_SUPPLIER_STAFF`. Không có bypass SYSTEM cho detail/accept. Đọc yêu cầu `supply_request.view`, ghi yêu cầu `supply_request.accept`, kiểm tra độc lập. Quyền accept không tự cấp quyền view.

Không nhận schoolId/supplierId hoặc danh tính/thời điểm người nhận làm input. UUID dùng schema chung và chuẩn hóa chữ thường. Tất cả schemas strict; lỗi nhiều trường được gom qua request-validation hiện có, thông báo tiếng Việt kèm field path, không lộ input thô.

## Envelope và serialization

Thành công HTTP 200: `{ success: true, statusCode: 200, message: string, data: ... }` qua sendSuccess. Lỗi qua sendError: `{ success: false, statusCode: number, message: string, error?: ... }`; giữ cấu trúc lỗi chung hiện hành, không thêm error code dành riêng tính năng.

UUID là string; timestamp ISO 8601 UTC; date-only YYYY-MM-DD; nullable field là null, không bỏ field. Decimal requestedQuantity là chuỗi thập phân chính xác theo Decimal.toString(), không cam kết giữ các số 0 tận cùng, không chuyển Number.

## GET `/api/supply-requests`

### Query SUPPLIER

| Param  | Quy tắc                                                                                    |
| ------ | ------------------------------------------------------------------------------------------ |
| page   | Chuỗi số nguyên dương an toàn; mặc định 1.                                                 |
| limit  | Chuỗi số nguyên dương, mặc định 20, tối đa 100.                                            |
| status | Optional, một giá trị SENT / ACCEPTED / IN_PROGRESS / COMPLETED / CANCELLED, đúng chữ hoa. |

Không nhận query khác, mảng, object hoặc giá trị status DRAFT. Giữ giới hạn offset `(page-1)*limit <= 2147483647`. Không truyền status nghĩa là cả năm trạng thái ngoài nháp.

### Data SUPPLIER

`{ items: SupplierOrderListItem[], pagination: { page: number, limit: number, hasNext: boolean } }`

| Field mỗi item                         | Type                            |
| -------------------------------------- | ------------------------------- |
| id / requestNo / schoolId / supplierId | string                          |
| schoolName                             | string                          |
| status                                 | Một trong năm trạng thái đã gửi |
| requestedDeliveryDate                  | string date-only hoặc null      |
| sentAt / acceptedAt                    | string timestamp hoặc null      |
| createdAt / updatedAt                  | string timestamp                |

Giữ tất cả field list cũ; schoolName, requestedDeliveryDate và sentAt là phần bổ sung cho SUPPLIER. Chỉ trả đơn supplierId của actor và tập trạng thái được phép; `id asc` ổn định khi không đổi dữ liệu; lấy limit+1 để xác định hasNext. Không trả tổng số chưa được yêu cầu. Không có kết quả/trang vượt phạm vi trả items rỗng, hasNext false.

### Tương thích SCHOOL/SYSTEM

Route GET dùng chung giữ quyền/resource scope hiện có qua `listScopes["supply-order"]`, không áp role supplier cho nhánh khác. SCHOOL vẫn thấy đơn của trường kể cả DRAFT; SYSTEM giữ chính sách scope hiện hành khi có quyền. Hai nhánh giữ nguyên tám field `id, requestNo, schoolId, supplierId, status, acceptedAt, createdAt, updatedAt` và pagination. Chỉ nhận page/limit; gửi status trả 400. Thay đổi này không cấp thêm quyền đọc cho bất kỳ role nào.

## GET `/api/supply-requests/:id`

Endpoint mới, chỉ dành cho supplier hai role có quyền view. Params id UUID; query rỗng. Không tồn tại, ngoài scope hoặc DRAFT trả cùng loại lỗi 404.

### Data

Gồm tất cả field của SupplierOrderListItem và:

| Field                     | Type / ý nghĩa                             |
| ------------------------- | ------------------------------------------ |
| note                      | string hoặc null                           |
| acceptedByUserId          | UUID string hoặc null, người nhận đầu tiên |
| items                     | Toàn bộ dòng thuộc yêu cầu, sắp id asc     |
| items[].id                | UUID dòng                                  |
| items[].ingredientEntryId | UUID nguyên liệu của trường                |
| items[].ingredientName    | Tên Ingredient hiện tại từ entry           |
| items[].requestedQuantity | Chuỗi Decimal chính xác                    |
| items[].unit              | Đơn vị đã lưu trong dòng                   |
| items[].note              | string hoặc null                           |

Không lọc ACTIVE Ingredient/IngredientEntry để giữ dòng lịch sử. Không trả contractSnapshot, hồ sơ đăng ký, full user, email/phone hay thông tin xác thực. Không bổ sung ghi chú phản hồi hoặc sửa đơn thông qua endpoint này.

## POST `/api/supply-requests/:id/accept`

Giữ endpoint hiện có và receipt hiện có. Yêu cầu role supplier hợp lệ + quyền accept, không bắt buộc quyền view.

- Params id UUID.
- Query phải rỗng.
- Body không có hoặc `{}`; null, array hoặc có field nghiệp vụ đều 400.

### Data — giữ nguyên bốn field

```json
{
  "id": "00000000-0000-4000-8000-000000000006",
  "status": "ACCEPTED",
  "acceptedByUserId": "00000000-0000-4000-8000-000000000003",
  "acceptedAt": "2026-11-14T03:00:00.000Z"
}
```

Với lần nhận mới, status ACCEPTED và người/thời điểm nhận do hệ thống ghi. Với receipt cũ, status có thể ACCEPTED hoặc IN_PROGRESS; giữ null nếu dữ liệu lịch sử thiếu, không sửa hoặc điền bù. Cả hai trường hợp HTTP 200.

### Quy tắc nghiệp vụ

1. Kiểm tra quyền/role/scope hiện hành trước và trong transaction.
2. DRAFT/ngoài scope/không tồn tại -> 404; COMPLETED/CANCELLED -> 409.
3. ACCEPTED/IN_PROGRESS -> receipt cũ, không ghi, kể cả khi supplier đã tạm dừng hoặc admin một bên bị khóa sau lần nhận đầu. Actor vẫn phải có quyền/membership hợp lệ.
4. SENT -> ACCEPTED chỉ khi Supplier.intakeState ACTIVE và admin hai bên không DEACTIVATED. Supplier tạm dừng hoặc admin hai bên bị vô hiệu hóa -> 409. School intake PAUSED không tự chặn việc nhận đơn đã gửi.
5. Ghi trạng thái, người nhận và thời điểm cùng transaction; hai người nhận cùng một đơn không được ghi đè nhau. Khi conflict transient vượt giới hạn retry, giữ lỗi an toàn hiện hành để client thử lại; không trả receipt giả thành công.

## Lỗi

| HTTP | Trường hợp                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------- |
| 400  | UUID/query/body không hợp lệ, status không hỗ trợ, sai phân trang, trường lạ                        |
| 401  | Thiếu hoặc sai xác thực theo middleware hiện hành                                                   |
| 403  | Tài khoản không hoạt động, sai org/role/membership hoặc thiếu quyền hiệu lực                        |
| 404  | Chi tiết/tiếp nhận không tồn tại, ngoài scope hoặc DRAFT                                            |
| 409  | Trạng thái không cho nhận mới, supplier tạm dừng hoặc admin một bên vô hiệu hóa; xung đột nghiệp vụ |
| 429  | Rate limiter API hiện hành                                                                          |
| 503  | Dependency/database/authorization hoặc rate-limit store không sẵn sàng theo handler hiện hành       |

Lỗi không trả SQL, URL kết nối, token, raw body hoặc nội dung đơn ngoài scope.
