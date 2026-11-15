# HTTP Contract: Đơn giao theo bước xác nhận, chuẩn bị và vận chuyển

**Revision**: 2026-11-15 — workflow2, multi-source allocations và linked-school search | **Spec**: [spec.md](../spec.md) | **Model**: [data-model.md](../data-model.md)

Contract mục tiêu, chưa implement. Thay contract tạo thẳng IN_TRANSIT. Giữ shared success/error envelopes; controller dùng sendSuccess/sendError, validation strict và thông báo tiếng Việt có đường dẫn từng trường, không phản chiếu giá trị nhạy cảm.

## 1. Quyền và phạm vi

| Thao tác                                                         | Quyền và actor                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET supply-requests supplier                                     | `supply_request.view`, đúng hai role supplier hiện hành; không xem DRAFT hoặc supplier khác.     |
| POST supply-requests accept                                      | `supply_request.accept`; không tự cấp quyền manage hoặc view.                                    |
| POST management hoàn tất nguyên liệu, POST dispatch, GET options | `delivery.manage`, SUPPLIER với `INGREDIENT_SUPPLIER_ADMIN` hoặc `INGREDIENT_SUPPLIER_STAFF`.    |
| GET management list/detail/labels                                | `delivery.view` hoặc `delivery.manage` hoặc `delivery.receive`, hai role supplier hiện hành.     |
| Arrival/inspection                                               | Đúng trường của Delivery; một trong bốn role hiện hành và đủ `delivery.view`/`delivery.inspect`. |

Quyền labels OR trong bảng là mục tiêu theo ma trận đã duyệt; source hiện tại còn gọi managementScope, cần đồng bộ chứ không coi là hành vi đã triển khai.

Mọi protected operation cần tài khoản ACTIVE, membership/role/quyền hiện hành. SupplierId luôn từ principal; schoolId ở STANDALONE chỉ là bên nhận phải kiểm quan hệ, không phải phạm vi truy cập. Target UUID kết hợp supplierId/schoolId trong repository. List dùng resource-access và filter tổ chức tường minh. Ngoài scope và không tồn tại cùng404. Không bypass SYSTEM, không cache quyền hoặc cấp quyền/seed ngầm.

## 2. Tiếp nhận REQUEST và luồng thủ công

POST `/api/supply-requests/:id/accept` giữ params/query/body và receipt bốn trường `{id,status,acceptedByUserId,acceptedAt}`. Lần tiếp nhận mới SENT → ACCEPTED, nhãn nghiệp vụ Đã xác nhận; không tạo Delivery hoặc đòi plate/ETA. Replay ở ACCEPTED/IN_PROGRESS giữ thông tin đầu tiên và trạng thái nguồn, không đưa Delivery hiện hữu lùi bước. Client đủ quyền view đọc lại detail để lấy tiến độ; client chỉ có accept không tự được quyền đọc detail hoặc tạo Delivery.

GET `/api/supply-requests` và `/:id` nhánh SUPPLIER giữ raw status, paging/filter và mọi trường hiện có; thêm `orderProgress` nullable. Nhánh SCHOOL/SYSTEM không đổi response/filter.

```json
{
  "stage": "CONFIRMED",
  "statusLabel": "Đã xác nhận",
  "deliveryId": null,
  "nextAction": "ADD_INGREDIENTS"
}
```

Quy tắc projection:

- ACCEPTED hoặc IN_PROGRESS không có bất kỳ Delivery → CONFIRMED, deliveryId null; không đổi raw status hoặc dựng thêm lịch sử tiếp nhận.
- Có đúng một Delivery creationMode=REQUEST → stage/statusLabel từ Delivery thực tế và deliveryId của nó. Legacy có nhiều đợt mà không có REQUEST duy nhất → null; không chọn bừa đợt cuối.
- SENT/COMPLETED/CANCELLED không có Delivery → null. Nguồn CANCELLED/COMPLETED không cho hành động ghi mới dù delivery cũ đang ở giai đoạn trước.
- NextAction ADD_INGREDIENTS khi nguồn còn được thực hiện, chưa có delivery và actor có delivery.manage; ENTER_SHIPPING khi workflow2/PREPARING và actor có manage; TRACK_DELIVERY khi IN_TRANSIT và có quyền đọc management; VIEW_DELIVERY cho trạng thái khác có quyền đọc; còn lại NONE. Các hạn chế tạm dừng/quyền có thể đổi trước khi ghi nên server vẫn kiểm lại lúc thao tác, nextAction không phải token ủy quyền.

