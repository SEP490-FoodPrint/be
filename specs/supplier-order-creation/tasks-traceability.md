---
description: "Lịch sử task nguồn cung/QR; cần sinh task cho bản sửa đổi luồng trạng thái"
---

# Tasks: Tạo đơn giao hàng có nguồn cung và QR

**Branch**: `feat/supplier-order-creation-stages` | **Generated**: 2026-11-15

**Trạng thái bản sửa đổi luồng trạng thái**: Chưa sinh tasks triển khai cho luồng Đã xác nhận → Đang chuẩn bị hàng → Đang giao hàng. Plan/research/data-model/contracts/quickstart đã cập nhật; chạy `$speckit-tasks` cho FR-006/FR-009/FR-023 và FR-025–FR-031 trước khi sửa code. Giữ toàn bộ ID/checkbox dưới đây làm lịch sử của luồng trước; không thực thi lại task cũ tạo thẳng IN_TRANSIT hoặc coi checkbox đã đánh dấu là tiến độ luồng mới.

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [supplier contract](contracts/supplier-orders.md), [public contract](contracts/public-trace.md), [quickstart.md](quickstart.md).

**Baseline**: T001–T040 chuyển nguyên trạng sang [tasks-baseline.md](tasks-baseline.md), gồm39 task đã đánh dấu và T033 chưa hoàn tất. T041–T098 là58 task của bản sửa đổi nguồn cung/QR; T099 là hồi quy CI bổ sung. Trạng thái từng task được giữ ở checkbox hiện có, không đại diện cho bản sửa đổi luồng trạng thái lần này. Các kiểm thử baseline còn thiếu được bao phủ tại T096, không tự đổi T033 thành hoàn thành.

**Tests**: Gồm các kiểm chứng có ý nghĩa theo quality gate của AGENTS.md và verification plan đã duyệt: input/scope/public allowlist, migration preservation, concurrency/receipt atomicity và QR scan. Không yêu cầu TDD cho mọi file, không thêm test framework hoặc test sao chép implementation. Các task viết test và task chạy integration được phân biệt; task generation không chạy tests/DDL.

**Organization**: Setup -> Foundation -> US1(P1) -> US2(P1) -> US4(P1) -> US5(P1) -> US3(P2) -> Polish. US3 xếp sau các P1 dù số story là3. Mỗi story có checkpoint riêng; toàn bộ feature chỉ hoàn tất khi cả5 story và quality checks đạt.

## Format và path

Task theo `- [ ] TNNN [P?] [USn?] Mô tả kèm đường dẫn`. `[P]` chỉ là cơ hội làm khác file sau khi đủ dependency, không phải lệnh mở mọi task đồng thời. Path trong task tương đối repo root; mọi thay đổi file chia sẻ có đúng một owner trong một thời điểm.

## Phase 1: Setup

**Goal**: Xác định baseline, dependency và điều kiện thực thi trước khi sửa runtime.

- [x] T041 Đọc `specs/supplier-order-creation/spec.md`, `specs/supplier-order-creation/plan.md`, `specs/supplier-order-creation/research.md`, `specs/supplier-order-creation/data-model.md`, hai contract và `AGENTS.md`; đối chiếu nhánh `feat/supplier-order-creation-traceability`, ghi baseline amendment riêng tại `specs/supplier-order-creation/quickstart.md`, giữ lịch sử `specs/supplier-order-creation/tasks-baseline.md` và T033 chưa hoàn tất.
- [x] T042 Thêm dependency runtime `qrcode` 1.5.4 và TypeScript definitions tương ứng vào `package.json`/`package-lock.json`, kiểm tra khả năng import CommonJS của repo; không thêm framework, QR hosting hoặc Cloudinary cho nhãn.
- [x] T043 Ghi điều kiện chạy test trong `specs/supplier-order-creation/quickstart.md`: chọn PostgreSQL disposable local bằng MIGRATION_TEST_DATABASE_URL có schema=foodprint và ủy quyền cho chính tác vụ, Redis namespace riêng, PUBLIC_TRACE_ORIGIN truy cập được; ghi BLOCKED nếu chưa đủ, tiếp tục phần không phụ thuộc hạ tầng. Chốt chữ ký helper/repository/DTO theo contracts trước chia file; không coi quyền sửa mock Azure trước đây là quyền chạy test DB mới.

**Checkpoint**: Đối chiếu dependency bên dưới trước chuyển phase; không đánh dấu chỉ vì đã viết tài liệu.

## Phase 2: Foundational — chặn các user story

**Goal**: Hoàn thành schema/interfaces/helpers dùng chung. Viết migration là chuẩn bị artifact; chạy DDL cần điều kiện T043.

