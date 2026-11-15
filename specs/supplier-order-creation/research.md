# Research: Đơn giao hàng có nguồn cung và QR

**Date**: 2026-11-15 | **Branch**: `feat/supplier-order-creation-traceability`

Bản này thay thế thiết kế baseline về mã DG-UUID, metadata giao tùy chọn và trạng thái CREATED của đơn mới. Chỉ nghiên cứu source/tài liệu; không kết nối database hoặc chạy thử phần mềm.

## R1. Phạm vi và quyền

**Decision**: Giữ module `supplier-order`, hai cách REQUEST/STANDALONE, UUID làm PK. Tạo/options/nhãn cần hai role supplier và `delivery.manage`; management list/detail giữ policy hiện hành `delivery.view` hoặc `delivery.manage` hoặc `delivery.receive`. Options nguồn là operation mới trong module supplier-order, không nới quyền router quản trị source-facility. Public trace là một point lookup riêng được FR-017 cho phép, không mở list hoặc inspection ra công khai.

**Rationale**: `src/modules/supplier-order/*`, `src/utils/resource-access.ts`, `src/modules/source-facility/*` đã phân biệt supplier staff tạo đơn với chỉ admin quản trị cơ sở. `traceability` hiện là danh sách anchor có auth, không phải trang QR.

**Alternatives considered**: Quyền mới/seed, dùng role-only, bỏ auth trên traceability hiện có hoặc dùng router admin để staff chọn nguồn đều sai phạm vi.

## R2. Dãy mã theo nhà cung cấp

**Decision**: Đổi unique toàn cục `deliveryNo` thành unique `(supplierId, deliveryNo)` tên `uq_deliveries_supplier_no`; giữ UUID cho mọi lookup. Repository khóa supplier `FOR UPDATE`, đọc MAX phần số canonical của `FP-DE-…` trong supplier; service cộng BigInt và pad tối thiểu 5 chữ số. Lookup replay trước cấp số. Không thêm bảng counter.

**Rationale**: Source facility đã dùng đúng mẫu supplier lock + MAX guarded numeric trong `source-facility.repository.ts` và `utils/source-facility-code.ts`. Đơn không có chức năng xóa, mã không sửa khi hủy/từ chối nên MAX không giải phóng mã. Không thấy writer dùng deliveryNo làm unique lookup. Regex canonical là `^FP-DE-([0-9]{5}|[1-9][0-9]{5,73})$`, guard trước cast; bỏ zero, mã DG/legacy không tham gia. Tối đa 74 chữ số phù hợp varchar(80); vượt dung lượng báo xung đột, không cắt số. Các writer tạo đơn tương lai cũng phải theo supplier lock.

**Alternatives considered**: Dãy chung hoặc mã UUID trái Q1/FR-015; MAX không khóa gây race; bảng counter riêng chưa cần cho dãy ít trạng thái này. Nếu tương lai có xóa cứng phải đổi thiết kế trước, không tiếp tục dựa MAX.

**Concurrency limit**: `authorizationTransaction` hiện thử tối đa3 lần. Khi nhiều transaction Serializable cạnh tranh, vẫn có thể hết retry và trả503; không suy ra 20 request đồng thời sẽ cùng thành công chỉ từ unique constraint. Bài kiểm chứng phải ghi số thành công/lỗi/retry và dùng lại đúng idempotency key khi thử lại, không đổi retry policy toàn hệ thống chỉ để báo bài test đạt.

## R3. Nguồn dòng và tương thích lịch sử

**Decision**: `Delivery.traceabilityVersion = 1` đánh dấu đơn mới; null là baseline cũ, kể cả creationMode REQUEST/STANDALONE đã có. Dòng mới có FK sourceFacilityId, snapshot tên/mã cơ sở, snapshot tên nguyên liệu, token và URL QR. Không nhận snapshot từ client. Source phải ACTIVE/đúng supplier lúc tạo, khóa các source theo ID; không check ACTIVE hồi tố lúc nhận hàng. Source mã null từ baseline vẫn được chọn, snapshot code null và nhãn dùng tên, không tự cấp mã cơ sở ở feature này.

**Rationale**: SourceFacility.facilityCode hiện nullable; legacy một dòng có nhiều lot/nguồn không thể suy ra một nguồn duy nhất an toàn. Snapshot server giữ truy xuất sau đổi tên/dừng. Các lô mới phải copy đúng source của dòng; final receipt cần bổ sung equality chứ không chỉ kiểm source thuộc supplier như `delivery.service.ts` hiện nay.

