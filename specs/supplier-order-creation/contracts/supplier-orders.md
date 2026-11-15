# HTTP Contract: Đơn giao hàng có nguồn cung / QR

**Revision**: 2026-11-15. Thay contract baseline cho create; routes GET cũ giữ envelope và raw status. Mọi route mô tả ở đây là thiết kế mục tiêu, không khẳng định đã implement.

## Quyền và phạm vi

- Supplier admin/staff ACTIVE, membership hợp lệ; POST/options/labels cần `delivery.manage`; management GET list/detail giữ `delivery.view` hoặc `delivery.manage` hoặc `delivery.receive`.
- SupplierId lấy AuthPrincipal, không nhận override. Mọi list (kể cả options/labels) dùng trusted scope qua resource-access; repositories áp WHERE supplierId và target ownership.
- Arrival và inspection: đúng SCHOOL của Delivery, một trong bốn role `SCHOOL_NUTRITION_OFFICER`, `SCHOOL_KITCHEN_STAFF`, `INGREDIENT_MANAGEMENT_DEPARTMENT`, `PARENTS_COMMITTEE`, có `delivery.view` và `delivery.inspect`.
- Chỉ public point lookup bằng QR token được không đăng nhập; không thay quyền `GET /api/traceability-anchors` hiện có.

## POST `/api/deliveries/management`

Query rỗng. `Authorization: Bearer ...`, `Content-Type: application/json`, `Idempotency-Key: <UUID>` bắt buộc. Body strict theo sourceType.

### REQUEST

```json
{
  "sourceType": "REQUEST",
  "supplyRequestId": "61000000-0000-4000-8000-202611080001",
  "sources": [
    {
      "supplyRequestItemId": "61100000-0000-4000-8000-202611080001",
      "sourceFacilityId": "11111111-1111-4111-8111-111111111111"
    }
  ],
  "vehiclePlate": "29C-123.45",
  "expectedArrivalAt": "2026-11-20T08:30:00+07:00",
  "note": "Giao toàn bộ theo yêu cầu"
}
```

sources không rỗng, không trùng supplyRequestItemId, phải đúng và đủ tập dòng trong nguồn; ví dụ trên chỉ hợp lệ với yêu cầu một dòng. Không nhận items, schoolId, supplierId hoặc override lượng/đơn vị/nguyên liệu. Nguồn ACCEPTED/IN_PROGRESS thuộc supplier và chưa có bất kỳ Delivery; thiếu/thừa/sai dòng nguồn409, không tiết lộ nguồn ngoài scope. Mỗi cơ sở ACTIVE và thuộc supplier; source ngoài scope404 như không tồn tại, source đã dừng409. Copy toàn bộ lượng/đơn vị/note nguồn; chỉ bổ sung facility.

### STANDALONE

```json
{
  "sourceType": "STANDALONE",
  "schoolId": "10000000-0000-4000-8000-000000000001",
  "vehiclePlate": "29C-123.45",
  "expectedArrivalAt": "2026-11-20T08:30:00+07:00",
  "note": "Giao chủ động hoặc giao lại bằng đơn thủ công",
  "items": [
    {
      "ingredientId": "00000057-0000-4000-8000-000000000001",
      "sourceFacilityId": "11111111-1111-4111-8111-111111111111",
      "actualQuantity": "12.500",
      "unit": "kg"
    }
  ]
}
```

Items 1..100, không trùng ingredientId; strict item không nhận note riêng/QR/snapshot/sourceRequestItem. actualQuantity là chuỗi dương tối đa11 chữ số nguyên và3 chữ số thập phân, không exponent/NaN/Infinity, chuẩn hóa trước hash. Unit trim1..30, bằng defaultUnit; nguyên liệu ACTIVE thuộc supplier. Facility như REQUEST. School phải thuộc tập linked ACTIVE và đủ điều kiện mới; sourceRequest/previousDelivery không bắt buộc và không được gửi. Thiếu school entry không chặn create; final receipt vẫn yêu cầu entry ACTIVE.

### Chung, kết quả và retry

Plate bắt buộc string trim1..40, ETA bắt buộc ISO8601 với timezone/offset hợp lệ, lưu UTC; không tự thêm điều kiện ngày phải tương lai. Note optional/null/empty ->null, trim tối đa2000. UUID lowercase như shared validator. Không nhận deliveryNo/status/actor/snapshot/token/version từ client. Lỗi input gom field paths, không phản chiếu giá trị nhạy cảm.

Thành công lần đầu201, replay cùng key/canonical body200, cùng Delivery và cùng timestamps/mã/token/URL; khác body với cùng key409. Key scoped supplier+actor. REQUEST key mới sau khi nguồn có phiếu vẫn409. Reorder selections/items không tạo hash khác; đổi facility/metadata phải409 với cùng key. Old payload thiếu dữ liệu mới400; không nâng cấp record cũ bằng replay.

`data` là Detail: các field header hiện hành, thêm traceabilityVersion, statusLabel, items. Đơn v1 raw `status: IN_TRANSIT`, mã `FP-DE-00001` tăng riêng supplier; source có thì request chuyển IN_PROGRESS trong cùng commit. Không trả creationKey/fingerprint. Mỗi item: id, ingredientId, ingredientName (snapshot v1), ingredientEntryId|null, supplyRequestItemId|null, actualQuantity (chuỗi), unit, note|null; thêm sourceFacility `{id,name,facilityCode|null}` hoặc null legacy, traceUrl hoặc null legacy. Không trả raw token riêng/lot token trong management DTO. Tạo xong N dòng có N QR ổn định và N lô dự kiến BLOCKED, available0, không receipt; PNG có thể lấy qua labels. Lỗi render trong lần tạo trước commit không lưu đơn thiếu QR.