- [x] T044 Mở rộng `prisma/schema.prisma` theo `specs/supplier-order-creation/data-model.md`: nullable Delivery.traceabilityVersion; DeliveryItem sourceFacilityId/snapshots/ingredientNameSnapshot/qrToken/qrUrl và SourceFacility relation; composite unique supplierId+deliveryNo `uq_deliveries_supplier_no`, token unique/index nguồn; giữ partial source/idempotency và receipt-only uniqueness, không sửa model/lô cũ ngoài nhu cầu.
- [x] T045 Viết `prisma/migrations/20261118000100_supplier_delivery_traceability/migration.sql` sau T044, xác minh tên timestamp chưa tồn tại và muộn hơn history hiện hành: thêm nullable fields/FK/CHECK version/bộ dữ liệu QR; tạo composite unique trước bỏ global delivery_no unique. Không function/trigger, không backfill đoán nguồn/token/version hoặc đổi mã/status/timestamps/history; giữ mọi migration đã applied bất biến và cập nhật `database/SCHEMA_BASELINE.md` với trạng thái deployment chưa áp dụng.
- [x] T046 Bổ sung test migration trong `tests/migrations.test.ts` sau T045: fixture baseline version/source/metadata null và multi-lot/source, so sánh IDs/codes/status/created_at/updated_at/approvals/lots/inventory; unique code cùng supplier bị chặn nhưng khác supplier được trùng; CHECK version/metadata/token/group đúng và predicates cũ còn giữ. Chỉ viết fixture/test ở bước này, chạy theo T096.
- [x] T047 [P] Tạo `src/utils/delivery-code.ts` và `tests/delivery-code.test.ts`: format BigInt FP-DE tối thiểu5 chữ số, positive canonical,99999->100000, zero/bad padding/legacy code và trần varchar80; helper không query DB và không đổi mã source facility.
- [x] T048 [P] Thêm parser PUBLIC_TRACE_ORIGIN trong `src/config/env.ts`, kiểm config startup trong `src/server.ts`, mẫu `.env.example` và `tests/public-trace-config.test.ts`: origin không credentials/path/query/hash, HTTPS production, HTTP chỉ loopback dev; injectable config cho test, không lấy request Host và không ghi secrets.
- [x] T049 [P] Tạo helper thuần `src/utils/qr-code.ts` cùng `tests/qr-code.test.ts` sau T042: random32bytes hex64, URL public fixed path theo origin tin cậy, PNG384/margin4/errorCorrection M và render batch tối đa4; render lại từ stored URL, không upload/network/DB. Kiểm PNG thực, token/URL shape, lỗi renderer và URL không lệ thuộc Host.
- [x] T050 [P] Tạo `src/utils/delivery-status.ts` và `tests/delivery-status.test.ts` để dùng chung raw enum -> statusLabel cho supplier/inspection/public: IN_TRANSIT đang giao, RECEIVED hoàn thành, REJECTED yêu cầu giao lại; giữ legacy CREATED/APPROVED, không tạo lifecycle enum mới hoặc gọi APPROVED là hoàn thành.
- [x] T051 Mở rộng interface/select/input persistence dùng chung trong `src/modules/supplier-order/supplier-order.repository.ts` sau T044–T045: source batch/locks theo ID, supplier FOR UPDATE + MAX phần số guarded cast trước numeric, create v1 header/items/snapshots/token/URL và một PLAN-01 BLOCKED lot mỗi dòng trong cùng tx. Giữ scope WHERE từ service, không import DTO; chưa mở query từ service hoặc dùng counter table.
- [x] T052 Rà soát/cập nhật `src/utils/resource-access.ts`, `src/modules/account-lifecycle/intake-access.repository.ts`, `src/modules/account-lifecycle/intake-access.service.ts` và writer khóa source tại `src/modules/source-facility/source-facility.repository.ts`: scope riêng cho source options/labels, giữ hai supplier role+manage, thứ tự parent locks nhất quán khi source đổi trạng thái; không nới quyền quản trị source-facility cho staff hoặc áp intake cung ứng mới vào công việc đã nhận.

**Checkpoint**: Nền tảng hoàn tất trước user-story implementation; integration DB chỉ chạy theo điều kiện T043/T096.

## Phase 3: US1 — Tạo đơn từ yêu cầu đã tiếp nhận (P1)

**Goal**: Đơn nguồn giữ toàn bộ nội dung nhưng có nguồn cung từng dòng, mã theo supplier, QR và IN_TRANSIT.

**Independent Test**: Dùng một request ACCEPTED chưa có Delivery, hai role supplier đủ quyền; POST giữ đủ dòng/lượng nguồn và trả IN_TRANSIT/mã theo supplier/QR/nguồn/lô BLOCKED, thiếu thông tin bị chặn. Kiểm unit/HTTP không phụ thuộc standalone/public UI.

- [x] T053 [P] [US1] Bổ sung contract/validation tests REQUEST trong `tests/supplier-order-creation.test.ts`: sources exact set và không trùng sourceItemId, plate/ETA bắt buộc, Zod gom field paths, cấm quantity/ingredient/school/supplier/status/code/snapshot override; hai supplier roles được tạo nếu đủ manage, nguồn ngoài scope404 và sai state/quota409.
- [x] T054 [US1] Cập nhật nhánh REQUEST/common fields trong `src/modules/supplier-order/supplier-order.validation.ts` và kiểu z.infer tại `src/modules/supplier-order/supplier-order.request.dto.ts`: sources nonempty, UUID normalized, plate trim1..40, ETA ISO offset -> UTC, optional note; không áp trần100 mới cho nguồn nhiều dòng hoặc biến DTO thành cấu trúc viết tay.
- [x] T055 [US1] Mở rộng `src/modules/supplier-order/supplier-order.response.dto.ts` và mapper tạo đơn ở `src/modules/supplier-order/supplier-order.service.ts`: traceabilityVersion/statusLabel, snapshot nguồn/ingredientName, traceUrl; serialize Decimal/Date/null rõ ràng, không trả raw QR token, lot token, creationKey/fingerprint hoặc PNG trên summary.
- [x] T056 [US1] Triển khai tạo REQUEST trong `src/modules/supplier-order/supplier-order.service.ts` sau T051–T055: kiểm quyền ban đầu rồi chuẩn bị candidates token/URL/PNG trước tx, reload actor và START_ORDER_PROCESSING trong Serializable, replay trước cấp mã, recheck exact sources/ACTIVE own facility dưới locks, copy toàn bộ lượng/unit/note nguồn; ghi v1 IN_TRANSIT+items+PLAN-01 BLOCKED available0 dates null, ACCEPTED->IN_PROGRESS atomically. Fingerprint v2 chứa metadata/selections đã chuẩn hóa; không tự receipt hoặc fake source/entry.
- [x] T057 [US1] Nối validation/service mới vào `src/modules/supplier-order/supplier-order.controller.ts` và `src/modules/supplier-order/supplier-order.routes.ts`, giữ POST /api/deliveries/management, header Idempotency-Key và strict empty query; sendSuccess201 lần đầu/200 replay, sendError/asyncHandler theo chuẩn; controllers không import DTO.
- [x] T058 [US1] Bổ sung tests nghiệp vụ/rollback REQUEST trong `tests/supplier-order-creation.test.ts`: N dòng/N token/N stable URL/N BLOCKED lots không receipt; lỗi render trước write, lỗi sau header/item/request update không lưu một phần; nguồn IN_PROGRESS/chưa có phiếu hợp lệ, bất cứ phiếu legacy/new đã có chặn tạo nguồn lần nữa, facility dừng/foreign bị chặn nhưng facilityCode null được chấp nhận.
- [x] T059 [US1] Chạy các unit/HTTP liên quan US1 trong `tests/supplier-order-creation.test.ts` và `tests/intake-access.test.ts`, sửa lỗi trong nhóm file US1, ghi số pass/fail và giới hạn tại `specs/supplier-order-creation/quickstart.md`; không dùng kết quả baseline làm kết quả amendment.

