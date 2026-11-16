# Research: Xác nhận, chuẩn bị và bắt đầu giao hàng

**Date**: 2026-11-15 | **Branch**: `feat/supplier-order-creation-stages` | **Spec**: [spec.md](spec.md)

Nghiên cứu lại35 FR/14 SC, gồm FR-032–FR-035 về nhiều nguồn, giữ tổng lượng, đơn thủ công không xác nhận và tìm trường liên kết. Các quyết định dưới đây thay bản thiết kế trước clarification. Thay các quyết định thiết kế cũ tạo thẳng IN_TRANSIT; giữ nguồn cung, QR, mã đơn và kiểm nhận. Các kết luận dựa trên source trong checkout, không phải khảo sát database đang chạy. Hai lượt research độc lập đã đối chiếu mô hình/migration và dispatch/phân quyền; không chạy DB hoặc sửa runtime.

## R1 — Đã xác nhận trước khi lưu nguyên liệu

**Decision**: REQUEST dùng SupplyRequest.ACCEPTED/IN_PROGRESS khi chưa có bất kỳ Delivery nào làm projection CONFIRMED/Đã xác nhận, giữ raw status và lịch sử. Giữ nguyên POST accept và kết quả bốn trường. STANDALONE không có CONFIRMED/Đã xác nhận ở context, progress hay trạng thái. Chọn trường → nhập nguyên liệu trực tiếp; chưa persist Delivery rỗng hoặc cấp mã/QR. Lần ghi Delivery đầu tiên là hoàn tất nguyên liệu.

**Rationale**: Module `supply-order` hiện tiếp nhận và lưu người/thời điểm đầu tiên; FR-030 không yêu cầu lưu bản nhập dở. Chỉ lưu đơn khi đủ nguyên liệu tránh hai bản ghi đơn hàng và tránh nới mô hình cho draft rỗng. Sau tiếp nhận, mở lại yêu cầu để tiếp tục; sau lưu nguyên liệu, mở lại Delivery theo ID.

**Alternatives considered**: Tạo Delivery rỗng ngay khi accept/chọn trường cần thêm vòng đời draft, cấp mã sớm và thay hợp đồng tiếp nhận. Đổi APPROVED thành Đã xác nhận nhầm với kiểm nhận của trường. Thêm CONFIRMED vào SupplyRequest không cần vì ACCEPTED đã biểu diễn việc này.

**Evidence**: `src/modules/supply-order/supply-order.service.ts` (accept/mapAccepted), `supply-order.repository.ts` (accept); `spec.md` FR-025/FR-030. Module `supplier-onboarding` chỉ sở hữu tạo/gửi yêu cầu của trường, không sở hữu tiếp nhận.

## R2 — Tách workflow khỏi traceability

**Decision**: Thêm DeliveryStatus.PREPARING và nullable `Delivery.workflowVersion`/`workflow_version`: null cho mọi record cũ, 2 cho luồng từng bước. Giữ traceabilityVersion=1, snapshots, QR, mã và PLAN-01 như hiện có. POST tạo nguyên liệu mới ghi PREPARING với ETA/plate null; POST dispatch ghi cả hai metadata và IN_TRANSIT. Không thêm dispatchedAt, bảng đơn mới hoặc bảng lịch sử dispatch.

**Rationale**: Traceability version mô tả QR, không phải tiến độ đặt hàng. Marker workflow riêng cho phép giữ nguyên predicate v1 cũ và nhận diện rõ record được phép dispatch. Metadata đã lưu là bằng chứng dispatch cho replay vì luồng mới chỉ cho thao tác dispatch ghi cặp này và không cho sửa sau đó.

**Alternatives considered**: Chỉ thêm PREPARING và nới CHECK theo status ít cột hơn nhưng không phân biệt chính xác v1 cũ khi kiểm metadata/hủy/replay. Tăng traceabilityVersion lên2 buộc sửa mọi consumer QR không liên quan. Thêm timestamp/fingerprint dispatch hoặc Idempotency-Key mới không cần cho thao tác một lần bất biến theo UUID Delivery.

