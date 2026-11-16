# Data Model: Đơn giao theo bước và nhiều nguồn nguyên liệu

**Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)35 FR/14 SC | **Research**: [research.md](research.md)

Thiết kế mục tiêu sau clarification; chưa thay schema/database. Giữ mô hình Delivery/DeliveryItem/SupplyRequestItem/Lot, không thêm business entity hoặc bảng allocation.

## 1. Hai cách tạo và bước xác nhận

REQUEST: SupplyRequest.SENT → ACCEPTED khi tiếp nhận, giữ người/thời điểm đầu tiên; ACCEPTED/IN_PROGRESS chưa có Delivery có projection CONFIRMED. Chưa lưu Delivery rỗng. Hoàn tất nguyên liệu/allocations tạo Delivery PREPARING và chuyển ACCEPTED → IN_PROGRESS cùng transaction; không đổi raw IN_PROGRESS về ACCEPTED.

STANDALONE: tìm/chọn trường linked → nhập nguyên liệu; không có CONFIRMED/Đã xác nhận ở form context, projection hoặc trạng thái. Chưa lưu nguyên liệu thì chưa có Delivery/ID/mã/QR. Lưu đủ nguyên liệu lần đầu tạo PREPARING, sau đó dispatch mới IN_TRANSIT. Không cần trường xác nhận trước lập đơn, không tạo SupplyRequest giả hoặc lưu draft. Bốn bên kiểm nhận sau arrival vẫn bắt buộc.

## 2. Delivery header và CHECK

| Thành phần                      | Thiết kế                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DeliveryStatus                  | Thêm PREPARING, giữ enum/default CREATED legacy; CONFIRMED không là trạng thái Delivery, APPROVED giữ nghĩa kiểm nhận cũ. |
| workflowVersion                 | Int? mapped workflow_version: null lịch sử,2 writer từng bước mới; không default/backfill.                                |
| traceabilityVersion             | Giữ1 cho workflow2 và v1 cũ, null legacy; không đổi format QR.                                                            |
| expectedArrivalAt/vehiclePlate  | PREPARING cả-null; dispatch ghi thời gian offset→UTC và plate trim1..40. Không thêm future-date rule/regex quốc gia.      |
| creationKey/creationFingerprint | Giữ unique supplier+actor+key; canonical v3 gồm từng allocation theo phần5, không gồm metadata giao.                      |
| deliveryNo                      | UUID là PK; mã FP-DE riêng supplier cấp một lần ở hoàn tất nguyên liệu, giữ composite unique và dãy hiện có.              |
| timestamps                      | createdAt/updatedAt hiện có; không thêm dispatchedAt, replay không ghi lại thời gian.                                     |

Giữ schoolId bắt buộc, supplierId, creationMode/source nullable của STANDALONE, các FK và unique/partial index của header. CHECK marker chỉ null/2, PREPARING phải workflow2; workflow2 bắt buộc traceabilityVersion IS NOT NULL và bằng1. Nhánh traceability1 vẫn đòi creationMode/key/fingerprint/actor và mã canonical dương. Nhánh workflow null giữ predicate v1 cũ (đủ ETA/plate, không CREATED/APPROVED); legacy traceability null giữ baseline.

| Status workflow2                                      | Metadata giao                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| PREPARING                                             | Cả ETA và plate null.                                                |
| IN_TRANSIT/ARRIVED/PENDING_APPROVAL/RECEIVED/REJECTED | Cả hai đầy đủ, plate trim1..40.                                      |
| CANCELLED/CANCELLED_MEAL                              | Cả-null nếu chưa dispatch hoặc cả-đủ nếu đã dispatch; không một nửa. |

Dùng IS NULL/IS NOT NULL tường minh để SQL NULL không làm CHECK vô tình pass. Không dùng CHECK liên bảng thay actor/scope/child validation. Giữ nguyên tên chk_delivery_traceability_version khi thay định nghĩa bằng migration mới.

## 3. DeliveryItem và phân bổ nguồn

Giữ UUID `id` là định danh dòng, mọi cột/FK/Date/Decimal/snapshot/QR hiện có. Không thêm cột allocation. Mỗi allocation là một DeliveryItem: ingredientId, lượng Decimal14,3 dương, unit, đúng một sourceFacility, source name/code snapshots (code null hợp lệ), ingredientNameSnapshot, qrToken/qrUrl riêng. Source ACTIVE và đúng supplier kiểm lúc lưu nguyên liệu; không reselect ACTIVE sau đó. Sau lưu, nội dung/nguồn/QR bất biến.