**Checkpoint**: Story US1 đạt tiêu chí độc lập và có bằng chứng kiểm chứng tương ứng.

## Phase 4: US2 — Tạo đơn độc lập cho trường đã liên kết (P1)

**Goal**: Tạo thủ công đủ nguồn/QR/thông tin giao mà không bắt yêu cầu hoặc phiếu bị từ chối.

**Independent Test**: Không có request/rejection history vẫn tạo được standalone cho linked school với nguồn và plate/ETA; source null và lịch sử cũ không bị đổi. Thiếu entry trường không chặn create, nhưng không được receipt.

- [x] T060 [US2] Bổ sung contract/validation tests STANDALONE vào `tests/supplier-order-creation.test.ts`: required school,1..100 own ACTIVE ingredients, sourceFacilityId từng dòng, actualQuantity chuỗi dương Decimal tối đa11+3, unit defaultUnit, plate/ETA; reject trường lạ/trùng dòng/zero/nguồn giả, source request hoặc previousDelivery override.
- [x] T061 [US2] Cập nhật nhánh STANDALONE và kiểu Request DTO trong `src/modules/supplier-order/supplier-order.validation.ts` và `src/modules/supplier-order/supplier-order.request.dto.ts`: item strict ingredientId/sourceFacilityId/actualQuantity/unit, không item.note; normalization đồng bộ REQUEST, không nhận supplierId/snapshot/token.
- [x] T062 [US2] Hoàn thiện truy vấn scope nguyên liệu/nguồn và school ingredient-entry lookup trong `src/modules/supplier-order/supplier-order.repository.ts` cùng guard `src/modules/account-lifecycle/intake-access.service.ts`: linked ACTIVE/new intake policy, own ACTIVE ingredients và facilities; chỉ lookup entry hiện hữu, không tự tạo entry/handlingType; mọi call tham gia cùng tx.
- [x] T063 [US2] Triển khai STANDALONE trong `src/modules/supplier-order/supplier-order.service.ts` dùng pipeline v1 của US1: render candidates, guard/recheck, fingerprint source per item, mã riêng supplier, IN_TRANSIT/snapshots/QR/PLAN-01; entry có thể null, supplyRequest/sourceItem null; không đọc/sửa đơn bị từ chối hoặc yêu cầu cũ để hợp thức hóa đơn mới.
- [x] T064 [US2] Bổ sung tests business STANDALONE trong `tests/supplier-order-creation.test.ts` và `tests/intake-access.test.ts`: không có source/rejection history vẫn tạo, thiếu school entry vẫn tạo với lot chưa receipt, paused/new relationship bị chặn, hai ý định key khác cùng nội dung tạo hai đơn; đơn cũ/approvals/cap/history không bị sửa.
- [x] T065 [US2] Chạy unit/HTTP US2 và regression REQUEST trong `tests/supplier-order-creation.test.ts`/`tests/intake-access.test.ts`, ghi kết quả thực tế và các prerequisites còn thiếu ở `specs/supplier-order-creation/quickstart.md`; ghi rõ final receipt vẫn cần school entry ACTIVE.

**Checkpoint**: Story US2 đạt tiêu chí độc lập và có bằng chứng kiểm chứng tương ứng.

## Phase 5: US4 — Nguồn cung, nhãn QR và truy xuất công khai (P1)

**Goal**: Supplier lấy/in nhãn ổn định; người quét xem đúng dòng với allowlist công khai, không mở quản lý/kiểm nhận.

**Independent Test**: Dùng fixture v1 hợp lệ, lấy đủ N labels rồi quét không login; đúng từng nguồn/snapshot/đơn, cùng QR khi in lại, chỉ allowlist HTML/JSON và không có quyền inspect/arrival từ QR.