**Evidence**: `src/modules/supplier-order/supplier-order.service.ts` hiện cả hai nhánh ghi IN_TRANSIT; `prisma/migrations/20261118000100_supplier_delivery_traceability/migration.sql` ép metadata vận chuyển cho v1; public lookup hiện nhận đúng traceabilityVersion=1.

## R3 — Migration giữ nguyên dữ liệu và hủy trước khi giao

**Decision**: Chuẩn bị hai migration mới liên tiếp, thứ nhất chỉ thêm enum PREPARING và commit; thứ hai thêm nullable workflow_version, thay CHECK header và thay hai unique cũ của DeliveryItem bằng ba partial unique theo [data-model](data-model.md). Không default/backfill marker cho record cũ, không sửa migration có sẵn. PREPARING bắt buộc cặp metadata null; trạng thái sau dispatch bắt buộc đủ; hủy được cả-null hoặc đủ nhưng không một nửa. Thêm PREPARING vào cancelRemainder.

**Rationale**: SQL v1 hiện không cho tạo preparing thiếu ETA/plate. Nếu chỉ miễn metadata ở PREPARING, việc hủy đơn chưa giao sẽ vi phạm CHECK khi chuyển CANCELLED. Nhánh workflow null giữ đúng invariant lịch sử, không giả mạo nguồn/QR hay đổi timestamps.

**Alternatives considered**: Sửa migration traceability cũ phá checksum; điền biển số/ngày giả hoặc dùng CREATED cho v1 sai nghĩa; bỏ toàn bộ CHECK làm mất bảo vệ hiện hành.