**Alternatives considered**: Backfill đoán nguồn/QR hay ép metadata NOT NULL toàn bộ làm sai lịch sử; lấy tên nguồn hiện tại làm mất thông tin lúc giao. Không cần cột source bắt buộc trên danh mục Ingredient: nguồn là lựa chọn của từng đơn.

## R4. QR dòng, nhãn và truy xuất công khai

**Decision**: Mỗi DeliveryItem mới có một token random 32 bytes hex (64 ký tự) và URL tuyệt đối lưu ổn định; khác với `IngredientLot.qrToken` hiện có. Public module `delivery-trace` chỉ đọc theo token dòng, select allowlist. URL trỏ `GET /api/public/delivery-items/:token`; trình duyệt nhận HTML tối thiểu, client gửi Accept application/json nhận envelope DTO cùng dữ liệu. Nhãn qua protected endpoint trả PNG data URL và text labels, không PDF/máy in/Cloudinary.

**Rationale**: Một dòng có thể có nhiều lot nhưng user muốn một QR cho dòng. Lưu URL tránh thay đổi QR khi cấu hình origin đổi; hostname cũ phải được operator duy trì cho nhãn đã in. `PUBLIC_TRACE_ORIGIN` cấu hình rõ, không ghép từ Host header; production HTTPS, local HTTP chỉ localhost. QR không hết hạn như JWT. Trang không có script, HTML escape, CSP chặt, no-store, no-referrer và noindex; JSON chỉ map trường được công khai, không dùng DTO management. Che token trong access log và lỗi.

**Alternatives considered**: Dùng lot token, mã FP-DE hoặc JWT ngắn hạn không đáp ứng định danh dòng/khả năng in lại. Trang JSON đơn thuần bất tiện khi quét bằng camera; xây frontend hoặc dùng dịch vụ QR bên ngoài vượt yêu cầu.

