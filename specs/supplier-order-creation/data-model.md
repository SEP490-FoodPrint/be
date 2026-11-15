# Data Model: Nguồn cung và QR của đơn giao

**Date**: 2026-11-15 | Áp dụng cho bản sửa đổi của [spec](spec.md).

## 1. Delivery

Giữ UUID PK, schoolId, supplierId, nguồn nullable, creationMode REQUEST/STANDALONE hoặc null legacy, creationKey/fingerprint và các timestamps hiện hữu.

| Trường                      | Thiết kế hiện hành sau amendment                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deliveryNo                  | Giữ varchar(80), bỏ unique toàn cục, thêm unique `(supplierId,deliveryNo)` tên `uq_deliveries_supplier_no`. Mã cũ nguyên vẹn; v1 sinh FP-DE-00001 theo supplier. |
| traceabilityVersion         | Thêm Int nullable, SQL `traceability_version`; null là baseline, 1 là luồng mới. Không mặc định 1 cho record cũ hoặc writer legacy.                              |
| expectedArrivalAt           | Giữ nullable để đọc legacy; v1 bắt buộc thời điểm có timezone hợp lệ, lưu UTC.                                                                                   |
| vehiclePlate                | Giữ nullable varchar(40); v1 bắt buộc trim 1..40. Không áp regex biển số quốc gia chưa được yêu cầu.                                                             |
| status                      | Giữ DeliveryStatus; service tạo v1 explicit IN_TRANSIT, không đổi default CREATED phục vụ legacy.                                                                |
| arrivedAt                   | Server ghi một lần khi trường xác nhận arrival; không cho client tự nhập.                                                                                        |
| receivedAt/receivedByUserId | Chỉ ghi cùng final receipt thành công như hiện hành.                                                                                                             |

CHECK mới: version chỉ null hoặc1; khi1 phải có creationMode/key/fingerprint/actor, plate không trắng, ETA không null và deliveryNo canonical positive; v1 không dùng CREATED/APPROVED làm trạng thái vận hành. Regex phải chặn zero và dạng padding sai; độ dài mã tối đa80. Không dùng CHECK liên bảng để thay kiểm tra scope hoặc số dòng. Giữ `chk_delivery_creation_mode_source`, fingerprint SHA256, mã không trắng và CHECK receipt hiện hữu.

Giữ nguyên partial unique `uq_deliveries_request_mode` và `uq_deliveries_creation_idempotency`, các index school/status và supplier/created. Một source đã có bất cứ Delivery legacy/new nào vẫn không được tạo thêm REQUEST mới.

## 2. DeliveryItem

Giữ ingredientId bắt buộc, ingredientEntryId nullable, supplyRequestItemId nullable, Decimal(14,3)>0, unit/note; giữ unique `(deliveryId,ingredientId)` và `(deliveryId,supplyRequestItemId)`.

| Trường thêm                | Kiểu / quy tắc                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| sourceFacilityId           | UUID nullable legacy, FK RESTRICT/NO ACTION tới SourceFacility; v1 bắt buộc, cùng supplier và ACTIVE khi tạo.     |
| sourceFacilityNameSnapshot | varchar(255) nullable legacy, v1 nonblank lấy server từ nguồn lúc tạo.                                            |
| sourceFacilityCodeSnapshot | varchar(80) nullable, mã cơ sở tại lúc tạo; null hợp lệ với cơ sở legacy chưa có mã.                              |
| ingredientNameSnapshot     | varchar(255) nullable legacy, v1 lấy server để nhãn không đổi tên khi in lại.                                     |
| qrToken                    | varchar(160) nullable legacy, unique `delivery_items_qr_token_key`; v1 random hex64, không dùng mã đơn/lot token. |
| qrUrl                      | varchar(2048) nullable legacy, URL tuyệt đối từ PUBLIC_TRACE_ORIGIN + public token path; lưu để in lại đúng QR.   |