REQUEST: nhiều DeliveryItem được cùng supplyRequestItemId; ingredientId/ingredientEntryId/unit/note của từng item lấy từ dòng nguồn, actualQuantity từ allocation đã validate. Toàn bộ source items phải xuất hiện; tổng Decimal từng group bằng requestedQuantity, không cross-group bù lượng. Cùng một nguyên liệu thực tế không được lặp facility trong cùng Delivery, kể cả dữ liệu nguồn bất thường có hai source IDs trỏ cùng ingredient.

STANDALONE: items1..100 tính theo số dòng allocation, không theo số nguyên liệu phân biệt; cùng ingredient được nhiều nguồn khác nhau. Unit bằng defaultUnit, school IngredientEntry ACTIVE sẵn có thì liên kết, chưa có giữ null; không tạo entry giả. REQUEST không tự đặt trần100 mới, vẫn giới hạn body HTTP và xử lý collections theo batch.

### Unique/index mục tiêu

Bỏ hai unique toàn bộ hiện có: delivery_items_delivery_id_ingredient_id_key (index từ migration supplier_order_creation) và delivery_items_delivery_id_supply_request_item_id_key (constraint baseline). Thay bằng:

| Tên index                             | Fields                                   | Predicate                      |
| ------------------------------------- | ---------------------------------------- | ------------------------------ |
| uq_delivery_items_ingredient_source   | deliveryId,ingredientId,sourceFacilityId | source_facility_id IS NOT NULL |
| uq_delivery_items_legacy_ingredient   | deliveryId,ingredientId                  | source_facility_id IS NULL     |
| uq_delivery_items_legacy_request_item | deliveryId,supplyRequestItemId           | source_facility_id IS NULL     |

Prisma dùng @@unique với map/where raw tương ứng qua partialIndexes hiện có; không coi partial key là khóa unique operation, luôn dùng UUID. Hai nhánh source-null giữ độc lập cả hai invariant legacy; source-nonnull cấm trùng cặp nguyên liệu–cơ sở trong một đơn nhưng cho các cơ sở khác. Giữ mọi nonunique source/delivery/ingredient/entry index, FK, QR token unique và nhóm metadata CHECK hiện có. Không tham chiếu parent version trong predicate, không thêm child version.

Tạo cả ba index trước drop các unique cũ, kiểm đúng object/index/constraint names từ migration và catalog trong test upgrade được phép. Không sửa/xóa/gộp item/lot/history; dữ liệu cũ vốn tuân unique mạnh hơn nên vẫn hợp lệ, preflight thất bại phải dừng thay vì dọn dữ liệu.

## 4. IngredientLot và receipt aggregate

Mỗi item mới vẫn một PLAN-01 BLOCKED/availableQuantity0, receivedQuantity bằng actualQuantity, unit/source từ item, ngày SX/HSD null thật. Nhiều PLAN-01 trên các item khác nhau không xung đột vì unique theo deliveryItemId+lotCode. Không InventoryTransaction ở create/dispatch/arrival. Legacy item có nhiều lot và inventoryTransactions dạng list giữ nguyên.

Final receipt trên REQUEST:

1. Giữ source request lock trước Delivery, khóa lot IDs theo thứ tự, đọc lại target và actor trong cùng tx. School inspection header/detail select thêm workflowVersion cho service chọn nhánh, không tự thêm marker vào HTTP inspection/public DTO. Repository operation-specific đọc đủ mọi source item (ID/ingredientEntryId/ingredientId/unit/requestedQuantity) của đúng request/school/supplier; chỉ đọc các current rows không đủ phát hiện thiếu group.
2. Service giữ kiểm nguồn/lượng/ngày/lịch sử/lot BLOCKED hiện hành, source cùng supplier và lot source bằng item.sourceFacilityId đối với traceability1. Riêng workflow2 kiểm current item trỏ đúng source item, ingredient/entry/unit đúng chính xác nguồn; legacy giữ các quan hệ và chuyển đổi đơn vị tương thích hiện hành, không bị ép unit equality mới. Không yêu cầu facility ACTIVE lại sau bước nguyên liệu.
3. Group current rows theo supplyRequestItemId, cộng Decimal sau chuyển đổi theo source unit. Repository batch previous RECEIVED theo tập source item IDs, có scope ownership; service cộng previous đúng một lần mỗi group và kiểm previous+currentGroup<=requested. Không vòng lặp budget riêng từng sibling.
4. Riêng workflow2 REQUEST: tái kiểm đủ tập source, mỗi currentGroup=requested, pair ingredient+facility không trùng, unit đúng như lúc lập đơn. Không áp equality/full coverage này lên legacy/v1 từng nhận từng phần; budget aggregate vẫn áp cho mọi nguồn để không vượt lượng. Equality current không xóa budget previous.
5. Chỉ sau toàn bộ kiểm tra, đủ4vai trò đạt và chưa có receipt/history mới ghi quyết định cuối, AVAILABLE/quantity/RECEIPT/RECEIVED cùng tx. Lỗi bất kỳ rollback cả quyết định cuối và mọi lot write. Mỗi lot đúng một receipt; quyết định bốn vai trò ở cấp Delivery, không nhân theo số dòng phân bổ.

