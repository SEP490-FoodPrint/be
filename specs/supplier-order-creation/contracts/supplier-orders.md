# HTTP Contract: Supplier order creation

## Base và quyền

Nhóm mới `/api/deliveries/management` trên module `supplier-order`, đăng ký trước các route động delivery. Chỉ tài khoản ACTIVE, membership SUPPLIER và role INGREDIENT_SUPPLIER_ADMIN hoặc INGREDIENT_SUPPLIER_STAFF. Không SYSTEM bypass.

POST và các options yêu cầu delivery.manage. Management list/detail giữ policy delivery resource: có delivery.view HOẶC delivery.manage HOẶC delivery.receive, đồng thời đúng hai role. Mọi list gọi listScopes và repository WHERE có supplierId tin cậy; options schools lọc quan hệ ACTIVE thuộc supplier hiện tại. Không cấp quyền mới hoặc tự bật lại denial.

Envelope: giữ sendSuccess/sendError. Creation thành công lần đầu HTTP201, replay cùng key/payload HTTP200. Errors có message tiếng Việt và validation field paths; không phản chiếu raw values. Các DTO không trả DB record, creationKey/hash, hợp đồng hoặc hồ sơ tài khoản.

## POST `/api/deliveries/management`

Header `Idempotency-Key`: UUID bắt buộc; một giá trị duy nhất, chuẩn hóa lowercase. Không nhận key qua body/query. Query rỗng. JSON body là strict discriminated union theo sourceType.

### REQUEST

```json
{
  "sourceType": "REQUEST",
  "supplyRequestId": "00000000-0000-4000-8000-000000000001",
  "expectedArrivalAt": "2026-11-20T08:30:00+07:00",
  "vehiclePlate": "51C-12345",
  "note": "Giao theo yêu cầu đã tiếp nhận"
}
```

Không nhận schoolId/supplierId/items/quantity override. Repository đọc toàn bộ dòng nguồn; service kiểm tra nguồn đúng supplier, đã tiếp nhận/còn được thực hiện và chưa có bất kỳ Delivery cho nguồn. Copy đúng toàn bộ lượng/unit/note; source ACCEPTED -> IN_PROGRESS nguyên tử, IN_PROGRESS giữ nguyên. Nội dung sai/ngoài scope/đã có phiếu không được sinh phiếu mới.

### STANDALONE

```json
{
  "sourceType": "STANDALONE",
  "schoolId": "00000000-0000-4000-8000-000000000002",
  "items": [
    {
      "ingredientId": "00000000-0000-4000-8000-000000000003",
      "quantity": "12.125",
      "unit": "kg",
      "note": "Giao chủ động"
    }
  ],
  "expectedArrivalAt": null,
  "vehiclePlate": null,
  "note": null
}
```

schoolId bắt buộc nhưng chỉ là target; kiểm tra lại quan hệ ACTIVE và trạng thái đối tác trong transaction. Không nhận supplyRequestId/supplyRequestItemId/previousDeliveryId/supplierId. Không cần lịch sử từ chối. Nguyên liệu ACTIVE thuộc supplier hiện tại, unit bằng defaultUnit; không tự tạo entry trường. Thao tác tạo hợp lệ khi chưa có entry, trước receipt phải có entry theo data-model.

### Validation chung

- UUID theo schema chung, lowercase; body strictObject trong từng nhánh, gom lỗi safeParse.
- items chỉ STANDALONE: 1..100 dòng, ingredientId không trùng. quantity chỉ chuỗi số thập phân dương, tối đa 11 chữ số phần nguyên và 3 chữ số phần lẻ, không exponent/NaN/Infinity; dùng Decimal, không Number. Canonicalize để hash không phân biệt 12.0/12.000.
- unit trim 1..30 ký tự. note trim, tối đa 2000, omitted/null/empty -> null. vehiclePlate trim tối đa40, omitted/null/empty -> null. expectedArrivalAt omitted/null -> null, nếu có phải ISO8601 có timezone; không thêm luật bắt buộc tương lai chưa được yêu cầu.
- REQUEST không nhận items ngay cả khi trùng dữ liệu nguồn. Nguồn không có dòng ->409, không tạo phiếu rỗng.

### Kết quả tạo/chi tiết

`data` có id, deliveryNo, sourceType (REQUEST/STANDALONE), supplierId, schoolId, schoolName, supplyRequestId|null, requestNo|null, status, createdByUserId|null, expectedArrivalAt|null, vehiclePlate|null, note|null, createdAt, updatedAt, items.