**Primary source**: Chọn `qrcode` 1.5.4 CJS theo [package chính thức](https://github.com/soldair/node-qrcode/blob/master/package.json). [Tài liệu tác giả](https://github.com/soldair/node-qrcode#server-api) hỗ trợ server-side PNG data URL và SVG; thiết kế chọn PNG. Thêm type package tương ứng và lockfile khi implement, chưa cài ở bước plan. Điều này không khẳng định package đã kiểm thử trên runtime repo.

## R5. Toàn vẹn tạo đơn, fingerprint và nhãn

**Decision**: REQUEST thêm `sources:[{supplyRequestItemId,sourceFacilityId}]` với exact set của nguồn, không cho quantity/ingredient override. STANDALONE thêm sourceFacilityId cho mỗi item và tiếp tục actualQuantity chuỗi Decimal. Plate trim 1..40, ETA ISO offset bắt buộc. Fingerprint canonical phiên bản 2 gồm selections đã sort, target/source và toàn bộ metadata chuẩn hóa. Reordering tương đương, đổi source/ETA/plate là khác nội dung.

**Rationale**: Replay phải bảo toàn mã/token/nguồn. Reuse Serializable helper và thứ tự locks; callback retry không phát sinh upload/network side effect. Tạo trước các token/URL/PNG có giới hạn song song ở service sau kiểm quyền ban đầu, rồi dùng candidate cố định trong transaction; lỗi render trước commit không lưu đơn. Transaction rechecks actor/source/ingredients/facilities, lookup replay, cấp mã, ghi header/items/lô dự kiến/request update. Replay render từ token/URL đã lưu, không lấy candidate mới. Rendering lỗi trên replay/GET nhãn chỉ trả503, không nói database write bị rollback.

**Alternatives considered**: Tạo QR bằng dịch vụ bên ngoài trong transaction hoặc hash bỏ source/metadata làm replay sai. Payload baseline thiếu trường mới trả400; không âm thầm tạo bản v1 thiếu nguồn. Key của bản cũ dùng cho payload mới trả409 nếu không khớp, không nâng cấp record cũ.

## R6. Lấp khoảng trống đến nơi và lô

**Decision**: Khi tạo một dòng v1, đồng thời tạo một lô dự kiến BLOCKED, source copy từ dòng, receivedQuantity bằng actualQuantity, availableQuantity=0, unit bằng dòng, lotCode `PLAN-01` (unique theo item), manufactureDate/expiryDate null. Đây là lượng dự kiến giao, không phải receipt hay xác nhận nguồn lô sản xuất. Giữ QR lot nội bộ tách khỏi QR dòng. Trường có bốn role kiểm nhận + view/inspect được dùng `POST /api/deliveries/:id/arrival` body rỗng để xác nhận hàng thực tế đến nơi: IN_TRANSIT -> ARRIVED, server arrivedAt. Tạo đơn không tự xác nhận đến nơi; supplier/public QR không được làm arrival.

**Rationale**: Toàn `src/modules` hiện không có writer tạo lot hoặc arrival. `assertReceipt` yêu cầu có lot trước final APPROVE. Lô dự kiến tận dụng dữ liệu đã nhập, không phát sinh form hoặc giả ngày sản xuất. Bốn bên kiểm nhận phải đối chiếu hàng thực tế trước APPROVE; khác lượng/nguyên liệu/nguồn phải REJECT. Một lot mỗi dòng mới là mặc định đủ dùng, không thay đổi mô hình nhiều lot lịch sử.

**Alternatives considered**: Chỉ đổi IN_TRANSIT mà không tạo đường arrival/lot khiến E2E bế tắc. Supplier khai báo arrival kèm form nhiều lot tăng input ngoài yêu cầu; để trường xác nhận arrival đáng tin cậy hơn. Tự nhập kho lúc create hoặc suy đoán SX/HSD là không được phép. Tách/chỉnh nhiều lô thực tế sau tạo không nằm trong amendment này; cần feature riêng nếu muốn quản lý chi tiết lô sản xuất.

## R7. Hoàn thành, reject và cap3

**Decision**: Không thêm enum lifecycle; IN_TRANSIT là đang giao, RECEIVED là hoàn thành, REJECTED là yêu cầu giao lại. Thêm statusLabel nhất quán, giữ raw status để tương thích. Reuse bốn role và immutable decisions/photos. Final APPROVE rechecks nguồn lô, quantities/date/history/entry và posts receipt + RECEIVED trong cùng tx; chưa đủ4 chỉ PENDING_APPROVAL. Arrival replay sau trạng thái tiến triển không downgrade, không đổi arrivedAt.

**Rationale**: `delivery.service.ts`, `delivery.repository.ts` đã có exactly-once RECEIPT, budget theo source và reject count. Standalone thiếu school entry vẫn tạo được, nhưng final nhận phải attach entry ACTIVE hiện hữu hoặc409; không tự chọn handlingType. Source dừng sau tạo không chặn nhận vì danh tính nguồn không đổi. SupplyRequest không tự COMPLETED chỉ vì Delivery RECEIVED; không thêm thay đổi vòng đời nguồn chưa yêu cầu.

**Alternatives considered**: Dùng APPROVED làm hoàn thành trước receipt tạo sai trạng thái; copy chữ ký cũ hoặc cho QR approve vượt quyền. Đơn thủ công giữ nguồn null: không gom cap theo nhóm null, không tăng hoặc reset cap của yêu cầu cũ. Cap3 vẫn kiểm chứng trên chuỗi legacy nhiều đợt/request, không hứa đơn thủ công độc lập tiếp nối chuỗi đó.

## R8. Migration, rollout và kiểm chứng

**Decision**: Migration mới sau history hiện có, thêm cột nullable/version marker, composite unique trước drop global unique, CHECK từng hàng. Không sửa migration đã applied, không backfill source/token/version hoặc đổi codes/status/timestamps của lịch sử. Service bảo vệ liên bảng; không function/trigger. Schema deploy trước app mới; app cũ phải ngừng writer trước bật create v1. Không khôi phục global unique sau khi hai supplier có cùng mã.

**Rationale**: Đã tồn tại dữ liệu nhiều loại legacy và fixture. Prisma partial indexes source/idempotency và receipt-only uniqueness phải giữ. Một CHECK không thể ép tính đầy đủ mọi child của parent: kiểm tra đó ở service transaction và integration tests. Nguồn đối chiếu SQL nền: [PostgreSQL INSERT](https://www.postgresql.org/docs/current/sql-insert.html), không suy luận isolation/uniqueness chỉ từ kiểm tra ở client.

**Alternatives considered**: Reset/seed để qua migration, chỉnh migration cũ hoặc migration bắt null thành dữ liệu đoán đều bị loại.

## Kết quả Phase 0

Các quyết định Q1=B/Q2=B/Q3=A đã được chuyển thành thiết kế cụ thể. Hai research agent chỉ đọc schema/source về dữ liệu và lifecycle; chưa có test/runtime evidence cho amendment. Không còn unknown chặn Phase1. Không có extension hooks trước/sau plan.