Đơn thủ công: tìm/chọn trường linked qua GET options/schools rồi nhập nguyên liệu trực tiếp. Không có CONFIRMED/Đã xác nhận trong context/progress/status và không yêu cầu xác nhận với trường trước lập đơn. Chưa lưu đủ nguyên liệu thì chưa có Delivery/ID/mã/QR/mục management; POST hợp lệ đầu tiên tạo PREPARING. Không thêm endpoint ghi draft hoặc tự tạo yêu cầu trường; vẫn recheck trường khi ghi, không cam kết lưu form dở.

## 3. POST `/api/deliveries/management` — hoàn tất nguyên liệu

Bearer auth, query rỗng, body JSON strict và `Idempotency-Key: <UUID>` bắt buộc. Không nhận thời gian/biển số xe ở thao tác này, kể cả giá trị null. Không nhận status, workflowVersion, traceabilityVersion, mã, người tạo, QR hoặc snapshot từ client.

### REQUEST

```json
{
  "sourceType": "REQUEST",
  "supplyRequestId": "61000000-0000-4000-8000-202611080001",
  "sources": [
    {
      "supplyRequestItemId": "61100000-0000-4000-8000-202611080001",
      "sourceFacilityId": "11111111-1111-4111-8111-111111111111",
      "actualQuantity": "6"
    },
    {
      "supplyRequestItemId": "61100000-0000-4000-8000-202611080001",
      "sourceFacilityId": "22222222-2222-4222-8222-222222222222",
      "actualQuantity": "4"
    }
  ],
  "note": "Giao toàn bộ theo yêu cầu"
}
```

Nguồn ACCEPTED/IN_PROGRESS còn thực hiện được, đúng supplier và chưa có bất kỳ Delivery. sources là các dòng phân bổ, không rỗng; mỗi row strict đúng supplyRequestItemId/sourceFacilityId/actualQuantity. supplyRequestItemId được lặp khi khác cơ sở. actualQuantity bắt buộc chuỗi Decimal dương tối đa11 chữ số nguyên/3 thập phân, không exponent/NaN/Infinity; chuẩn hóa trước tính hash. Không nhận ingredientId/unit/entry override, items/schoolId/supplierId; ingredient/entry/unit/note kế thừa từ dòng nguồn.

Ví dụ trên phân bổ dòng yêu cầu10 kg thành6 kg A +4 kg B. Service group theo source item, bắt buộc đủ tập dòng yêu cầu và tổng Decimal từng group bằng đúng requestedQuantity; thiếu/ngoài tập hoặc tổng9/11 kg409, không ghi phần nào. Lặp đúng sourceItem+facility400 theo nested field; sau resolve source, lặp ingredient thực tế+facility trong toàn đơn409. Cùng ingredient khác facility hợp lệ, khác ingredient cùng facility cũng hợp lệ. Cơ sở ACTIVE đúng supplier kiểm lúc lưu; foreign/not-found404, dừng409. Không dùng Map một-facility-per-source-item, không chia thành nhiều đơn hoặc tự đặt trần100 mới cho REQUEST; giữ HTTP body limit hiện hành.

### STANDALONE

```json
{
  "sourceType": "STANDALONE",
  "schoolId": "10000000-0000-4000-8000-000000000001",
  "note": "Giao chủ động hoặc giao lại bằng đơn thủ công",
  "items": [
    {
      "ingredientId": "00000057-0000-4000-8000-000000000001",
      "sourceFacilityId": "11111111-1111-4111-8111-111111111111",
      "actualQuantity": "6",
      "unit": "kg"
    },
    {
      "ingredientId": "00000057-0000-4000-8000-000000000001",
      "sourceFacilityId": "22222222-2222-4222-8222-222222222222",
      "actualQuantity": "4",
      "unit": "kg"
    }
  ]
}
```

Trường thuộc linked ACTIVE và đủ điều kiện cung ứng mới hiện hành; recheck khi ghi dù đã chọn trước đó. Items1..100 tính theo số dòng, ingredientId được lặp nhưng cặp ingredientId+sourceFacilityId không trùng; mỗi item strict không nhận note riêng/requestItem/QR. Nguyên liệu ACTIVE đúng supplier; unit trim1..30 bằng defaultUnit; actualQuantity là chuỗi dương tối đa11 chữ số nguyên và3 chữ số thập phân, không exponent/NaN/Infinity và canonical trước hash. Cơ sở như REQUEST. Mỗi dòng lượng/nguồn riêng và không tự gộp thành một dòng; cùng cơ sở được dùng cho nguyên liệu khác. Chưa có school IngredientEntry không chặn tạo, final receipt vẫn cần entry ACTIVE; không tự tạo entry/yêu cầu trường/quan hệ cũ.