STANDALONE giữ kiểm entry trường ACTIVE ở receipt; nhiều item cùng ingredient có thể cùng entry trường nhưng lots/nguồn riêng. Có thể batch lookup entry theo unique ingredient IDs để tránh lặp query, không gom mất dòng/lot. Không làm thay đổi policy legacy về active source entries ngoài yêu cầu hiện có.

## 5. Validation, canonical fingerprint và replay

REQUEST sources: mỗi `{supplyRequestItemId,sourceFacilityId,actualQuantity}` strict; actualQuantity chuỗi dương tối đa11 chữ số nguyên/3 thập phân, canonical, không float Number. Cho lặp requestItemId nhưng cấm cặp requestItemId+facility lặp ở validation400; service còn kiểm cặp ingredient thực tế+facility409 và tổng/coverage409 theo DB. Không nhận ingredient/unit override.

STANDALONE items: giữ shape có ingredientId/sourceFacilityId/actualQuantity/unit; cấm trùng cặp ingredientId+facility400 thay cho cấm ingredient. Các nguyên liệu khác nhau được dùng chung facility. Missing/null source hoặc quantity không hợp lệ400 theo nested path.

Canonical v3 (chưa implement trong checkout, thay thiết kế v3 cũ trước triển khai): REQUEST sort tuple requestItemId,facilityId và ghi quantity canonical; STANDALONE sort ingredientId,facilityId và ghi quantity/unit canonical; giữ mode/source-or-school/note. Chuẩn hóa/sort trước QR candidate assignment/persistence. Reorder6+4 không đổi hash; đổi5+5 hoặc nguồn thì hash đổi dù tổng bằng nhau. Same key khác body409, same body200 current result; key record workflow null409, không nâng cấp. Mọi replay cần live auth/scope và không render QR/lấy origin lại chỉ để trả kết quả cũ.

DISPATCH giữ UUID+workflow2+cặp metadata bất biến làm bằng chứng thành công, không thêm key/hash/timestamp; canonical ETA UTC/plate trim cùng nhau trả200 trạng thái hiện tại sau đến/nhận/từ chối/hủy, khác body409, hủy trước dispatch/null marker409. Replay không ghi updatedAt hoặc áp lại điều kiện nghiệp vụ first dispatch.

## 6. Progress projection và school search

Supply-order list/detail SUPPLIER thêm orderProgress `{stage,statusLabel,deliveryId,nextAction}` hoặc null; CONFIRMED chỉ cho REQUEST ACCEPTED/IN_PROGRESS chưa bất kỳ Delivery. REQUEST Delivery duy nhất dùng trạng thái thực; legacy nhiều đợt không có REQUEST duy nhất giữ null. Raw source status và accept receipt4trường giữ nguyên, SCHOOL/SYSTEM không đổi.

NextAction: ADD_INGREDIENTS khi nguồn còn thực hiện được/chưa delivery và có manage; ENTER_SHIPPING khi workflow2/PREPARING, nguồn chưa terminal và có manage; TRACK_DELIVERY khi IN_TRANSIT và có quyền đọc, VIEW_DELIVERY/NONE theo quyền/trạng thái. Supplier summary/detail thêm workflowVersion/nextAction, null legacy hợp lệ. STANDALONE không được gán CONFIRMED ở bất kỳ output/context; sau chọn trường chưa có record/state. Public QR không thêm marker/action/IDs/xe/ETA.

School search không thay schema. GET options/schools nhận search riêng: string trim max100, blank→undefined; tìm literal một phần name OR code insensitive. Không unaccent/full-text/index/extension mới. Repository giữ AND eligibility (school ACTIVE/intake ACTIVE/admin không DEACTIVATED/relationship ACTIVE đúng supplier) với OR search; escape backslash/percent/underscore bằng pattern repository hiện có. Code null vẫn match name, không fabricate code. Order id asc, page1/limit20/max100, limit+1, safe `{id,code,name}`. Query không nhận supplierId/schoolId override; POST vẫn recheck target/relationship khi ghi. School-specific schema/DTO để ingredients/source/labels không nhận search.