- [x] T066 [US4] Bổ sung tests options nguồn/labels trong `tests/supplier-order-creation.test.ts`: staff+admin manage chọn own ACTIVE facility kể cả code null, không lộ contacts/isVisible-private data, pagination/foreign404, N labels/N QR, reprint unchanged, legacy labels409 và render error503 không ghi DB.
- [x] T067 [US4] Thêm GET /options/source-facilities trong `src/modules/supplier-order/supplier-order.routes.ts`, handler/controller, validation/request.dto, response.dto, service và repository tương ứng trong `src/modules/supplier-order/`: trả id/facilityCode/name, page20/max100/id asc/limit+1 và explicit supplier scope; không đổi router quản trị source-facility hoặc cho staff quyền ghi cơ sở.
- [x] T068 [US4] Thêm GET /:id/labels vào `src/modules/supplier-order/supplier-order.routes.ts` và các file controller/validation/request.dto/response.dto/service/repository của module này: target UUID+supplier+manage trước pagination, snapshot label text và qrImageDataUrl PNG từ stored qrUrl, legacy409; renderer có giới hạn song song, không đổi token/url/snapshot/updatedAt khi lấy lại nhãn.
- [x] T069 [US4] Tạo `src/modules/delivery-trace/delivery-trace.validation.ts`, `src/modules/delivery-trace/delivery-trace.request.dto.ts`, `src/modules/delivery-trace/delivery-trace.response.dto.ts`: token hex64, strict empty query, safeParse, malformed/notfound404 cùng thông báo; output allowlist supplierName/deliveryNo/status/statusLabel/ingredientName/actualQuantity/unit/sourceFacility name+nullable code. Request DTO z.infer, Response DTO riêng, DTO chỉ service sử dụng.
- [x] T070 [US4] Tạo `src/modules/delivery-trace/delivery-trace.repository.ts`: point lookup QR dòng globally unique, parent traceabilityVersion1, select tối thiểu snapshot/tên supplier/status và kiểm nhóm field hợp lệ; không list/search, không join trường/user/xe/hợp đồng/approval và không dùng lot.qrToken hoặc deliveryNo làm khóa.
- [x] T071 [US4] Tạo `src/modules/delivery-trace/delivery-trace.service.ts` sau T069–T070: dùng Request DTO, map allowlist rõ ràng, Decimal->string/statusLabel, đồng nhất404 cho invalid/unknown/legacy thiếu public data,503 dependency generic; giữ truy xuất snapshot khi nguồn đổi tên/dừng và hiển thị REJECTED/CANCELLED thật, không suy ra đạt từ việc có QR.
- [x] T072 [P] [US4] Tạo HTML helper thuần `src/utils/public-trace-html.ts` sau hợp đồng T069: trang mobile tối thiểu cùng allowlist, escape mọi text, mã source null hiển thị tên+chưa có mã, không script/form/approval/hidden private data; không query hoặc dùng management DTO để render.
- [x] T073 [US4] Tạo `src/modules/delivery-trace/delivery-trace.controller.ts` và `src/modules/delivery-trace/delivery-trace.routes.ts`: GET /:token không auth, negotiate browser text/html và application/json/*default,406 unsupported Accept; JSON shared envelope, HTML helper cho success/error với CSP/no-store/no-referrer/nosniff/noindex, HEAD không side effect. Controller không import DTO.
- [x] T074 [P] [US4] Tạo `tests/delivery-trace.test.ts` sau T069 với DI/stubs: correct public HTML/JSON allowlist/XSS/token404/406/error headers, legacy/token-lô không được lookup, đổi mã hiển thị không dò được dòng, không data leak qua error/metadata; dùng MemoryStore tường minh trong HTTP tests, không thêm runtime fallback.
- [x] T075 [US4] Đăng ký public route đúng `/api/public/delivery-items/:token` trong `src/routes/index.ts`, bổ sung token redaction và injection cần thiết trong `src/app.ts`; bổ sung HTTP wiring/rate-limit tests vào `tests/delivery-trace.test.ts`: public không bị auth401, protected traceability-anchors vẫn auth, Redis limiter vẫn áp/fail-closed503, access/error log không có raw token. Sau T073–T074 chạy unit US4 và ghi evidence trong `specs/supplier-order-creation/quickstart.md`.

**Checkpoint**: Story US4 đạt tiêu chí độc lập và có bằng chứng kiểm chứng tương ứng.

## Phase 6: US5 — Đến nơi, kiểm nhận và hoàn thành/giao lại (P1)

**Goal**: Trường xác nhận arrival; chỉ đủ4 đạt và nhận kho hợp lệ mới hoàn thành, reject dẫn tới đơn thủ công mới.

**Independent Test**: Dùng fixture v1 IN_TRANSIT có BLOCKED lots, school arrival rồi kiểm1..3/4 signatures, reject/manual/cap3; chỉ đủ4 và receipt hợp lệ mới complete, concurrent final không nhập kho hai lần.

- [x] T076 [P] [US5] Bổ sung unit/HTTP cases arrival và receipt v1 vào `tests/delivery-inspections.test.ts`: đúng bốn school roles+view/inspect, supplier/public/sai school bị chặn, body empty và server timestamp, version1 only kể cả replay, nguồn canceled409; trước arrival không inspect và arrival không tạo approval/receipt.
- [x] T077 [US5] Thêm schemas/Request DTO và Response DTO arrival/statusLabel/source detail vào `src/modules/delivery/delivery.validation.ts`, `src/modules/delivery/delivery.request.dto.ts`, `src/modules/delivery/delivery.response.dto.ts`: UUID/empty body/query, preserve inspection multipart/photo/decision/reason và DTO serialization cũ; không thêm enum COMPLETED hoặc nhận timestamp/lots từ client.
- [x] T078 [US5] Mở rộng `src/modules/delivery/delivery.repository.ts` sau T077: select version/source snapshots, lock source request trước delivery và sorted lots trong cùng tx; operation-specific arrival read/update CAS theo school scope, source equality/entry queries phục vụ receipt, không import DTO hoặc mở transaction độc lập.
- [x] T079 [US5] Triển khai arrival ở `src/modules/delivery/delivery.service.ts`: reload actor/roles/permissions/trường trong transaction, chỉ parent version1, IN_TRANSIT->ARRIVED/server arrivedAt; replay trạng thái đã tiến triển giữ timestamp/không downgrade, nguồn hủy/đơn hủy chặn. Không áp new-supply intake/relationship policy vào công việc đang giao, không tạo approval/stock.
- [x] T080 [US5] Thêm POST /:id/arrival trong `src/modules/delivery/delivery.routes.ts` và handler `src/modules/delivery/delivery.controller.ts`: authenticate+delivery.view+delivery.inspect và school-role/service scope, validate body/query, sendSuccess200/forward errors; không import DTO ở controller, không trao arrival cho supplier hoặc QR public.
- [x] T081 [US5] Cập nhật assertReceipt/final decision mapping ở `src/modules/delivery/delivery.service.ts` và projections trong `src/modules/delivery/delivery.repository.ts`: v1 mọi lot nguồn bằng item.sourceFacilityId, không bắt nguồn ACTIVE hồi tố; giữ lot BLOCKED/available0/quantity/date/history, standalone lookup/attach entry ACTIVE và source budget;4 APPROVE+receiveLot+RECEIPT+RECEIVED cùng tx, statusLabel nhất quán và không ghi final decision nếu receipt thất bại.
- [x] T082 [US5] Bổ sung tests receipt rollback/concurrent simulation trong `tests/delivery-inspections.test.ts`:1..3 APPROVE không kho, đủ4 đúng một receipt/lot; source mismatch/null v1, thiếu entry, bad date/quantity/history và lỗi receiveLot rollback quyết định cuối/status/kho; source rename/deactivate sau create vẫn hợp lệ, legacy nhiều lot/null nguồn không bị ép thành v1.
- [x] T083 [US5] Bổ sung regression reject/cap3/ảnh vào `tests/delivery-inspections.test.ts` và fakes liên quan của file này: immutable one decision/role và photoHash replay giữ nguyên, REJECT reason/lock, không nhận kho; lần3 cùng request hủy nguồn và pending deliveries bằng CANCELLED, giữ RECEIVED/history; standalone null counters không gom nhóm hoặc reset cap. Chạy unit US5, ghi kết quả tại `specs/supplier-order-creation/quickstart.md`.

**Checkpoint**: Story US5 đạt tiêu chí độc lập và có bằng chứng kiểm chứng tương ứng.

## Phase 7: US3 — Xem kết quả và tránh tạo trùng (P2)

**Goal**: Danh sách/chi tiết an toàn, phân biệt legacy/v1; replay và concurrency giữ đúng mã/QR/kho.

**Independent Test**: Dùng fixtures legacy/v1 của hai suppliers cùng mã hiển thị, đọc list/detail theo quyền/scopes, replay qua restart và chạy race20+20; không lộ token/fingerprint, không sinh trùng code/QR/receipt.

- [x] T084 [P] [US3] Bổ sung unit/HTTP read/replay matrix trong `tests/supplier-order-creation.test.ts`: permission đọc OR đúng hai supplier roles, summary không PNG/token, detail nullable legacy/source snapshot v1, statusLabel/raw status/page/filter/ordering và sourceType như baseline; supplier khác404 kể cả cùng deliveryNo.
- [x] T085 [US3] Hoàn thiện list/detail projections trong `src/modules/supplier-order/supplier-order.repository.ts`: trusted supplier WHERE, UUID detail, version/source/qrUrl fields cần cho mapper, tránh full-record/PNG queries trong summary và giữ limit+1/createdAt desc/id asc; không lookup unique theo deliveryNo đơn lẻ.
- [x] T086 [US3] Hoàn thiện explicit list/detail/replay mapping trong `src/modules/supplier-order/supplier-order.service.ts` và `src/modules/supplier-order/supplier-order.response.dto.ts`: snapshot v1, source/traceUrl null legacy, statusLabel dùng helper; recheck live actor trước replay, canonical v2 gồm source/metadata, cùng key cùng record không cấp lại code/token/lot/snapshot; old key khác payload409, không upgrade record baseline.
- [x] T087 [US3] Đồng bộ GET list/detail validation/controller tại `src/modules/supplier-order/supplier-order.validation.ts`, `src/modules/supplier-order/supplier-order.request.dto.ts`, `src/modules/supplier-order/supplier-order.controller.ts`: giữ query page/limit/sourceType/raw status và empty detail query, cấm scope override/field lạ, không mặc định bắt delivery.view khi actor chỉ có manage; chạy regressions source options/labels sau các thay đổi dùng chung.
- [x] T088 [US3] Bổ sung unit cases canonical/replay trong `tests/supplier-order-creation.test.ts`: reorder sources/items và equivalent Decimal/UTC không conflict; đổi facility/plate/ETA/note cùng key409; render failure retry/duplicate races không sinh bản sao và không giả database đã rollback khi GET/replay renderer lỗi sau record cũ đã commit.
- [x] T089 [US3] Mở rộng `tests/supplier-order-creation.integration.test.ts` cho hai supplier ít nhất20 ý định tạo đồng thời mỗi bên, cùng mã đầu00001 nhưng không trùng nội bộ, canonical legacy/99999 boundary; REQUEST race hai actor chỉ một phiếu, replay durable/hash conflict, race source dừng/denial/relationship đổi, snapshots giữ sau rename. Ghi thành công/lỗi/retry/deadline, giữ key/body khi retry503; không gọi là đạt nếu chưa đủ20 committed/supplier. Dùng harness local disposable hiện hữu, không DB thành viên/Azure.
- [x] T090 [US3] Mở rộng `tests/authorization.integration.test.ts` và lifecycle assertions trong `tests/supplier-order-creation.integration.test.ts`: actual HTTP create->school arrival->4 signatures->exactly-once receipt, REJECT->manual fresh code/QR/decisions, missing entry rollback, public allowlist cross-tenant, cap3 legacy. Giữ fixture lịch sử creationMode null/traceabilityVersion null và key/hash hợp lệ cho fixture REQUEST; không gắn v1 vào fixture thiếu nguồn/plate/ETA, không sửa/xóa assertion ngoài phạm vi.

**Checkpoint**: Story US3 đạt tiêu chí độc lập và có bằng chứng kiểm chứng tương ứng.

## Phase 8: Polish & kiểm chứng toàn bộ

**Goal**: Hoàn thiện tích hợp/quality và bằng chứng, không dùng task generation để tự deploy hoặc seed.

- [x] T091 Audit consumers trong `src/modules/warehouse/warehouse.repository.ts`, `src/modules/warehouse/warehouse.service.ts`, `src/modules/kitchen/kitchen.repository.ts`, `src/modules/kitchen/kitchen.service.ts`, `src/modules/menu/menu.repository.ts`, `src/modules/menu/menu.service.ts` cùng `tests/modules.test.ts`/`tests/kitchen-nutrition-lists.test.ts`: chỉ sửa chỗ bị ảnh hưởng bởi mã không unique toàn cục, snapshot/source mới hoặc nullable legacy; vẫn dùng UUID/school/entry, không phá stock/menu history.
- [x] T092 [P] Cập nhật `docs/AUTHORIZATION.md`, `src/modules/README.md`, `README.md` và `.env.example`: bảy management endpoints, school-only arrival, public HTML/JSON exception/allowlist, role/permission/source options cho staff, required source/plate/ETA, statusLabel, public origin/log redaction, migration-before-app/client payload và duy trì hostname đã in; không cấp quyền hoặc seed ngầm.
- [x] T093 Cập nhật `package.json`/`package-lock.json` và `.github/workflows/ci.yml`: đăng ký unit files mới delivery-code/public-trace-config/qr-code/delivery-status/delivery-trace trong test:unit, thêm script chạy `tests/supplier-order-creation.integration.test.ts` và đưa vào quality PostgreSQL disposable hiện có, không đưa Azure credentials vào quality job hoặc đổi CD để seed. Kiểm harness thực sự chạy các case thay vì chỉ pass file-level.
- [x] T094 Review layering/toàn vẹn trong `src/modules/supplier-order/`, `src/modules/delivery/`, `src/modules/delivery-trace/`, `src/utils/resource-access.ts`, `src/utils/qr-code.ts`, `prisma/schema.prisma` và migration mới: controller/repository không import DTO, service không dựng Prisma args; public không có list/bypass/contacts, snapshots/URL immutable, locks cùng tx, legacy unique/predicates đúng; ghi kết quả review tại `specs/supplier-order-creation/quickstart.md`.
- [x] T095 Chạy `npm run prisma:validate`, `npm run prisma:generate`, `npm run validate` và `npm run test:unit` từ root có `package.json`; sửa lỗi liên quan, ghi từng kết quả thực và runtime/dependency versions trong `specs/supplier-order-creation/quickstart.md`; không chạy build/test bằng thông tin môi trường chứa secret trong output.
- [x] T096 Sau T043 và khi instance disposable đã được chọn/ủy quyền cho tác vụ, chạy `npm run test:migrations`, `npm run test:authorization`, `npm run test:account-lifecycle:integration` và script tích hợp supplier-order của T093; sửa lỗi và ghi số test/pass/fail/skipped/harness cleanup tại `specs/supplier-order-creation/quickstart.md`. Bao gồm các kiểm chứng T033 baseline còn thiếu; nếu thiếu hạ tầng/ủy quyền thì giữ chưa hoàn tất và ghi BLOCKED, không dùng pass cũ hoặc skip làm pass mới.
- [x] T097 Thực hiện guide nhãn trong `specs/supplier-order-creation/quickstart.md`: tạo hai supplier/đơn nhiều dòng trên môi trường test đã cho phép, lấy/in lại PNG và quét bằng camera/QR reader độc lập (có thể decoder local); xác nhận N dòng/N QR, đúng stored URL/snapshot, HTML không login, không lộ trường cấm, đổi env không đổi URL cũ, nguồn dừng không mất truy xuất. Ghi artifact/evidence; không tự publish/deploy mạng hoặc khai ngày lô giả chỉ để test.
- [x] T098 Đối chiếu `specs/supplier-order-creation/{spec.md,plan.md,data-model.md,tasks.md,contracts/supplier-orders.md,contracts/public-trace.md}` và FR-001–FR-024/SC-001–SC-010; cập nhật `specs/supplier-order-creation/quickstart.md` với kết quả cuối và prerequisites/rủi ro rollout còn lại, bảo đảm `specs/supplier-order-creation/tasks-baseline.md` giữ checkbox lịch sử, không lẫn .env/credentials/.specify/feature.json/generated output trong diff; chỉ đánh dấu task hoàn thành khi có evidence thật.

**Checkpoint**: Đối chiếu dependency bên dưới trước chuyển phase; không đánh dấu chỉ vì đã viết tài liệu.

## Dependencies & Execution Order

### Dependency graph theo story

```text
T041–T043 Setup
  -> T044–T052 Foundation (migrations/interfaces/helpers)
     -> US1 T053–T059 -> US2 T060–T065
     -> US4 public branch T069–T075 (fixture hoặc producer v1)
     -> US5 T076–T083 (fixture hoặc producer v1)
US1 -> US4 source options/labels T066–T068 (serialize với US2)
US1 + US2 + US4 + US5 -> US3 T084–T090 (read/replay/full integration)
All stories -> T091–T098 Polish/quality/evidence
```

Story có thể kiểm độc lập bằng fixture sau Foundation; hành trình thực tế liên tục đòi producer v1. Không đánh dấu whole-feature done vì một story dùng fake đã pass.

### Dependencies chi tiết

| Nhóm/task            | Prerequisite bắt buộc                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T042–T043            | T041; T043 chỉ ghi/chọn prerequisites, chưa tự chạy DDL.                                                                                                                                                              |
| T044 -> T045 -> T046 | Schema -> reviewed SQL -> migration fixtures.                                                                                                                                                                         |
| T047/T048/T050       | Setup; có thể làm cùng nhau và cùng người viết schema nếu khác file.                                                                                                                                                  |
| T049                 | T042 và contract origin/token đã chốt ở T043; không phụ thuộc code parser T048 vì helper nhận origin tin cậy từ caller.                                                                                               |
| T051                 | T044–T045 và Prisma generate cho type khi implement; database apply không phải điều kiện để viết repository.                                                                                                          |
| T052                 | T041/T043, phối hợp interfaces/locks với T051 trước mở producer.                                                                                                                                                      |
| US1                  | Foundation; T053 tests và T054 validation có thể viết song song khác file; T056 đợi T047–T055, T057 sau T056, T058–T059 sau nối pipeline.                                                                             |
| US2                  | Pipeline US1 hoàn tất; T060 -> T061 -> T062 -> T063 -> T064 -> T065 vì cùng nhóm file supplier-order.                                                                                                                 |
| US4 protected        | Producer US1 đã ổn định; T066 -> T067 -> T068 cùng owner supplier-order. Lịch mặc định sau US2 để không sửa chung file; có thể làm trước US2 để khép MVP US1+QR, rồi bàn giao module.                                 |
| US4 public           | Foundation và contract/schema ổn định; T069 -> T070 -> T071 -> T073. T072/T074 có thể bắt đầu sau T069 và chạy riêng T070/T071, chỉ tích hợp/chạy khi T073 đủ. T075 đợi T073/T074 và integrator rảnh file routes/app. |
| US5                  | Foundation; T076 tests và T077 schemas có thể viết khác file, T078 -> T079 -> T080; T081 đợi repository và producer contract, T082/T083 kiểm sau code.                                                                |
| US3                  | Shared supplier-order writes của US1/US2/US4 protected đã xong; T084 -> T085 -> T086 -> T087 -> T088; T089/T090 dùng toàn API mới và một integration owner.                                                           |
| T091–T094            | Các code contract liên quan đã xong; T092 docs làm khác file T091, T093/T094 theo quyền sở hữu file.                                                                                                                  |
| T095                 | Mọi runtime/test/code registry ở T093/T094 hoàn tất.                                                                                                                                                                  |
| T096                 | T043 được đáp ứng + T046/T089/T090/T093/T095; kiểm thử trên đúng instance disposable đã cho phép.                                                                                                                     |
| T097                 | Public + labels + producer chạy được trên môi trường thử có quyền, không phụ thuộc public deployment; decoder/camera phải độc lập helper tạo QR.                                                                      |
| T098                 | Kết quả thật T095–T097; nếu còn BLOCKED thì report chưa hoàn tất, không tự check hết.                                                                                                                                 |

### File ownership khi dùng tối đa3 subagents

Đây là lịch phân công tham khảo cho bước implement khi user yêu cầu; task generation không khởi chạy subagents.

| Owner             | File độc quyền trong cùng đợt                                                                                                                                                                                             | Task/giai đoạn                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Integrator        | `prisma/schema.prisma`, migration, `database/SCHEMA_BASELINE.md`, `package.json`, lockfile, CI, `src/routes/index.ts`, `src/app.ts`, shared resource-access/guards, integration/migration tests, quickstart và docs chung | Setup/Foundation shared, T075 wiring, T089–T098. Không để người khác sửa các file này đồng thời.                        |
| Supplier producer | Toàn bộ `src/modules/supplier-order/`, `tests/supplier-order-creation.test.ts`; helper mã khi được giao rõ                                                                                                                | US1 -> US2 -> US4 protected -> US3 protected tuần tự; không chia hai story này cho hai người sửa chung module cùng lúc. |
| Public trace      | Toàn bộ `src/modules/delivery-trace/`, `src/utils/public-trace-html.ts`, `tests/delivery-trace.test.ts`; QR/config helper nếu bàn giao trước                                                                              | US4 T069–T074; T075 routes/app/log thuộc Integrator, public owner chỉ sửa test riêng sau handshake.                     |
| Delivery workflow | Toàn bộ `src/modules/delivery/`, `tests/delivery-inspections.test.ts`, status helper nếu bàn giao trước                                                                                                                   | US5 sau schema/interfaces; đây là người thứ3 song song với supplier/public, không chạm shared integration tests.        |

Integrator là agent chính; tối đa3 subagents là Supplier/Public/Delivery khi Foundation đã chốt. Nếu giới hạn tổng agent thấp hơn, gộp Public vào Integrator và giữ nguyên quyền sở hữu file. Các helper/test files Foundation giao từng file một người; hoàn tất/bàn giao trước khi story owner sửa lại. T091 downstream và T092 docs phải giao khác file; `.env.example` của T048 chỉ được T092 chạm sau bàn giao.

## Parallel Examples theo story

| Story | Ví dụ an toàn sau prerequisite                                                                                                       | Rào cản                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| US1   | T053 viết HTTP tests trong `tests/supplier-order-creation.test.ts` song song T054 validator/Request DTO.                             | Đợi hợp đồng Foundation, không chạy T058 cũng sửa test đó; supplier owner tích hợp sau.                             |
| US2   | Supplier owner làm T060–T065 tuần tự, Public owner làm T069–T074, Delivery owner làm T076–T083 với contract/schema đã chốt.          | Không chia T061 và T063 cho hai người cùng sửa supplier module khi chưa bàn giao.                                   |
| US4   | Sau T069, T072 HTML helper/T074 security tests khác file với T070 repository; Supplier owner làm T067/T068 protected options/labels. | T071 đợi repository interface; T073 đợi service/helper; T075 wiring duy nhất Integrator.                            |
| US5   | T076 tests khác file T077 schemas; sau schema có thể phát triển delivery module cùng US2/public modules.                             | T078–T081 cùng owner vì phụ thuộc repo/service; integration assertions T090 Integrator làm sau.                     |
| US3   | Sau producer/labels ổn định, supplier owner làm T084–T088; Integrator chuẩn bị fixture/concurrency T089 và docs owner T092.          | T089/T090 cùng integration file phải tuần tự; chỉ chạy race sau endpoint hoạt động, không sửa source cùng lúc test. |

Các task `[P]` không chia sẻ file với việc thực hiện cùng wave. Mọi wave phải kết thúc kiểm tra interface trước wave kế tiếp; không dùng dấu `[P]` để bỏ qua dependency trong bảng.

## Implementation Strategy

1. Hoàn thành Setup/Foundation và review migration trước; không apply vào DB thật để lấy type.
2. MVP tạo từ yêu cầu: US1 tạo v1 và US4 cho chọn nguồn/lấy nhãn/public trace. US1 đơn lẻ đủ kiểm chứng producer bằng unit/HTTP nhưng chưa đủ trải nghiệm quét QR ngoài hệ thống; không release khi public lookup chưa có.
3. US2 mở tạo thủ công/độc lập, giữ nguồn null và policy liên kết hiện hành.
4. US5 khép hành trình arrival->4 checks->RECEIVED hoặc REJECTED; đây là điều kiện để tuyên bố toàn bộ luồng nghiệp vụ yêu cầu đã hoàn thành, không chỉ một lựa chọn polish.
5. US3 kiểm read/replay/races trên cả hai producer, rồi quality/QR scan và báo cáo. Giữ raw statuses/legacy source null và không gộp cap null.
6. Chỉ sau review migration/quality đạt mới xem xét rollout đúng CD/ủy quyền riêng; task implement không tự cấp quyền remote deploy hoặc seed.

## Requirement Coverage

| Yêu cầu                    | Task thực thi/chứng minh                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–003, FR-010–013     | T052–T065, T084–T090: role/denial/tenant, source eligibility/linked school, standalone độc lập, errors và replay.                 |
| FR-004, FR-007, FR-015     | T044–T047, T051, T056, T086–T089, T096: mã composite/theo supplier, source quota, MAX locked/retry/no duplicates.                 |
| FR-005–006, FR-009, FR-014 | T048–T049, T051–T065, T067: nguồn per-line/required metadata/IN_TRANSIT/atomic QR+items+lots.                                     |
| FR-008, FR-023             | T055, T066–T068, T077–T087: safe read/options/labels/statusLabel và nullable legacy.                                              |
| FR-016–018                 | T049, T055–T056, T066–T075, T089, T097: một QR/line, reprint/storedURL/snapshot, HTML/JSON public allowlist, code null.           |
| FR-019–022                 | T076–T083, T090, T096: arrival school-only,4 immutable decisions, source equality/entry/receipt exactly once, reject/manual/cap3. |
| FR-024                     | T044–T046, T055, T068–T070, T083–T091, T096: giữ toàn bộ IDs/codes/status/timestamps/lots/history, không guessed backfill.        |
| SC-001–005                 | T053–T065, T084–T090, T095–T096.                                                                                                  |
| SC-006–007                 | T047–T049, T066–T075, T089, T096–T097.                                                                                            |
| SC-008–010                 | T076–T083, T090, T096.                                                                                                            |

## Hoàn tất task generation

Lịch sử lần sinh task nguồn cung/QR:58 task T041–T098, Setup3, Foundation9, US1=7, US2=6, US4=10, US5=8, US3=7, Polish8;10 task có `[P]`. Checkbox phản ánh các cập nhật sau lần sinh này, không phải danh sách pending mới. Những đường dẫn/dependency/checkpoint/ownership bên trên cần được đối chiếu lại ở bước plan/tasks cho luồng trạng thái hiện hành. Bản sửa đổi đặc tả lần này chỉ cập nhật tài liệu và trạng thái cần lập lại kế hoạch; không chạy test phần mềm hoặc thay đổi DB.

## Regression CI — T083 không phụ thuộc Cloudinary runtime

- [x] T099 Mock `documentStorage.download` trong phạm vi test T083 tại `tests/delivery-inspections.test.ts` bằng TestContext.mock để tự khôi phục; giữ kiểm photoHash/immutability và thêm xác nhận replay trả URL từ publicId đã lưu. Chạy lại focused test và unit suite với cả ba biến CLOUDINARY rỗng như CI, ghi bằng chứng tại `specs/supplier-order-creation/quickstart.md`; không cấp secret thật cho job unit hoặc thay runtime Cloudinary.