### Kết quả và atomicity

Note optional/null/empty → null, trim tối đa2000. UUID normalize lowercase như shared validator. Thành công đầu201; data là SupplierOrderDetail. Cờ `created` chỉ dùng nội bộ service để controller chọn201/200, không trả trong HTTP data. Có:

- raw status PREPARING, statusLabel Đang chuẩn bị hàng, workflowVersion2, traceabilityVersion1, nextAction ENTER_SHIPPING nếu actor vẫn đủ quyền và nguồn còn thực hiện được.
- expectedArrivalAt/vehiclePlate null; không có arrivedAt/receivedAt mới.
- UUID, mã FP-DE tăng riêng supplier, người/thời điểm tạo, trường nhận và liên kết nguồn nếu REQUEST.
- Đủ N dòng allocation có UUID/số lượng/nguồn/snapshots/traceUrl riêng và N lô PLAN-01 BLOCKED/available0. N là số dòng phân bổ, không phải số ingredient hoặc source item phân biệt; các dòng có thể trùng ingredientId và supplyRequestItemId nhưng khác sourceFacility. Không inventory receipt. Lấy nhãn được ngay sau bước nguyên liệu.

Header/items/nguồn/QR/lô/source IN_PROGRESS cùng transaction. Lỗi bất kỳ không chuyển bước hoặc lưu một phần; yêu cầu đã tiếp nhận vẫn giữ kết quả tiếp nhận. STANDALONE lỗi không tạo bản ghi đơn thiếu dòng. Không sửa nội dung hoặc nguồn đã lưu bằng cách gửi POST lại.

### Replay CREATE

Cùng supplier+actor+key và canonical v3 body →200 với current detail; không ép current status về PREPARING nếu đã dispatch hoặc tiến xa. Key khác body409; REQUEST key mới khi đã có delivery409. Canonical v3 sort REQUEST theo requestItemId+facilityId, STANDALONE theo ingredientId+facilityId, gồm quantity đã canonical và note/unit tương ứng; chuẩn hóa trước gắn QR candidates. Reorder6+4 cùng body, đổi5+5 hoặc đổi nguồn khác body dù tổng giữ10. Không giữ thuật toán sort chỉ theo ingredient/source item của thiết kế trước. Key cũ workflow null409, không nâng cấp. Payload cũ chứa ETA/plate400; REQUEST thiếu actualQuantity từng allocation400, không tự điền toàn bộ lượng nguồn. Không giữ writer tạo thẳng IN_TRANSIT hoặc nâng cấp hash/record v1.

Mọi replay phải đọc lại tài khoản/quyền/scope, không dùng lại claims; không cần nguyên liệu/cơ sở còn ACTIVE hoặc QR renderer/origin hiện có để trả record đã commit. Kiểm key/replay trước khi render candidate QR hoặc cấp mã. Không trả creationKey/fingerprint/raw qrToken trong DTO.

## 4. POST `/api/deliveries/management/:id/dispatch`

Bearer auth, UUID params, query rỗng, body strict đúng hai trường:

```json
{
  "expectedArrivalAt": "2026-11-20T08:30:00+07:00",
  "vehiclePlate": "29C-123.45"
}
```

ETA bắt buộc ISO8601 có timezone/offset và thời điểm hữu hạn, normalize UTC. Plate bắt buộc string trim1..40. Không ép tương lai hoặc regex biển số quốc gia. Từ chối null/thiếu/trường lạ, note/items/sources/status;400 gom mọi issue theo field path. Không cần Idempotency-Key mới vì dispatch chỉ ghi một lần trên UUID Delivery.

### Lần dispatch đầu