## 7. Transactions và state machine

CREATE: giữ ReadCommitted/maxWait20s/timeout30s/retry lock tối đa2 lần. Parent school→supplier→actor user→role SHARE, source request nếu REQUEST hoặc pair/relationship/ingredient nếu STANDALONE, rồi facilities theo ID. Verify actor/role/quyền/scope, validate allocations/nguồn dưới lock, ghi mã/header PREPARING+marker2/items/QR/lot/source IN_PROGRESS cùng tx. Không side effects mạng trong callback; candidates dùng lại khi retry, replay đọc trước render/cấp mã.

DISPATCH: scoped hint lookup → parent locks → source request nếu có → Delivery, reload principal/target, recognize replay rồi mới first-dispatch continuation. CAS đúng UUID+supplier+workflow2+PREPARING+cả-null ghi metadata+IN_TRANSIT. Không áp lại intake/relationship/ingredient/source ACTIVE của cung ứng mới, vẫn chặn source terminal/admin DEACTIVATED cho lần đầu. Hủy/arrival/receipt dùng cùng source→Delivery protocol, không khóa theo deliveryNo đơn lẻ. Repository không mở tx độc lập, service không Prisma query args.

| Hành động                  | Trước                                    | Sau                                                                      |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| Tiếp nhận REQUEST          | SENT                                     | SupplyRequest.ACCEPTED, projection CONFIRMED; chưa Delivery.             |
| Chọn trường STANDALONE     | Bắt đầu tạo                              | Nhập nguyên liệu, chưa state/record; không CONFIRMED.                    |
| Lưu nguyên liệu REQUEST    | CONFIRMED hoặc IN_PROGRESS chưa Delivery | Delivery.PREPARING, đủ allocations/tổng/QR/lô, source IN_PROGRESS.       |
| Lưu nguyên liệu STANDALONE | Đã chọn trường, nhập nội dung            | Delivery.PREPARING; không qua CONFIRMED.                                 |
| Dispatch cả hai            | PREPARING                                | IN_TRANSIT, đủ metadata giao.                                            |
| Arrival/kiểm nhận          | IN_TRANSIT→ARRIVED/PENDING_APPROVAL      | REJECTED hoặc RECEIVED chỉ sau điều kiện hiện hành và receipt aggregate. |
| Hủy phần chưa nhận         | Gồm PREPARING                            | CANCELLED; giữ metadata cả-null/cả-đủ và mọi history.                    |

## 8. Migration và rollout

1. Chuẩn bị hai migration mới sau history lớn nhất (hiện20261118000100): `20261118000200_delivery_preparing_status/migration.sql` enum-only; `20261118000300_supplier_order_stages/migration.sql` marker/CHECK và ba partial child uniques thay hai unique cũ. Các file mới này hiện chưa tồn tại, được chốt lại thứ tự nếu history thay đổi trước implement; không sửa SQL đã có.
2. Commit enum migration trước khi migration sau dùng PREPARING; không gộp vào transaction chứa enum chưa commit. Tạo partial indexes trước drop unique cũ, giữ dữ liệu/timestamps/predicates khác. Không viết/applied SQL ở bước plan.
3. Tests fresh Prisma deploy + upgrade baseline/v1, catalog partial predicates, null semantics, duplicate-pair/legacy cardinality, child identity/receipt aggregate, IDs/mã/QR/lot/quyết định/kho nguyên vẹn. Chạy chỉ trên local disposable có chọn/ủy quyền, không introspect hoặc backfill member/Azure.
4. Schema trước app/client; dừng writer cũ tạo thẳng IN_TRANSIT trước mở workflow2/multi-source payload. GET/QR/arrival/inspection v1 cũ tiếp tục hợp lệ; không gắn marker2/downgrade record. REQUEST payload cũ thiếu actualQuantity400; ETA/plate tại create400.
5. Rollback app cũ sau nhiều dòng hoặc PREPARING cần compatibility review, không tự restore unique cũ/xóa dòng/gộp QR/điền xe-ngày giả. `database/SCHEMA_BASELINE.md` ghi artifact/deployment thật khi implement/deploy được phép; plan không cấp phép chạy migration/seed/deploy.