Mỗi item có id, ingredientId, ingredientName, ingredientEntryId|null, supplyRequestItemId|null, quantity (chuỗi Decimal), unit, note|null. quantity map từ actualQuantity persistence; ngày giờ ISO UTC, null hiện diện tường minh. Không trả email/phone/password/contractSnapshot. Chi tiết lịch sử có thể có createdByUserId null, không tự điền người tạo.

Idempotency scoped supplier+actor+key; reload current auth trước replay. Cùng canonical payload trả cùng record không đổi updatedAt. Cùng key khác payload ->409. Key mới tạo standalone mới có thể cùng nội dung; REQUEST vẫn409 nếu nguồn đã có phiếu. Lỗi sau header/item/source update rollback toàn bộ.

## GET `/api/deliveries/management`

Query strict: page mặc định1; limit20/tối đa100; sourceType optional REQUEST/STANDALONE; status optional enum DeliveryStatus hiện hành. Số nguyên dương, offset <=2147483647. Không nhận schoolId/supplierId/sort/search hoặc filters ngoài hợp đồng.

Response data `{items: Summary[], pagination:{page,limit,hasNext}}`. Summary gồm các field header của detail, không items; createdAt desc rồi id asc, limit+1. Lịch sử creationMode null có nguồn hiển thị sourceType REQUEST. Scope SUPPLIER luôn áp dụng độc lập filters; rỗng hoặc trang vượt -> items[], hasNext false. Không thêm total count.

## GET `/api/deliveries/management/:id`

Params UUID, query rỗng. Cùng DTO chi tiết creation. Không tồn tại/ngoài supplier ->404. Bản ghi legacy được map canonical fields, nguồn giữ nguyên.

## GET `/api/deliveries/management/options/schools`

Quyền manage, đúng role SUPPLIER. Query page/limit như trên; không nhận supplierId override. Trả `{items:[{id,name}],pagination}`; School đủ điều kiện cung ứng mới, quan hệ ACTIVE thuộc supplier hiện tại, tránh trùng school nếu có lịch sử quan hệ; thứ tự id asc. Không có trường -> items[]; POST vẫn recheck, không coi options là ủy quyền ghi.

## GET `/api/deliveries/management/options/ingredients`

Quyền manage, đúng role; query page/limit. Chỉ Ingredient ACTIVE của supplier hiện tại; `{items:[{id,name,defaultUnit}],pagination}`. Không dùng endpoint ingredient management chỉ dành admin để staff phải được quyền ngoài phạm vi. Các option list cũng dùng trusted scope tại resource-access (helper operation-specific nếu cần), không coi scope chỉ là role.

## Tương thích API hiện có

- GET `/api/deliveries` giữ envelope, field cũ và permission/scope hiện hành; supplyRequestId nullable cho standalone, requestNo/orderNo/requestedDeliveryDate/requestedQuantity null khi không có nguồn; field school/ingredient lấy chuẩn trực tiếp. Bản ghi có nguồn không đổi giá trị. Dời Prisma args khỏi service khi chạm sửa.
- GET/POST inspection hiện có giữ bốn role/quyền và quyết định bất biến. Bổ sung schoolId/sourceType, supplyRequestId/requestNo nullable. Với standalone, redeliveryRequiredCount/redeliveryLimit/cancellationNotice là null vì không có nhóm yêu cầu; không giả zero bằng một nhóm nguồn giả. Có nguồn giữ số liệu/cancellation notice như cũ.
- Receipt standalone vẫn yêu cầu đủ bốn approval, trạng thái/lots hợp lệ, mapping IngredientEntry đúng trường/nguyên liệu và receipt đúng một lần; thiếu mapping trả409 trước ghi nhận. Không mở route nhập lô hoặc đổi trạng thái ARRIVED trong feature này.
- Source-based reject count/cancel/budget unchanged. Standalone reject chỉ REJECTED phiếu hiện tại, không sửa bất kỳ SupplyRequest/Delivery khác không liên quan.

## Lỗi

| HTTP    | Trường hợp                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| 400     | Body/query/header/UUID/Decimal sai hoặc trường lạ                                                                   |
| 401/403 | Auth hiện hành, role/org/membership/quyền sai                                                                       |
| 404     | Nguồn/phiếu ngoài scope hoặc không tồn tại; trường/ingredient không có trong tập được phép                          |
| 409     | Nguồn chưa đủ trạng thái/đã có phiếu; quan hệ/pause thay đổi; idempotency key khác nội dung; thiếu mapping nhận kho |
| 429/503 | Limiter và dependency/database theo handler hiện hành, không lộ SQL/URL/secret                                      |