1. Xác minh supplier scope và actor có manage; khóa/reload theo data model trong một transaction. Không tìm thấy/foreign404; actor không đủ quyền403.
2. Yêu cầu workflowVersion2, traceabilityVersion1, status PREPARING và metadata cả-null, nguyên liệu/nguồn/QR đã hoàn tất. Legacy/v1 cũ, thiếu bước hoặc trạng thái khác409.
3. Áp policy công việc đã nhận: tài khoản/role/membership/quyền phải hợp lệ, nguồn REQUEST không hủy và còn ACCEPTED/IN_PROGRESS, admin hai bên không DEACTIVATED. Không áp lại intake ACTIVE/relationship ACTIVE/nguyên liệu hoặc cơ sở ACTIVE của cung ứng mới. Standalone không cần tạo nguồn giả để kiểm continuation.
4. Ghi cả hai metadata và IN_TRANSIT cùng thao tác conditional update.200 trả current SupplierOrderDetail, statusLabel Đang giao hàng, nextAction TRACK_DELIVERY nếu đủ quyền xem. Không tạo/cấp lại mã, QR, snapshot, lot hoặc receipt; không cần thao tác đổi trạng thái tiếp theo.

### Replay và cạnh tranh

- Sau live auth/scope và khóa target, workflow2 có cả metadata bằng canonical body là bằng chứng dispatch cũ.200 trả trạng thái hiện tại kể cả ARRIVED/PENDING_APPROVAL/RECEIVED/REJECTED/CANCELLED/CANCELLED_MEAL. Không kiểm lại điều kiện dispatch mới hoặc đổi updatedAt/metadata/status; nguồn đã hủy sau dispatch không biến replay thành ghi mới.
- Hai metadata đã lưu khác body →409, kể cả actor khác trong cùng supplier. Không cho sửa xe/ETA bằng dispatch lần hai.
- Đã hủy trước dispatch có metadata null →409; không tự bắt đầu lại. Workflow null →409 dù metadata cũ có vẻ trùng.
- Hai actor cùng body: một lần ghi, bên còn lại200 kết quả đã có. Khác body: một thành công, bên còn lại409. Race cancel/arrival giữ trạng thái cuối hợp lệ; không downgrade.
- Quyền bị thu hồi, tài khoản không ACTIVE hoặc membership đổi trước replay vẫn bị chặn. Live recheck/quyết định và mọi repository write dùng cùng transaction client.

## 5. GET management list/detail/options/labels

List giữ page1/limit20/max100, sourceType/status tùy chọn, thứ tự createdAt desc/id asc, limit+1 và `{page,limit,hasNext}`. Thêm PREPARING vào tập raw status filter; giá trị không được hỗ trợ400. Không nhận supplierId/schoolId tùy ý để mở rộng scope. Summary/detail thêm `workflowVersion: 2 | null` và nextAction; giữ status/statusLabel, sourceType, traceabilityVersion, mã/actor/date fields và null hợp lệ. Không gộp các yêu cầu ACCEPTED chưa có Delivery vào phân trang management.

Detail giữ items gồm id/ingredientId/name/entry nullable/requestItem nullable, actualQuantity chuỗi, unit/note, sourceFacility `{id,name,facilityCode|null}` hoặc null legacy, traceUrl hoặc null legacy. Mỗi allocation là một item UUID riêng; không map/khử trùng response theo ingredientId hoặc supplyRequestItemId. Không raw token, creation metadata hoặc PNG ở list/detail. Null ETA/plate ở workflow2 PREPARING và hủy trước giao là hợp lệ; không gán giá trị giả.

### GET `/api/deliveries/management/options/schools` — tìm trường linked

Mở rộng route hiện có, không tạo route search khác. Query strict chỉ `page`, `limit`, `search`:

```http
GET /api/deliveries/management/options/schools?search=hoa&page=1&limit=20
Authorization: Bearer <supplier-token>
```

- search optional string trim tối đa100 ký tự sau trim; thiếu/rỗng/khoảng trắng→danh sách mặc định. Tìm literal một phần name OR code, không phân biệt hoa/thường; không tự bỏ dấu. Backslash/percent/underscore là ký tự literal được escape tại repository, không là wildcard. Code null vẫn match tên.
- page mặc định1, limit20/tối đa100, số nguyên dương và skip trong giới hạn hiện có; order id asc, limit+1/hasNext. Query array/object/lặp search thành array, quá100, supplierId/schoolId hoặc field lạ400, lỗi tiếng Việt theo path. Không nhận q alias.
- Cần delivery.manage của hai role supplier, trusted supplier từ principal; eligibility school ACTIVE/intake ACTIVE/admin không DEACTIVATED/relationship ACTIVE đúng supplier luôn AND với OR search. Không lấy supplierId tùy chọn, không nới scope khi từ khóa trùng school của supplier khác. Thiếu quyền403, chưa auth401.
  - 200 shared success data `{items:[{id,code,name}],pagination:{page,limit,hasNext}}`; không có match hoặc trang ngoài phạm vi trả items rỗng. Không trả contact/account/relationship internals hoặc bịa code null.