## GET management list/detail

Giữ `GET /api/deliveries/management` query strict page1/limit20 tối đa100, sourceType và raw status tùy chọn; không nhận supplier/school/search tùy ý. Summary không chứa items/PNG/token; thêm statusLabel và traceabilityVersion. Thứ tự createdAt desc/id asc, limit+1, pagination `{page,limit,hasNext}`.

`GET /api/deliveries/management/:id` query rỗng, UUID + supplier scope; Detail như trên. Các mã FP-DE trùng giữa suppliers vẫn lấy đúng record bằng UUID và principal. Legacy có metadata/nguồn/QR null không bị coi là dữ liệu mới sai. Không thêm lookup đơn bằng deliveryNo đơn lẻ.

## GET options

Các route query strict page/limit, cùng pagination; thứ tự id asc:

| Route dưới `/api/deliveries/management` | data.items                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/options/schools`                      | `{id,code,name}` thuộc linked ACTIVE và điều kiện cung ứng mới như hiện hành.             |
| `/options/ingredients`                  | `{id,name,defaultUnit,categoryId,categoryName}` ACTIVE đúng supplier.                     |
| `/options/source-facilities` (mới)      | `{id,facilityCode,name}` ACTIVE đúng supplier; facilityCode có thể null với cơ sở legacy. |

Options không trao quyền thêm/sửa/dừng source; staff đủ manage được chọn source. Không lọc theo isVisible để mất nguồn thuộc sở hữu, không công khai list options. Tạo rechecks mọi target dù options đã trả hợp lệ.

## GET `/api/deliveries/management/:id/labels`

Protected `delivery.manage`, query page1/limit20 tối đa100. Kiểm target UUID/ownership trước pagination; v1 trả `{items,pagination}` theo item.id asc. Mỗi label: deliveryItemId, deliveryNo, supplierName, ingredientNameSnapshot hiển thị dưới ingredientName, actualQuantity (chuỗi), unit, sourceFacility `{name,facilityCode|null}`, traceUrl và qrImageDataUrl (`data:image/png;base64,...`). Không thêm contacts/account data/lot token. N dòng lấy đủ các trang có đúng N label; reprint cùng URL/QR, không ghi DB. Source code null vẫn có tên nguồn để in. Legacy chưa có traceabilityVersion1 trả409 “Đơn lịch sử chưa có nhãn QR theo dòng”. Target ngoài supplier404. Render lỗi503, không thay đổi database.

## POST `/api/deliveries/:id/arrival`

Mới, thuộc module delivery, đúng bốn role của trường + quyền view/inspect, JSON strict `{}`, query rỗng. Supplier và public không được gọi thay trường. Không nhận arrivedAt/status/lots/quantity từ client.

Khóa/recheck nguồn nếu có và Delivery đúng trường. V1 IN_TRANSIT -> ARRIVED, ghi server arrivedAt,200 trả inspection detail với statusLabel. Không nhập kho hoặc tạo approval. Nguồn CANCELLED/đơn đã hủy409; legacy CREATED không tự nâng cấp sang luồng mới. Nếu arrival đã ghi và trạng thái ARRIVED/PENDING_APPROVAL/RECEIVED/REJECTED, gửi lại200 đúng kết quả hiện tại và arrivedAt cũ, không downgrade; chưa arrival mà status khác IN_TRANSIT409. Ngoài scope/not found404. Role/phân quyền không hợp lệ403.

Mọi lần gọi arrival, kể cả replay, đều yêu cầu parent traceabilityVersion1 trước xét trạng thái; record legacy có IN_TRANSIT hoặc arrivedAt cũ cũng không được vào nhánh replay của route mới (409).

## Inspection hiện hành

Giữ GET/POST `/api/deliveries/:id/inspection` và GET `/api/deliveries/inspections`, quyền/ảnh/decision/reason như baseline. Bổ sung source v1 vào chi tiết kiểm tra và statusLabel nhất quán; không công khai các DTO này. Kiểm khi ARRIVED/PENDING_APPROVAL, một bất biến decision mỗi role; APPROVE1..3 giữ PENDING_APPROVAL, đủ4 + receipt hợp lệ chuyển RECEIVED/“Hoàn thành”. REJECT có reason chuyển REJECTED/“Yêu cầu giao hàng lại”, chặn quyết định mới sau đó.

Receipt rechecks lot.sourceFacilityId bằng nguồn dòng v1 và các điều kiện stock hiện hữu. Lỗi missing school entry, lệch lượng/nguồn, lot history hoặc ngày không hợp lệ409 và rollback quyết định cuối/receipt. Cơ sở dừng sau tạo không làm sai lịch sử. Không thêm step APPROVED/COMPLETED enum hoặc đổi raw status cũ. Giữ cap3 nguồn; standalone counters/limit/cancellationNotice null, không nhóm mọi nguồn null hoặc tự nối đơn thủ công vào chuỗi cũ.

## Lỗi và hợp đồng liên quan

400 input;401 chưa đăng nhập;403 sai role/quyền;404 target ngoài scope/không có;409 state/mapping/fingerprint/nguồn conflict;429 rate limit;503 dependency. Giữ `sendSuccess`/`sendError` envelope. Ngoại lệ HTML công khai được quy định riêng trong [public-trace.md](public-trace.md). Các input/fields mới là thay đổi hợp đồng có chủ ý của amendment; phải cập nhật client và tài liệu authorization trước release.