**Primary source**: PostgreSQL quy định enum mới thêm trong transaction chỉ dùng được sau commit: [ALTER TYPE — Notes](https://www.postgresql.org/docs/current/sql-altertype.html). Vì vậy chia enum và phần sử dụng enum thành hai migration với ranh giới commit rõ ràng; kiểm cả đường Prisma deploy và replay harness sau khi implement. Đây là lựa chọn thiết kế từ quy tắc upstream, chưa phải kết quả chạy migration.

## R4 — Contract và idempotence từng bước

**Decision**: Giữ POST `/api/deliveries/management` làm bước hoàn tất nguyên liệu nhưng bỏ plate/ETA khỏi body strict, fingerprint canonical v3 chỉ chứa nguyên liệu/nguồn/lượng phân bổ/note/cách tạo, sắp xếp theo khóa ghép từng dòng (R8). Phiên bản3 trước đó mới là thiết kế, chưa có writer triển khai trong checkout, nên cập nhật chính định nghĩa v3 trước implement; không sửa hash đã lưu của lịch sử. Giữ Idempotency-Key supplier+actor và HTTP201/200 replay. Thêm POST `/:id/dispatch` với đúng ETA và plate;200 cả lần đầu và replay. Replay dispatch dựa workflowVersion=2 và cặp metadata immutable, không yêu cầu key riêng; cùng canonical body trả trạng thái hiện tại, khác body409.

**Rationale**: Không để client cũ bỏ qua bước chuẩn bị bằng payload chứa thông tin giao; normalize thời gian UTC, plate trim trước so sánh. Replay sau arrival/receipt/reject/hủy không hạ trạng thái, không cập nhật updatedAt. Hủy trước dispatch có metadata null nên không thể bị hiểu nhầm là replay thành công.

**Alternatives considered**: PATCH status tùy ý cho phép bỏ bước. Một POST lưu tất cả như cũ không đáp ứng spec. Dùng hash tạo v2 chứa ETA làm ràng buộc cho bước nguyên liệu khiến replay sai nghĩa. Hỗ trợ writer trực tiếp IN_TRANSIT song song giữ lỗ hổng bỏ bước.

**Compatibility**: Client mới phải dùng payload mới. Payload cũ có plate/ETA trả400; key của record cũ không được nâng cấp hoặc diễn giải lại thành fingerprint v3, trả409 khi gặp trên luồng mới. GET cũ vẫn đọc được; không hứa replay HTTP payload v2 qua contract đã thay. CREATE replay mới đọc lại quyền, scope và kết quả hiện tại trước render/cấp mã; không cần QR renderer/origin còn hoạt động chỉ để trả kết quả đã commit.

## R5 — Khóa, quyền và chính sách công việc đã nhận

**Decision**: Giữ transaction ReadCommitted + retry lỗi khóa hữu hạn của supplier-order hiện tại. Dispatch dùng cùng transaction cho khóa parent school → supplier → actor user → role SHARE, rồi source request nếu có → Delivery; đọc lại quyền/scope/target sau khóa. Repository thực hiện conditional update đúng supplier, workflowVersion=2, PREPARING, metadata null. Không mở transaction độc lập trong repository.

**Rationale**: Plan cũ ghi Serializable nhưng source hiện dùng ReadCommitted. Khóa parent thống nhất với account lifecycle và school inspection giúp phối hợp cancel/arrival/quyền. Dispatch là tiếp tục công việc đã lưu: không yêu cầu intake/relationship/ingredient/facility còn ACTIVE như lúc cung ứng mới. Vẫn chặn tài khoản không ACTIVE, quyền mất, membership đổi, admin hai bên DEACTIVATED, nguồn đã hủy hoặc trạng thái không phù hợp cho lần dispatch đầu.

**Alternatives considered**: Gọi lại SUPPLIER_CREATE_STANDALONE_DELIVERY ở dispatch sẽ khóa sai nghiệp vụ khi nguồn hoặc liên kết dừng sau khi tạo. Dùng guard START_ORDER_PROCESSING cho standalone buộc tạo yêu cầu giả. Chỉ đọc quyền ngoài transaction không bảo đảm yêu cầu recheck hiện hành.

**Evidence**: `supplier-order.service.ts` transaction factory; `src/modules/account-lifecycle/intake-access.repository.ts` lockParents/lockOrder; `intake-access.service.ts` CONTINUE_ACCEPTED_WORK; `src/modules/delivery/delivery.repository.ts` lock. Bổ sung command continuation cho Delivery dùng shared parent-lock và policy, không đổi guard nghiệp vụ hiện có cho mọi module.

**Primary source**: [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) mô tả khóa hàng tới cuối transaction và việc FOR UPDATE chờ writer cạnh tranh. Thiết kế kết hợp khóa và update có điều kiện; vẫn cần test concurrency thật để xác nhận các writer của dự án cùng tuân protocol.

## R6 — Tiến độ trên yêu cầu, đơn và QR

**Decision**: Thêm projection `orderProgress` vào list/detail SUPPLIER của supply-order, không thay raw SupplyRequest.status hoặc accept response. ACCEPTED/IN_PROGRESS chưa có delivery → CONFIRMED; REQUEST Delivery duy nhất → trạng thái thực tế của nó. Legacy nhiều đợt không chọn bừa một đợt, projection null. Supplier-order summary/detail thêm workflowVersion và nextAction; nguồn/lượng/QR không đổi. Public QR giữ đúng allowlist tám trường; label PREPARING là Đang chuẩn bị hàng, IN_TRANSIT là Đang giao hàng.

**Rationale**: Người dùng cần trạng thái/bước kế tiếp, nhưng không cần một enum hoặc bảng trạng thái trùng lặp. Chỉ cho nextAction khi có quyền tương ứng; projection không cấp quyền đọc/ghi Delivery. Đơn thủ công chưa lưu nguyên liệu chỉ tồn tại ở context form, không xuất hiện trong management list.

**Source/matrix reconciliation**: `supplierOrderLabelScope` trong `src/utils/resource-access.ts` hiện yêu cầu manage, khác ma trận `docs/AUTHORIZATION.md` đã duyệt cho đọc OR. Thiết kế labels theo cùng quyền OR của list/detail, giữ hai role và target ownership; task triển khai phải đồng bộ scope và test từng quyền, không mô tả source hiện tại đã hỗ trợ OR. Cờ created hiện chỉ nội bộ service, controller bỏ trước HTTP response; contract giữ Detail và201/200, không thêm field created.

**Alternatives considered**: Gộp yêu cầu và delivery thành list ảo chung làm phức tạp phân trang/ID ngoài yêu cầu. Đổi raw ACCEPTED/IN_PROGRESS làm mất nghĩa xử lý yêu cầu hiện hành. Trả toàn bộ đơn trong QR làm lộ dữ liệu không được công khai.

## R7 — Giữ kiểm nhận và lịch sử kiểm chứng

**Decision**: Arrival vẫn chỉ từ IN_TRANSIT; inspection vẫn ARRIVED/PENDING_APPROVAL, đủ4 đạt mới receipt. Budget receipt phải cộng toàn bộ sibling theo source item thay vì kiểm từng dòng riêng; workflow2 tái kiểm đúng tổng và đủ tập nguồn, legacy giữ khả năng nhận từng phần (R8). Runtime vẫn đếm các đợt có source bị REJECT để áp cap3; docs/AUTHORIZATION trước đây mô tả bỏ v1 khỏi cap là lệch source/spec, phải chỉnh đúng khi implement, không thay policy. Thêm PREPARING vào hủy phần chưa nhận và giữ lô BLOCKED/0 ở cả create/dispatch.

**Rationale**: Thay đổi nằm trước vận chuyển; không bỏ bảo vệ nhập kho đã có. Bằng chứng test trước chỉ là lịch sử. Quickstart mới giữ nguyên phần evidence cũ, tách rõ kế hoạch kiểm chứng luồng mới chưa thực thi.

**Alternatives considered**: Hoàn thành ở Đã xác nhận hoặc IN_TRANSIT bỏ bốn bên; chạy lại DB/test trong bước plan không cần để tạo artifact thiết kế và không được suy quyền từ cấu hình sẵn có.

## R8 — Nhiều dòng cùng nguyên liệu khác cơ sở

**Decision**: Giữ DeliveryItem UUID làm định danh; không thêm bảng/cột allocation. REQUEST `sources` thêm `actualQuantity` bắt buộc cho mỗi dòng phân bổ, được lặp supplyRequestItemId khi khác sourceFacilityId; ingredient/entry/unit suy từ nguồn. STANDALONE giữ items nhưng kiểm trùng theo ingredientId+sourceFacilityId thay cho ingredientId. Service kiểm cùng nguyên liệu thực tế+facility không trùng trong toàn đơn, đủ mọi source item và tổng Decimal từng source item bằng đúng requestedQuantity. 6+4=10 hợp lệ,9/11 hoặc A+A bị chặn; không gộp các dòng.

**Rationale**: Map sourceItem→facility trong create hiện tại ghi đè phân bổ. Quan hệ source.deliveryItems vốn là list, UUID/lot/QR đã hỗ trợ nhiều dòng. Một QR và PLAN-01 riêng cho mỗi allocation; PLAN-01 unique theo DeliveryItem nên không đụng nhau. Các nguyên liệu khác nhau vẫn dùng cùng cơ sở. REQUEST vẫn một Delivery cho toàn yêu cầu, không chia đơn.

**Indexes**: Thay hai unique toàn bộ bằng `uq_delivery_items_ingredient_source` trên deliveryId+ingredientId+sourceFacilityId khi source khác null, và hai unique legacy `uq_delivery_items_legacy_ingredient` trên deliveryId+ingredientId, `uq_delivery_items_legacy_request_item` trên deliveryId+supplyRequestItemId khi source null. Hai nhánh legacy giữ cả hai invariant DB cũ độc lập; index không tham chiếu parent/version. Tạo ba index trước bỏ hai constraint/index cũ, giữ FK/nonunique indexes/QR unique, không thay record. Dùng partialIndexes preview hiện có và mapped predicates trong Prisma; không dùng partial key cho unique operations thay UUID.

**Receipt**: Source lock → Delivery → lots, reload; repository đọc đủ toàn bộ source items và previous RECEIVED theo batch trong cùng tx. Service nhóm mọi dòng giao theo supplyRequestItemId, cộng Decimal trong source unit; previous được cộng đúng một lần cho mỗi group. Kiểm previous+currentGroup<=requested cho các đơn có source; riêng workflow2 REQUEST còn kiểm exact coverage/currentGroup=requested, identity ingredient/entry/unit và cặp nguồn. Không áp whole-order equality hồi tố cho legacy/v1 nhận từng phần. Bất kỳ lỗi nào rollback quyết định cuối/receipt; đủ4 là quyết định cấp Delivery, không phải mỗi allocation cần4 chữ ký riêng.

**Canonical/replay**: REQUEST sort requestItemId rồi facilityId, kèm quantity canonical; STANDALONE sort ingredientId rồi facilityId, kèm quantity/unit. Chuẩn hóa/sort trước gắn QR candidates và persist; reorder không đổi hash, đổi6+4 thành5+5 hoặc đổi source thì hash đổi dù tổng giữ10. Same key khác allocation409. UUID/QR từng dòng được trả lại nguyên vẹn; không dùng tên nguyên liệu làm key. Replay đã commit vẫn auth/scope live và không render QR/lấy origin lại.

**Alternatives considered**: Gộp quantity/nguồn thành một item mất truy xuất riêng; chỉ bỏ unique DB nhưng còn Map/validator cũ vẫn mất dòng; thêm bảng allocation hoặc child version không cần; budget từng sibling có thể cho6+6 vượt10 mà từng dòng riêng vẫn pass.

**Evidence**: `prisma/schema.prisma` DeliveryItem uniques và SupplyRequestItem.deliveryItems; `supplier-order.service.ts` buildCreationFingerprint/createFromRequest; `delivery.service.ts` assertReceipt/final approval budget; `delivery.repository.ts` source/detail selects. Downstream warehouse/kitchen/menu vận hành theo lot UUID/entry nhưng phải audit projections không collapse theo ingredientId.

**Primary source**: [Prisma v7 — Indexes](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes) và cú pháp partialIndexes hiện có trong schema repository được dùng để biểu diễn index có điều kiện. Định nghĩa cụ thể được đối chiếu lại qua prisma validate/generate và fresh/upgrade migration tests khi implement, không qua introspection ở bước plan.

## R9 — Tìm trường liên kết theo phạm vi nhà cung cấp

**Decision**: Mở rộng GET `/api/deliveries/management/options/schools` với `search` optional theo convention các module trong repo; không tạo route search thứ hai. Tách school-only query schema/Request DTO để ingredients/source/labels không vô tình nhận search. Search string trim tối đa100 ký tự, thiếu/rỗng→undefined; tìm một phần name OR code, insensitive, literal backslash/percent/underscore. Giữ paging1/20/max100, id asc, limit+1 và safe `{id,code,name}`.

**Rationale**: Repo đã có listSchoolOptions và eligibility đúng cho chọn trường tạo đơn. Repository nhận plain command supplierId trusted/paging/search, dùng AND eligibility với OR name/code; không query Prisma từ service. Code null vẫn tìm theo name. Giữ school ACTIVE/intake ACTIVE/admin không DEACTIVATED/relationship ACTIVE theo supplier hiện tại; POST vẫn recheck dưới transaction. Chọn trường không ghi record và không gán Đã xác nhận ở STANDALONE.

**Alternatives considered**: Route GET search mới trùng list/options; supplierId query cho tùy ý đơn vị làm sai scope; thêm search vào schema options chung nới cả route không liên quan; unaccent/full-text/trigram extension hoặc index mới chưa cần và chưa được yêu cầu. Không cam kết tìm không dấu.

**Evidence**: `supplier-order.routes.ts` options/schools; `supplier-order.validation.ts` shared options/labels query; `supplier-order.repository.ts` listSchoolOptions; `src/modules/registration/registration.repository.ts` escape pattern LIKE/ILIKE đã có. School-specific validator/controller chỉ dùng Request DTO ở service.

**Primary sources**: [Prisma v7 — Filtering and sorting](https://www.prisma.io/docs/orm/v7/prisma-client/queries/filtering-and-sorting), [PostgreSQL — Pattern matching](https://www.postgresql.org/docs/current/functions-matching.html). Insensitive là xử lý hoa/thường theo database, còn ký tự wildcard phải escape để từ khóa người dùng được tìm literal; không biến `%` thành tìm mọi trường.

## Kết quả Phase0

Đã giải quyết các quyết định kỹ thuật về luồng từng mode, allocation/pair uniqueness, receipt aggregate, compound fingerprint, school search, marker/migration, replay/khóa và consumer. Hai research agents đã đối chiếu độc lập source/model/receipt và search/contracts; không sửa runtime. Không còn điểm cần làm rõ trước Phase1. Không thêm package, không kết nối database, không tạo migration SQL hoặc sửa code ở bước nghiên cứu.