- Tách schema/query DTO/validator riêng cho trường. GET options/ingredients, options/source-facilities và labels tiếp tục strict paging cũ và từ chối search400; không sửa shared options schema để nới chúng.
- Search không ghi dữ liệu/trạng thái, không gán Đã xác nhận cho STANDALONE; kết quả chỉ hỗ trợ chọn trường. POST vẫn recheck linked/eligibility/actor trong cùng transaction nếu quan hệ đổi sau tìm.

### Các lựa chọn và nhãn khác

Options ingredients/source-facilities giữ paging, scope, active filtering và safe fields hiện có. Source facilityCode null/isVisible false không bị loại khỏi lựa chọn thuộc supplier. Không trao quyền quản trị cơ sở cho staff.

GET `/:id/labels` được thiết kế dùng quyền đọc OR như list/detail theo ma trận đã duyệt trong `docs/AUTHORIZATION.md`; runtime scope hiện còn yêu cầu manage nên cần sửa lệch này và kiểm thử hồi quy; page1/limit20/max100, item.id asc. Traceability1 cho lấy nhãn ngay ở PREPARING, không cần dispatch. Giữ label fields/PNG từ stored URL, không ghi DB; legacy traceability null409, foreign404. Reprint không đổi QR. Lỗi render503 không làm mất đơn đã commit hoặc rollback một dispatch đã hoàn tất.

## 6. Arrival, kiểm nhận và QR

POST `/api/deliveries/:id/arrival` và inspections giữ contract trường hiện hành. PREPARING không được arrival hoặc ký kiểm; cả hai trả409 khi không đúng bước. Workflow2 sau dispatch vẫn traceability1 nên đi tiếp IN_TRANSIT → ARRIVED → bốn quyết định → receipt như cũ. Không nới trạng thái được kiểm nhận để nhận sớm. Khi REQUEST có nhiều dòng cùng source item, final receipt phải group current quantities theo source item và cộng previous RECEIVED đúng một lần mỗi group; kiểm previous+currentGroup<=requested cho mọi source delivery. Riêng workflow2 REQUEST tái kiểm đủ toàn bộ source items và currentGroup=requested, ingredient/entry/unit đúng nguồn, không chỉ đọc các current rows để suy coverage. Source items/previous rows do repository đọc theo batch trong cùng tx sau khóa; không query ở service hoặc cộng Number. Legacy partial deliveries không bị ép equality/full coverage của workflow2. Bất kỳ sai tổng/identity/lot/history nào rollback quyết định cuối và stock;4roles cấp Delivery, mỗi lot receipt đúng một lần.

REJECTED vẫn hiển thị Yêu cầu giao hàng lại, không receipt. Standalone giao lại chọn trường/thêm nguyên liệu → PREPARING → dispatch IN_TRANSIT, không qua Đã xác nhận, có mã/QR/quyết định mới, không tự nối chuỗi cũ. Giữ cap3 cho delivery có source; cancelRemainder phải gồm PREPARING và chấp nhận metadata null khi hủy trước giao. Không đụng các đợt RECEIVED hoặc lịch sử kho.

Public QR giữ [public-trace](public-trace.md) và allowlist tám trường, chỉ cập nhật status/statusLabel hiện tại để PREPARING hiển thị đúng; không công khai xe/ETA/workflowVersion/nextAction. Quét QR không chuyển bước hoặc kiểm nhận.

## 7. Lỗi và phối hợp client

400 validation;401 chưa xác thực;403 thiếu quyền/role/membership;404 target ngoài scope/không tồn tại;409 trạng thái/nội dung/quan hệ không hợp lệ hoặc replay conflict;503 hạ tầng hoặc hết retry lock. Giữ envelope/messages tiếng Việt và không lộ SQL/credentials/token.

Client mới dùng các bước riêng và mở lại Detail hiện tại sau kết quả không rõ; khi retry CREATE giữ key/body, retry DISPATCH giữ UUID/body. Không đổi key để thử tránh409. Deploy schema trước app, cập nhật client/writer đồng bộ; không cho payload cũ đi qua nhánh direct transit. Thay đổi UI bố cục hoặc lưu form dở không thuộc contract backend lần này.