Index `idx_delivery_items_source_facility`. CHECK nhóm dữ liệu hoặc toàn bộ source/name/ingredientName/token/url null (code cũng null), hoặc đủ bộ với chuỗi không trắng; code có thể null. Token có dạng hex64 khi có, URL không rỗng. Service bảo đảm mọi item của parent v1 có đủ bộ và parent legacy không tự được nâng cấp qua các route mới; không tuyên bố DB CHECK bảo vệ được toàn bộ child collection.

Source snapshots, token, URL và nội dung dòng bất biến qua luồng công khai/nhãn/arrival/inspection. SourceCode không phải định danh toàn hệ thống; public lookup bằng token, protected lookup bằng UUID + trusted scope. Source null/khác chủ lúc tạo bị từ chối; source INACTIVE sau tạo không làm mất nguồn hoặc ngăn receipt hợp lệ.

## 3. IngredientLot và receipt

Không thêm/bỏ cột lot. `IngredientLot.qrToken` hiện hữu vẫn có unique riêng, không dùng làm QR dòng.

Với mỗi item v1 mới, service lập đúng một lô dự kiến: lotCode `PLAN-01`, sourceFacilityId copy từ item, receivedQuantity bằng actualQuantity, unit bằng item, status BLOCKED, availableQuantity0, manufactureDate/expiryDate null. UUID/token lot do server sinh. Đây là lô dự kiến để kiểm nhận lượng giao, chưa xác nhận nhập kho hoặc khai số lô/ngày của nhà sản xuất. Không sinh InventoryTransaction ở create hoặc arrival. Nếu cần phân lô sản xuất và nhập ngày thực tế, đó là mở rộng riêng; không tạo ngày giả.

Receipt cho v1 kiểm mỗi lot có sourceFacilityId bằng item.sourceFacilityId và supplier nguồn đúng đơn; không bắt nguồn ACTIVE lại. Giữ kiểm trường/nguyên liệu/entry, lot BLOCKED/chưa tồn, tổng lượng bằng item, ngày hợp lệ theo ngày VN, budget nguồn và không có history. Final APPROVE + attach school entry nếu standalone + receive lot + RECEIPT + RECEIVED dùng cùng transaction. Bất kỳ lỗi nào rollback cả quyết định cuối và kho.

Giữ legacy lot/source nullable, nhiều lot trên một item, QR lot, receipt-only unique và quan hệ inventoryTransactions dạng list. Không backfill item source từ một lot bất kỳ. Không thay quantity/history của lot cũ.

## 4. Đầu vào và fingerprint

- REQUEST: nguồn ACCEPTED/IN_PROGRESS còn thực hiện được, chưa có Delivery; `sources` là exact set SupplyRequestItem của nguồn, mỗi source item đúng một facility. Không nhận ingredient/quantity/unit/school/supplier override. Không áp trần100 mới cho yêu cầu cũ nhiều dòng; collection bị giới hạn bởi kích thước body HTTP hiện hành, xử lý batch.
- STANDALONE: 1..100 items, nguyên liệu ACTIVE đúng supplier, actualQuantity chuỗi Decimal dương, unit bằng defaultUnit, source hợp lệ; trường đã liên kết ACTIVE và đủ điều kiện intake hiện hành. Không bắt có entry trường lúc create.
- Cả hai: plate/ETA bắt buộc, note optional; trim/normalize như contract. New record traceabilityVersion1.
- Fingerprint canonical v2 thêm version, source selections sort theo sourceItemId; standalone sort ingredientId gồm actualQuantity canonical/unit/sourceFacilityId; metadata ISO UTC/trim/null. Cùng key cùng payload -> cùng record; key khác body ->409. Key baseline không được dùng để nâng record thành v1.

## 5. Dãy mã và locks

Không thêm bảng counter hoặc PostgreSQL function/trigger. Supplier lock bảo vệ MAX canonical +1; numeric SQL guarded trước cast, service format BigInt. Đơn hủy/reject giữ mã, replay không cấp số. Legacy DG-* không ảnh hưởng dãy; mã FP-DE canonical đã có được tính vào MAX, không đánh lại. Ranh giới99999 ->100000 và trần74chữ số phải được kiểm chứng.

Create giữ Serializable `authorizationTransaction` và protocol khóa hiện có: School -> Supplier -> actor User/Role -> pair/relationship nếu standalone -> SupplyRequest nếu REQUEST -> Ingredients theo ID -> SourceFacilities theo ID. Xác minh writer source-facility/relationship dùng cùng parent protocol; source lock chặn đổi trạng thái giữa kiểm và ghi. Đọc replay sau reload quyền/scope và trước ghi/cấp mã; transaction retry dùng cùng candidates QR đã render, không upload/network side effect.

Arrival/inspection: khóa school/actor theo shared helper, SupplyRequest nếu có trước Delivery, rồi item/lot IDs tăng dần khi cần; recheck actor/quyền và target trong cùng tx. Không áp lại ACTIVE relationship/intake của cung ứng mới để chặn công việc đã tạo. Không khóa theo deliveryNo đơn lẻ.

## 6. State machine

| Sự kiện                      | Trạng thái lưu                           | Nhãn nghiệp vụ / tác động                                         |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| Tạo v1 thành công            | IN_TRANSIT                               | Đang giao hàng; BLOCKED lots, chưa có tồn/receipt.                |
| Trường xác nhận arrival      | ARRIVED                                  | Đã đến trường; arrivedAt server một lần, không nhập kho.          |
| Có 1..3 vai trò đạt          | PENDING_APPROVAL                         | Đang kiểm nhận, chưa hoàn thành.                                  |
| Đủ4 đạt + receipt hợp lệ     | RECEIVED                                 | Hoàn thành, đúng một receipt/lot.                                 |
| Bất kỳ role hợp lệ không đạt | REJECTED                                 | Yêu cầu giao hàng lại; quyết định/lý do bất biến, không nhận kho. |
| Cap3 cùng nguồn              | CANCELLED cho yêu cầu và các đợt còn chờ | Hủy nguồn và các đợt chưa nhận; không đảo RECEIVED.               |
| Đơn thủ công mới             | IN_TRANSIT                               | Mã/QR/quyết định mới; source null, không đổi chuỗi cũ.            |

Raw status giữ tương thích. statusLabel mới dùng chung cho supplier/inspection/QR; CREATED/APPROVED của legacy không bị đổi hoặc coi là RECEIVED. Arrival chỉ chuyển IN_TRANSIT có traceabilityVersion1; replay khi arrivedAt đã có và trạng thái tiến triển trả cùng kết quả, không downgrade; terminal bị hủy/nguồn hủy không cho lần arrival mới. Không tự chuyển SupplyRequest COMPLETED ngoài chính sách hiện có.

## 7. Migration và rollout

1. Viết một migration mới theo history hiện có, không chỉnh migration supplier_order_creation đã applied.
2. Thêm nullable fields, FK/index/CHECK; preflight không sửa dữ liệu khi cấu trúc lịch sử không như dự kiến.
3. Tạo composite unique trước khi bỏ `deliveries_delivery_no_key`; schema Prisma dùng đúng tên map. Không có FK handwritten trỏ vào delivery_no trong source đã rà soát; migration vẫn kiểm catalog/dependency trên disposable trước rollout.
4. Không cập nhật code/status/timestamp/mode/snapshot/token/version của dữ liệu cũ; giữ mọi source/item/lot/approval/history và predicates cũ.
5. Deploy schema trước rồi app mới, ngừng writer app cũ khi mở v1. Config PUBLIC_TRACE_ORIGIN hợp lệ trước tạo nhãn; duy trì origin đã in. Payload cũ thiếu nguồn/plate/ETA trở thành400 ở POST mới, nhưng legacy GET còn đọc được với nguồn/QR null và labels unavailable.
6. Không tự downgrade global unique sau khi có mã trùng giữa suppliers. Rollback app cần reviewed compatibility plan, không reset/renumber để phục hồi unique.

Bước plan không tạo/applied SQL hoặc cập nhật database. Tất cả kiểm thử mutation sau này cần disposable local được chỉ định và ủy quyền riêng.
