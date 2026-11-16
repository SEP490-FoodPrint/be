# Quickstart: Đơn đa nguồn, đơn thủ công và tìm trường linked

**Revision**: 2026-11-15 | [Contract](contracts/supplier-orders.md) | [Model](data-model.md) |35 FR/14 SC

Guide chạy sau implement/migration được phép, không phải kết quả đã chạy. Lần plan này chỉ kiểm tài liệu; phần evidence lịch sử cuối file giữ nguyên, không chứng minh thiết kế mới đã đạt.

## 1. Điều kiện và kiểm tra code

- Node/npm và packages theo repository. Hai migration mới enum/marker-CHECK-partial uniques được review; generate client sau schema change. Không cần package/search extension mới.
- Unit/HTTP injection không cần PostgreSQL/Redis; runtime limiter vẫn Redis fail-closed. Test ghi chỉ local disposable instance đã chọn và được ủy quyền cho chính tác vụ; reuse `.env.test.local`/harness, không in credentials hoặc dùng member DB/Azure/container mới.
- Harness cleanup chỉ database invocation đã CREATE thành công; không reset control/member DB. `test:local:check` có thể bảo đảm control DB tồn tại, nên cũng chờ điều kiện test writes.
- Fixture sau implement: hai supplier/admin/staff, trường linked đủ điều kiện và trường ngoài scope; code null/same names/%/_/backslash để test search; nhiều cơ sở mỗi supplier; source request10kg thịt heo cùng4role trường, legacy/v1 partial receipt và null source fixtures.
- HTTP walkthrough dùng API_BASE tới API thử, token fixture ở biến SUPPLIER_TOKEN/SCHOOL_TOKEN, UUID/key của test. Copy payload examples từ contract vào request-allocations.json/standalone-allocations.json và thay UUID fixture. QR origin phải truy cập được, không đổi stored URL cũ.

```bash
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
```

Focused khi khoanh vùng:

```bash
npm exec --no -- tsx --test tests/supplier-order-creation.test.ts tests/supply-order-intake.test.ts tests/intake-access.test.ts tests/delivery-inspections.test.ts tests/delivery-status.test.ts tests/delivery-trace.test.ts
```

Expected: cases mới thực thi thật, không file-level pass/skip, strict validation/quyền/rollback/group totals/replay. Nếu thêm unit file phải đăng ký test:unit; không thêm framework/TDD toàn repo.

## 2. Migration và real concurrency

Chỉ khi đủ hạ tầng/ủy quyền local:

```bash
npm run test:local:check
npm run test:local:migrations
npm run test:local:authorization
npm run test:local:lifecycle
npm run test:local:supplier-orders
```

Expected: fresh deploy và upgrade legacy/v1 qua enum commit rồi marker/CHECK+child uniques; ba partial predicates đúng, tạo index trước drop unique cũ. Marker lịch sử null, IDs/status/timestamps/mã/QR/decisions/lots/stock giữ nguyên. Source nonnull cho ingredient+A và ingredient+B, cấm A+A; source null vẫn giữ cả ingredient/source-item cardinality legacy. Các null-marker/traceability/status/metadata bất hợp lệ bị CHECK chặn, hủy trước/sau giao hợp lệ.

Ít nhất20create intents mỗi supplier, code riêng không trùng và Nallocations có N QR. REQUEST race chỉ một Delivery. Same key reorder200, đổi phân bổ dù tổng bằng nhau409; giữ key/body/deadline khi retry503 và đếm đủ committed, không coi vài create thành công là đạt. Dispatch same/different body races, cancel/arrival/denial, final-approve race và previous receipt budget phải kiểm trên PostgreSQL thật.

## 3. Tìm trường linked và chọn thủ công

```bash
curl --fail-with-body --get "$API_BASE/api/deliveries/management/options/schools" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  --data-urlencode 'search=hoa' \
  --data-urlencode 'page=1' \
  --data-urlencode 'limit=20'
```

Expected200 safe id/code/name + pagination, chỉ trường eligible của supplier hiện tại. Các ca bắt buộc:

- Partial name hoặc code, hoa/thường, code null khớp tên; blank/whitespace/thiếu search trả danh sách mặc định, không khớp/trang vượt phạm vi trả rỗng, id asc/limit+1/hasNext đúng.
- Literal percent/underscore/backslash không biến thành wildcard tìm tất cả; không yêu cầu tìm không dấu. Không đưa token vào URL hoặc log fixture.
- Search quá100, array/object/repeated query, q alias, supplierId/schoolId hoặc field lạ400. Ingredient/source options và labels nhận search cũng400 vì không nới shared schema.
- School cùng tên ở supplier khác, chưa linked, relationship/school/intake/admin không đủ điều kiện không được trả; role view/accept không thay manage. Chưa auth401, thiếu quyền403.
- Chọn trường không ghi order hoặc gán Đã xác nhận/CONFIRMED ở standalone. Trường/quan hệ thay sau search phải được POST kiểm lại và từ chối nếu không còn hợp lệ.

## 4. REQUEST — một nguồn yêu cầu chia qua nhiều cơ sở

1. Accept SENT bằng cả admin/staff: raw ACCEPTED, receipt vẫn4fields/người/thời điểm đầu tiên; detail orderProgress CONFIRMED chỉ cho yêu cầu đã tiếp nhận chưa Delivery. Accept không tạo Delivery/QR/kho hoặc trao quyền manage/view ngầm.
2. Với source10kg thịt heo, dùng contract REQUEST gồm hai sources cùng requestItem, khác facility A/B và actualQuantity6/4. Không xe/ETA, không ingredient/unit override:

```bash
curl --fail-with-body "$API_BASE/api/deliveries/management" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $CREATE_KEY" \
  --data @request-allocations.json
```

Expected201 PREPARING/workflow2/traceability1, metadata giao null, một Delivery/mã và hai DeliveryItem UUID/QR/PLAN-01 BLOCKED0 khác nhau cùng sourceItem; quantities6 và4, đúng nguồn/đơn vị. Source IN_PROGRESS, không inventory. HTTP data không có created nội bộ/key/hash/raw token/PNG.

3. Missing quantity, invalid decimal/null/sourceItem+facility duplicate400; extra/missing source group, wrong total9/11/6+6, identity/unit override hoặc service-detected ingredient+facility duplicate bị chặn theo contract400/409, không lưu một phần. Không bù lượng giữa hai source items hoặc bỏ nguyên liệu gốc.
4. Reorder sources hoặc decimal6.000/4.000 với same key200 cùng items/QR/status/timestamps. Same key đổi5+5 hay source khác409 dù vẫn10; key mới cho cùng request409. Payload cũ thiếu allocation quantity hoặc chứa ETA/plate400; old workflow-null key409, không nâng cấp.
5. Replay sau source/facility dừng hoặc renderer/origin không sẵn sàng vẫn trả record đã commit sau live auth/scope, không cấp lại mã/QR. Reopen request sau nguyên liệu chỉ đúng Delivery PREPARING/ENTER_SHIPPING theo quyền.

## 5. STANDALONE — không có Đã xác nhận

Tìm/chọn trường bằng bước3 rồi nhập nguyên liệu trực tiếp. Chưa lưu thì chưa có record/state/ID/mã/QR; không CONFIRMED, không accept request/trường xác nhận, không lưu draft.

POST standalone-allocations.json theo contract: hai dòng cùng thịt heo từ A/B, quantities6/4 và unit kg, key mới. Expected201 PREPARING và hai item/QR/lô riêng, không SupplyRequest/IngredientEntry giả. Trùng A+A bị400 ở field nguồn, row thứ3 cũng không dùng lạiA/B; ingredient khác dùngA hợp lệ. Count max100rows, không phải100ingredient phân biệt.

Bỏ trường/linked eligibility đổi/nguồn dừng trước ghi/quyền mất/nguyên liệu hoặc unit sai phải chặn và không tạo đơn dở; thiếu school IngredientEntry vẫn tạo với null, final receipt mới cần entry ACTIVE theo policy standalone. Reopen PREPARING giữ mã/nguồn/QR, không yêu cầu tạo lại.

## 6. Dispatch, labels và public QR

```bash
curl --fail-with-body "$API_BASE/api/deliveries/management/$DELIVERY_ID/dispatch" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"expectedArrivalAt":"2026-11-20T08:30:00+07:00","vehiclePlate":"29C-123.45"}'
```

Expected200 IN_TRANSIT/Đang giao hàng, ETA UTC/plate trim cùng commit, Nitems/QR/lô/mã không đổi, chưa kho. Missing/null/sai timezone/plate trắng/quá40/extra note/items/status400 và vẫn PREPARING; không future-date/national-regex mới. Legacy/đơn hủy trước giao409, foreign404, deny403. Same canonical body sau arrival/receipt/reject/hủy-sau-dispatch200 current state, khác body409; replay không sửa updatedAt và vẫn live quyền, không QR render/write mới.

First dispatch chặn source terminal/admin hai bên DEACTIVATED; continuation không áp intake/relationship/ingredient/facility ACTIVE của cung ứng mới. Guard/CAS cùng tx, lỗi giữa ghi rollback cả metadata/status. Hai actor/body/cancel/arrival races không downgrade.

Lấy labels ngay PREPARING theo từng quyền OR view/manage/receive trong scope; không quyền/foreign bị chặn. Quét hai QR thịt heo ở A/B trả đúng6/4 và nguồn khác nhau, public8fields không IDs/marker/action/xe/ETA. Reprint/snapshot sau đổi tên/dừng/hủy giữ URL/token; headers/HEAD/HTML escaping/Redis fail-closed không đổi.

## 7. Kiểm nhận, aggregate budget và kho

PREPARING không arrival/inspection,409 không chữ ký/kho. Sau dispatch → arrival → tối đa3đạt chưa receipt → đủ4đạt mới RECEIVED/stock. Hai source allocations chỉ cần bốn vai trò ở cấp Delivery; mỗi lot receipt đúng một lần, không nhân4chữký theo item.

Bổ sung fixture controlled chỉ trong disposable để thử hàng rào cuối (không làm bằng sửa dữ liệu thật):

- Current siblings6+6 cho requested10 phải bị receipt aggregate chặn, dù từng sibling riêng nhỏ hơn10; missing group/wrong ingredient/entry/unit/duplicate source cũng chặn. Repository phải đọc đủ source items, không chỉ nhóm từ current payload.
- Workflow2 current6+4 đúng10 nhưng source đã có previous RECEIVED phải bị budget chặn khi previous+10>10; previous cộng đúng một lần mỗi group. Legacy partial3kg trên requested10 có previous2kg vẫn nhận được khi đủ các điều kiện legacy khác, không ép current=10 hoặc full coverage hồi tố; thêm ca legacy dùng đơn vị chuyển đổi tương thích đang được hỗ trợ, không bắt equality unit mới.
- Final approval failure source/entry/quantity/date/history rollback chữ ký cuối/status/mọi lot/receipt, final decision race/replay đúng một receipt/lot. Same ingredient nhiều source có thể cùng school entry nhưng lot/source vẫn tách đúng.
- REJECT giữ lý do/history; standalone giao lại không CONFIRMED, đi nguyên liệu/dispatch mới với mã/QR/quyết định mới. Cap3 source hủy phần chưa nhận gồm PREPARING, CHECK metadata null không cản hủy; RECEIVED/history cũ nguyên vẹn.

## 8. Báo cáo và rollout

Ghi branch/commit, số check/test thực PASS/FAIL/BLOCKED/skipped, create/dispatch/final receipt commits/retry/deadline, search scope/literal và QR scan evidence. Test SQL/harness chỉ instance disposable hiện có được chọn/ủy quyền; thiếu prerequisite giữ pending, không chuyển member/Azure.

Schema/partial indexes trước app/client; stop writer direct transit, REQUEST thêm actualQuantity bắt buộc và standalone không synthetic CONFIRMED. Giữ host URL cũ, không deploy/seed từ plan/guide. Rollback code cũ sau đa nguồn cần review, không gộp/xóa row/QR/history hoặc điền metadata giả để phục hồi unique cũ.

## 9. Nhật ký triển khai & kiểm chứng workflow2 (T100–T156)

### Setup & Baseline (T100–T102)

- **T100 — Đối chiếu spec/plan/history**: Nhánh `feat/supplier-order-creation-stages`, `specs/supplier-order-creation/spec.md` có 35 FR (`FR-001`–`FR-035`) và 14 SC (`SC-001`–`SC-014`). `prisma/migrations/` hiện kết thúc tại `20261118000100_supplier_delivery_traceability`; hai migration dự kiến mới nối tiếp đúng thứ tự là `20261118000200_delivery_preparing_status/migration.sql` (enum-only `PREPARING`) và `20261118000300_supplier_order_stages/migration.sql` (`workflow_version`, `chk_delivery_traceability_version` cập nhật và ba partial unique indexes cho `delivery_items`). Giữ nguyên lịch sử `tasks-baseline.md` (T001–T040) và `tasks-traceability.md` (T041–T099).
- **T101 — Baseline trước sửa đổi workflow2**:
  - `src/modules/supplier-order/supplier-order.service.ts` hiện tạo thẳng `IN_TRANSIT` với `expectedArrivalAt` và `vehiclePlate` bắt buộc lúc create; REQUEST dùng `new Map(body.sources.map(...))` (chỉ 1 nguồn/sourceItem) và `createStandalone` cấm trùng `ingredientId`.
  - `prisma/schema.prisma` và `delivery_items` hiện có hai full unique `(delivery_id, ingredient_id)` và `(delivery_id, supply_request_item_id)`, chưa có `DeliveryStatus.PREPARING` hoặc `Delivery.workflowVersion`.
  - `src/modules/delivery/delivery.service.ts` hiện kiểm budget receipt từng dòng riêng (`received.add(item.actualQuantity).gt(requested)`) thay vì nhóm theo `supplyRequestItemId`.
  - `src/modules/supply-order/` chưa trả `orderProgress`; `supplierOrderLabelScope` trong `src/utils/resource-access.ts` còn gọi `supplierOrderManagementScope` (`delivery.manage`); `GET /options/schools` chưa hỗ trợ `search`; endpoint `POST /:id/dispatch` chưa tồn tại.
- **T102 — Điều kiện local harness (chỉ đọc cấu hình, chưa chạy check ghi)**:
  - `tests/helpers/run-local-tests.ts` và `tests/helpers/local-test-database.ts` đọc `.env.test.local` (ignored bởi `.gitignore`) và tạo/dọn các DB tạm theo manifest trên PostgreSQL local loopback, không dùng `.env` hoặc Azure.
  - Cấu hình hiện tại trong `.env.test.local` đã đặt đủ biến (`TEST_DB_HOST=127.0.0.1`, `TEST_DB_PORT=5433`, `TEST_DB_USER` / `TEST_DB_PASSWORD` đã cấu hình — không in credential, `TEST_REDIS_URL=redis://127.0.0.1:6379/0`).
  - **Phạm vi ủy quyền cho T153–T155**: Đã sẵn sàng cấu hình local loopback; việc thực thi `npm run test:local:check` và các suite tạo/xóa DB tạm trên `127.0.0.1:5433` chờ xác nhận ủy quyền cho isolated test writes trước khi chạy T153–T155 (T100–T152 chỉ chạy unit/validate không chạm DB).

### Foundation (T103–T110)

- **Schema & Migrations (`T103`–`T106`)**:
  - `prisma/schema.prisma`: thêm `DeliveryStatus.PREPARING` (cuối enum khớp `ALTER TYPE ... ADD VALUE`) và `Delivery.workflowVersion Int? @map("workflow_version")`; thay 2 full uniques trên `DeliveryItem` bằng 3 partial unique indexes (`uq_delivery_items_ingredient_source`, `uq_delivery_items_legacy_ingredient`, `uq_delivery_items_legacy_request_item`).
  - `prisma/migrations/20261118000200_delivery_preparing_status/migration.sql`: enum-only `ADD VALUE 'PREPARING'` tách riêng để commit trước migration sử dụng `'PREPARING'`.
  - `prisma/migrations/20261118000300_supplier_order_stages/migration.sql`: preflight fail-fast, nullable `workflow_version`, cập nhật `chk_delivery_traceability_version` & thêm `chk_delivery_workflow_version` (đủ guard `IS NULL`/`IS NOT NULL`), tạo 3 partial unique indexes trước khi bỏ `delivery_items_delivery_id_supply_request_item_id_key` (constraint) và `delivery_items_delivery_id_ingredient_id_key` (index).
  - `npm run prisma:validate` & `npm run prisma:generate`: PASS. Đã bổ sung test nâng cấp & fresh schema parity vào `tests/migrations.test.ts` (`T106`, chờ chạy DB ở `T153`).
- **Status Labels, Persistence Inputs & Continuation Guard (`T107`–`T110`)**:
  - `src/utils/delivery-status.ts`: `PREPARING` → `"Đang chuẩn bị hàng"`, `IN_TRANSIT` → `"Đang giao hàng"`.
  - `src/modules/supplier-order/supplier-order.repository.ts` (`T108`): mở rộng summary/detail select (`workflowVersion`, `SupplyRequest.status`) và `createDeliveryWithItems` hỗ trợ nullable ETA/plate, `workflowVersion`, `item.id` riêng từng allocation không gộp `Map`.
  - `src/modules/account-lifecycle/intake-access.repository.ts` & `intake-access.service.ts` (`T109`): bổ sung `assertDeliveryContinuation` giữ canonical lock order (`school → supplier → user → role SHARE → supplyRequest nếu có → Delivery`), reload live actor/scope/target, tách live-auth/scope (áp mọi lần kể cả replay) khỏi first-dispatch policy (chỉ kiểm nguồn `ACCEPTED`/`IN_PROGRESS` & admin hai bên không `DEACTIVATED` khi chưa dispatch).
  - Kiểm chứng focused (`T110`): `npx tsx --test tests/intake-access.test.ts tests/delivery-status.test.ts` PASS **36/36** (0 fail, 0 skipped); ESLint các file vừa sửa (`intake-access.*`, `supplier-order.repository.ts`, `delivery-status.*`, `migrations.test.ts`) PASS **0 lỗi**. (`tsc --noEmit` còn 9 lỗi fixture mong đợi tại `tests/supplier-order-creation.test.ts` do select mới `workflowVersion` và `SupplyRequest.status` — sẽ cập nhật cùng US1 `T111`).

### Phase 3: US1 — Tạo đơn từ yêu cầu đã tiếp nhận (T111–T118)

- **Triển khai (`T112`–`T117`)**:
  - `src/modules/supply-order/supply-order.repository.ts`, `supply-order.response.dto.ts`, `supply-order.service.ts`: giữ nguyên 4-field receipt ở `accept` (không tạo Delivery); mở rộng supplier read select (`_count.deliveries`, unique `REQUEST` delivery `{ id, status, workflowVersion }`) và map `orderProgress` tường minh (`CONFIRMED`/`"Đã xác nhận"`/`ADD_INGREDIENTS` khi chưa có delivery ở `ACCEPTED`/`IN_PROGRESS`; trạng thái `Delivery` thực tế khi có 1 `REQUEST` delivery; `null` cho terminal chưa delivery hoặc legacy đa đợt), nhánh `SCHOOL`/`SYSTEM` giữ nguyên.
  - `src/modules/supplier-order/supplier-order.validation.ts`, `supplier-order.request.dto.ts`, `supplier-order.response.dto.ts`, `supplier-order.service.ts`: bỏ `expectedArrivalAt`/`vehiclePlate` khỏi cả hai create schema; bắt buộc `actualQuantity` dương chuẩn `Decimal` trên từng row `REQUEST` `sources[]` và cho lặp `supplyRequestItemId` khác `sourceFacilityId` (chặn cặp trùng `400`); canonicalize `REQUEST` & build `v3` fingerprint trước khi chạm renderer/origin; `createFromRequest` kiểm full group coverage, tổng `Decimal` chính xác theo từng `supplyRequestItemId` (không bù trừ chéo nhóm), cấm trùng resolved `(ingredientId, sourceFacilityId)` (`409`), tạo một `Delivery` `PREPARING` (`workflowVersion: 2`, `traceabilityVersion: 1`, `expectedArrivalAt: null`, `vehiclePlate: null`) với N `DeliveryItem` UUID/QR/`PLAN-01` `BLOCKED` `0` riêng và cập nhật `ACCEPTED -> IN_PROGRESS` atomically; map `workflowVersion`, `nextAction` và ẩn `created`/`qrToken`/`creationKey`/`creationFingerprint`.
- **Kiểm chứng focused (`T118`)**:
  - `npx tsx --test tests/supplier-order-creation.test.ts tests/supply-order-intake.test.ts`: PASS **37/37** (15 cases `supplier-order-creation.test.ts` + 22 cases `supply-order-intake.test.ts`, 0 fail, 0 skipped), gồm `accept` 4 fields + `orderProgress` matrix, `10kg` chia `6A+4B` → `PREPARING`, tổng sai (`9`/`11`/`6+6`)/cross-group offset/missing-extra group/duplicate resolved `(ingredientId, sourceFacilityId)` → `409`, canonical `v3` reorder replay `200` không gọi renderer/origin, `workflowVersion: null` replay → `409`, HTTP mask nội bộ và rollback/quyền đổi.
  - `npx tsc --noEmit`: PASS **0 lỗi**.
  - `npx eslint src/modules/supply-order/*.ts src/modules/supplier-order/*.ts tests/supply-order-intake.test.ts tests/supplier-order-creation.test.ts`: PASS **0 lỗi/0 cảnh báo**.
  - **Phạm vi chưa chạy ở T118**: Các unit tests trên dùng mock repository/transaction (không thay thế kiểm chứng concurrency/constraint thật trên PostgreSQL ở `T154`).

### Phase 4: US2 — Tìm trường đã liên kết và tạo đơn thủ công không qua Đã xác nhận (`T119`–`T124`)

- **Triển khai (`T120`–`T123`)**:
  - `src/modules/supplier-order/supplier-order.validation.ts` & `supplier-order.request.dto.ts`: giữ `createStandaloneBodySchema` items `1..100` theo allocation rows, cho lặp `ingredientId` khác `sourceFacilityId` và chặn cặp `(ingredientId, sourceFacilityId)` trùng `400` tại `path: [i, "sourceFacilityId"]`; tách riêng `supplierSchoolOptionsQuerySchema` / `validateSupplierSchoolOptionsQuery` + `SupplierSchoolOptionsQueryDTO` (`search` trim max `100` sau trim, chuỗi rỗng/khoảng trắng chuyển `undefined`, từ chối array/object/unknown/`q`/`supplierId`/`schoolId`), giữ `supplierOrderOptionsQuerySchema` từ chối `search` cho ingredients/sources/labels.
  - `src/modules/supplier-order/supplier-order.repository.ts`, `supplier-order.controller.ts`, `supplier-order.service.ts`: `listSchoolOptions` nhận `SupplierOrderSchoolOptionsCommand` nội bộ, escape literal `\` / `%` / `_` khi filter `OR (name, code)` `contains` `insensitive` kết hợp `AND eligibilityWhere` (khi không có `search` giữ nguyên `eligibilityWhere`); `createStandalone` truyền danh sách `ingredientId` duy nhất vào `guard.assertAccess`, phòng thủ `409` trùng cặp `(ingredientId, sourceFacilityId)`, giữ `PREPARING` / `workflowVersion: 2` / `expectedArrivalAt: null` / `vehiclePlate: null` và không tạo `SupplyRequest` hay `IngredientEntry` giả.
  - `tests/supplier-order-creation.test.ts` & `tests/supplier-order-creation.integration.test.ts`: bổ sung test `GET /options/schools?search=`, escaping ký tự `%`/`_`/`\`, quyền/eligibility, `6A+4B` multi-source `STANDALONE` + kiểm tra PostgreSQL thật (fixture tên `100%_test\vn`, `code: null`, đình chỉ quan hệ sau search → POST `409`, zero `SupplyRequest`/`IngredientEntry` mới, 4 `PLAN-01` lots `BLOCKED` `0`).
- **Kiểm chứng focused (`T124`)**:
  - `npx tsx --test tests/supplier-order-creation.test.ts tests/intake-access.test.ts`: PASS **49/49** (15 cases `tests/supplier-order-creation.test.ts` + 34 cases `tests/intake-access.test.ts`, 0 fail, 0 skipped).
  - `npx tsc --noEmit`: PASS **0 lỗi**.
  - `npx eslint src/modules/supplier-order/*.ts tests/supplier-order-creation.test.ts tests/supplier-order-creation.integration.test.ts`: PASS **0 lỗi/0 cảnh báo**.
  - **Phạm vi chưa chạy ở T124**: Suite tích hợp PostgreSQL (`tests/supplier-order-creation.integration.test.ts`) đã compile/lint sạch và sẽ được thực thi thật sau khi hoàn thiện các pha tiếp theo và được cấp quyền ghi DB test tại `T153`–`T154`.

### Phase 5: US6 — Cập nhật vận chuyển và bắt đầu giao (`POST /api/deliveries/management/:id/dispatch`) (`T125`–`T132`)

- **Triển khai (`T126`–`T131`)**:
  - `src/modules/supplier-order/supplier-order.validation.ts` & `supplier-order.request.dto.ts`: thêm `dispatchSupplierOrderBodySchema = z.strictObject({ expectedArrivalAt: requiredIsoDateTimeSchema, vehiclePlate: requiredVehiclePlateSchema })` và `validateDispatchSupplierOrderBody` + `DispatchSupplierOrderBodyDTO` (`z.infer`), bắt buộc ISO8601 có múi giờ chuẩn hóa UTC và biển số xe `trim 1..40` (không giới hạn tương lai/regex quốc gia), gom đa lỗi theo field path tiếng Việt và từ chối field thừa.
  - `src/modules/supplier-order/supplier-order.repository.ts`: thêm `DispatchSupplierOrderCommand` và `dispatchDelivery` thực hiện CAS `updateMany` theo `scope`, `id`, `workflowVersion: 2`, `traceabilityVersion: 1`, `status: "PREPARING"`, `expectedArrivalAt: null`, `vehiclePlate: null` → set `status: "IN_TRANSIT"`, `expectedArrivalAt`, `vehiclePlate` trong cùng `tx`.
  - `src/modules/supplier-order/supplier-order.service.ts`, `supplier-order.controller.ts`, `supplier-order.routes.ts`: triển khai `dispatch` dùng chung `guard.assertDeliveryContinuation` dưới `authorizationTransaction` (`delivery.manage`, lock parents/order/delivery, nhận diện replay canonical đối với đơn `workflowVersion: 2` đã từng dispatch mà không đòi pause/relationship/source/ingredient `ACTIVE`, trả current detail không đổi `updatedAt`/không render QR khi replay khớp, trả `409` khi lệch metadata hoặc hủy trước dispatch/legacy `workflowVersion: null`, phân loại race khi CAS trả `0`); gắn `POST /:id/dispatch` tại controller/router (không đòi `Idempotency-Key`, kiểm `src/routes/index.ts` vẫn mount `/deliveries/management` trước `/deliveries`).
  - `tests/supplier-order-creation.test.ts`, `tests/supplier-order-creation.integration.test.ts`, `tests/account-lifecycle.integration.test.ts`: bổ sung test HTTP/validation/role/replay/rollback/continuation/CAS race (`T125`, `T130`), cập nhật các luồng v1 cũ trong integration suite sang 2 bước (`create -> dispatch -> arrival/inspection`), và bổ sung test race/lifecycle deactivation (`T131`).
- **Kiểm chứng focused (`T132`)**:
  - `npx tsx --test tests/supplier-order-creation.test.ts tests/intake-access.test.ts`: PASS **51/51** (17 cases `supplier-order-creation.test.ts` gồm `T125`/`T130` + 34 cases `intake-access.test.ts`, 0 fail, 0 skipped).
  - `npx tsc --noEmit`: PASS **0 lỗi**.
  - `npx eslint src/modules/supplier-order/*.ts tests/supplier-order-creation.test.ts tests/supplier-order-creation.integration.test.ts tests/account-lifecycle.integration.test.ts`: PASS **0 lỗi/0 cảnh báo**.
  - Audit `src/`: không có đường ghi ETA/plate nào khác cho `workflowVersion: 2`, không mở `PATCH` status hoặc create thẳng `IN_TRANSIT`.
  - **Phạm vi chưa chạy ở T132**: Test concurrency PostgreSQL trong `tests/supplier-order-creation.integration.test.ts` và `tests/account-lifecycle.integration.test.ts` sẽ được chạy thật tại `T154`.

### Phase 6: US4 — Nhãn QR chuẩn bị trước & truy xuất công khai (`T133`–`T137`)

- **Triển khai (`T133`–`T136`)**:
  - `src/utils/resource-access.ts`: chuyển `supplierOrderLabelScope` sang dùng `supplierOrderReadScope(principal)` để đồng bộ ma trận read OR (`delivery.view` / `delivery.manage` / `delivery.receive` trên hai role `SUPPLIER`), trong khi `/options/source-facilities` vẫn đòi `delivery.manage`.
  - Rà soát `listLabels` (`src/modules/supplier-order/supplier-order.service.ts`, `supplier-order.repository.ts`) và `delivery-trace` (`delivery-trace.repository.ts`, `delivery-trace.service.ts`): đọc từng `DeliveryItem` theo `id asc` không collapse theo `ingredientId`/`supplyRequestItemId`, render nguyên stored `qrUrl` cả khi đơn đang `PREPARING`, giữ allowlist đúng 8 field công khai và legacy `409`/`404`.
  - `tests/supplier-order-creation.test.ts`, `tests/delivery-trace.test.ts`, `tests/supplier-order-creation.integration.test.ts`: cập nhật test quyền read OR (`view`/`manage`/`receive` → `200`, thiếu quyền/sai org → `403`, foreign → `404`), cập nhật `"Đang giao hàng"`, và bổ sung case `6A+4B` `PREPARING` không gộp nhãn/QR, giữ nguyên `traceUrl` sau `dispatch`, và test quét QR 8 fields công khai trước khi giao.
- **Kiểm chứng focused (`T137`)**:
  - `npx tsx --test tests/supplier-order-creation.test.ts tests/delivery-trace.test.ts tests/delivery-status.test.ts`: PASS **26/26** (`2` cases `delivery-status`, `6` cases `delivery-trace`, `18` cases `supplier-order-creation`; `0` fail, `0` skipped).
  - `npx tsc --noEmit`: PASS **0 lỗi**.
  - `npx eslint src/utils/resource-access.ts src/modules/delivery-trace/*.ts tests/delivery-trace.test.ts tests/supplier-order-creation.test.ts tests/supplier-order-creation.integration.test.ts`: PASS **0 lỗi/0 cảnh báo**.
  - **Phạm vi chưa chạy ở T137**: Quét QR/reprint thật trên PostgreSQL sẽ được chạy tại `T154`–`T155`.

### Phase 7: US5 — Kiểm nhận để hoàn thành hoặc giao lại (`T138`–`T142`)

- **Triển khai (`T138`–`T141`)**:
  - `src/modules/delivery/delivery.repository.ts`: select nội bộ `workflowVersion` và `SupplyRequestItem.IngredientEntry.{ingredientId,status}` không tự expose ra `DeliveryInspectionDTO`; bổ sung `listRequestSourceItems`, `receivedItemsBySourceIds` (`excludeDeliveryId`), `findSchoolIngredientEntries` (batch theo `distinct ingredientIds`); thêm `"PREPARING"` vào `cancelRemainder` (giữ metadata `expectedArrivalAt`/`vehiclePlate` giữ nguyên null/có sẵn và giữ nguyên `RECEIVED`/history).
  - `src/modules/delivery/delivery.service.ts`: gom `assertReceipt` + `verifyRequestDeliveryReceipt` sau lock/reload: standalone dùng batch `findSchoolIngredientEntries` hỗ trợ lặp `ingredientId` chung một `ACTIVE` entry không gộp lô; `REQUEST` nhóm theo `supplyRequestItemId` và cộng `previous RECEIVED` đúng 1 lần/group; riêng `workflowVersion === 2` kiểm full coverage toàn bộ source items, `currentGroup.eq(requested)`, exact identity (`ingredientId`, `ingredientEntryId`, `unit` — không convert unit khi lệch) và cặp `(ingredientId, sourceFacilityId)` duy nhất; legacy/v1 giữ partial receipt + `convertQuantity`; không recheck `sourceFacility.status === "ACTIVE"` sau chuẩn bị.
  - `tests/delivery-inspections.test.ts`, `tests/supplier-order-creation.integration.test.ts`, `tests/authorization.integration.test.ts`: cập nhật mock/công thức hai chặng `T090`, bổ sung đủ cases `T138` & `T141` (`PREPARING` 409, `6+4` 4-role receipt, `6+6` / missing group / wrong identity / wrong unit / `previous+current` rollback, inactive source sau chuẩn bị, standalone repeated ingredient, legacy partial conversion, `cap3` hủy `PREPARING` & `IN_TRANSIT`).
- **Kiểm chứng focused (`T142`)**:
  - `npx tsx --test tests/delivery-inspections.test.ts tests/delivery-status.test.ts tests/intake-access.test.ts`: PASS **53/53** (`0` fail, `0` skipped).
  - `npx tsc --noEmit`: PASS **0 lỗi**.
  - `npx eslint src/modules/delivery/*.ts tests/delivery-inspections.test.ts tests/supplier-order-creation.integration.test.ts tests/authorization.integration.test.ts`: PASS **0 lỗi/0 cảnh báo**.
  - **Phạm vi chưa chạy ở T142**: Concurrency 4-role receipt/rollback/cap3/legacy integration thật trên PostgreSQL sẽ được chạy tại `T154`.
- **Phase 8 — US3 Reopen / Read / Filter / Replay / NextAction (`T143`–`T148`)**:
  - `T144` (`src/modules/supplier-order/supplier-order.validation.ts` & `supplier-order.repository.ts`): bổ sung `"PREPARING"` vào `supplierOrderListQuerySchema.status`; giữ trusted supplier scope, `limit + 1`, `id asc` cho `deliveryItems`, chọn đủ `workflowVersion` và trạng thái nguồn `SupplyRequest` để tính `nextAction`, không N+1 và không trộn yêu cầu `ACCEPTED` chưa có `Delivery` vào danh sách quản lý.
  - `T145` (`src/modules/supplier-order/supplier-order.service.ts` & `supplier-order.response.dto.ts`): giữ tích hợp mapper chung `T117` cho summary/detail (`workflowVersion`, `SupplyRequest.status`, `nextAction`, metadata null khi `PREPARING`/hủy trước dispatch, legacy `workflowVersion: null` và `STANDALONE` không `CONFIRMED`, bảo toàn từng allocation UUID không collapse, safe DTO không `qrToken`/`photoHash`/`creationFingerprint`/`qrImageDataUrl`/`created`).
  - `T143`, `T146`, `T147`: hoàn thiện unit tests tại `tests/supplier-order-creation.test.ts` & `tests/supply-order-intake.test.ts` (sửa kiểm tra `_count.deliveries !== 1 || deliveries.length !== 1` tại `src/modules/supply-order/supply-order.service.ts` để đơn mixed/legacy luôn trả `orderProgress: null`, mở khóa nhánh `delivery.receive` read OR và kiểm tra 1-query list không N+1) và bổ sung integration tests `T147` trong `tests/supplier-order-creation.integration.test.ts`.
  - `T148` focused run (`task-1007`):
    - `npx tsx --test tests/supplier-order-creation.test.ts tests/supply-order-intake.test.ts`: PASS **41/41** (0 fail, 0 skipped).
    - `npx tsc --noEmit`: PASS (0 lỗi).
    - `npx eslint src/modules/supplier-order/*.ts src/modules/supply-order/*.ts tests/supplier-order-creation.test.ts tests/supply-order-intake.test.ts tests/supplier-order-creation.integration.test.ts`: PASS **0 lỗi/0 cảnh báo**.
    - **Phạm vi chưa chạy ở T148**: Integration tests thật với PostgreSQL cho `T147` (20 intents, race, canonical v3 replay/409, post-dispatch/terminal replay không cần renderer/source ACTIVE, retry 503) sẽ được chạy tại `T154`.
- **Phase 9 — Docs, Audit, CI Wiring & Offline Quality Checks (`T149`–`T152`)**:
  - `T149` (Docs & rollout/rollback): đã cập nhật `docs/AUTHORIZATION.md`, `src/modules/README.md`, `README.md`, `database/SCHEMA_BASELINE.md` cho mô hình `workflowVersion = 2` (`PREPARING` -> `POST /:id/dispatch` -> `IN_TRANSIT`), multi-source allocations & pair uniqueness (`uq_delivery_items_ingredient_source`, `uq_delivery_items_legacy_ingredient`, `uq_delivery_items_legacy_request_item`), tìm trường linked qua `GET /options/schools?search=...` (`delivery.manage`, safe `{ id, code, name }`), `STANDALONE` không `CONFIRMED`, `GET /:id/labels` quyền đọc **OR**, sửa lại mô tả `cap3` (áp dụng cho mọi đơn `REQUEST` kể cả `v1`/legacy, chỉ `STANDALONE` không đếm), thứ tự rollout (enum `20261118000200` -> `workflow_version`/CHECK/3 partial indexes `20261118000300` -> dừng writer cũ -> app/client mới; rollback app cần compatibility review, không gộp QR hay khôi phục full unique cũ) và trạng thái deployment thực tế (chưa deploy/seed).
  - `T150` (Architecture & downstream audit):
    - Đã kiểm tra ranh giới layer ở `supplier-order`, `supply-order`, `account-lifecycle`, `delivery`, `delivery-trace`: service chỉ điều phối một transaction với live recheck (`assertDeliveryContinuation`, `assertAccess`), parent/entity locks (`lockParents` dùng `FOR UPDATE` theo thứ tự UUID xác định và `FOR SHARE` trên role, `lockSupplierForDeliveryNumber`, `lockSourceFacilities`), và CAS (`dispatchDelivery`); service không dựng Prisma query args và controller/repository không import Request/Response DTO.
    - Đã kiểm tra `src/modules/warehouse/warehouse.repository.ts`, `src/modules/kitchen/kitchen.repository.ts`, `src/modules/menu/menu.repository.ts` và chạy `npx tsx --test tests/kitchen-nutrition-lists.test.ts`: PASS **15/15** (`0` fail, `0` skipped); không có logic collapse dòng/lô theo `ingredientId`/`supplyRequestItemId` hay tham chiếu full unique selector cũ.
    - Đã xác nhận tìm trường `listSchoolOptions` escape literal `\`, `%`, `_`, kết hợp `AND` eligibility/scope, giữ schema riêng không mở `search` sang options/labels khác; receipt gom Decimal theo `supplyRequestItemId` + batch queries (không N+1); QR giữ bất biến từ `qrUrl` đã lưu và giữ nguyên bản ghi legacy `workflowVersion = null`/`traceabilityVersion = null`.
  - `T151` (CI & runner wiring): đã rà `package.json`, `.github/workflows/ci.yml`, `tests/helpers/run-local-tests.ts`: toàn bộ file unit (`supply-order-intake`, `delivery-inspections`, `intake-access`, `kitchen-nutrition-lists`, `supplier-order-creation`, `delivery-code`, `public-trace-config`, `qr-code`, `delivery-status`, `delivery-trace`) đã có trong `test:unit`; các nhóm disposable (`migrations`, `authorization`, `lifecycle`, `supplier-orders`) đều đã nối đủ trong CI và runner local, không chứa Azure credentials ở quality job và không thêm package/container mới.
  - `T152` (Offline validation run sau format 13 tệp thuộc feature):
    - `npm run prisma:validate`: PASS (`prisma/schema.prisma` valid).
    - `npm run prisma:generate`: PASS (Prisma Client 7.10.1).
    - `npm run validate` (`lint`, `format:check`, `typecheck`, `build`): PASS (**0 lỗi / 0 cảnh báo**).
    - `npm run test:unit`: PASS **575/575** (`4` suites, `0` fail, `0` skipped, `0` cancelled).
  - `T153` (PostgreSQL local cô lập `127.0.0.1:5433` — phiên bản `18.6`):
    - `npm run test:local:check`: PASS (`PostgreSQL local 127.0.0.1:5433, version 18.6, database foodprint_migration_test`).
    - Sau khi bổ sung `STANDALONE` + `ROLLBACK` cho ca kiểm tra preflight `P0001` ở `tests/migrations.test.ts`, chạy `npm run test:local:migrations`: PASS **20/20** (`0` fail, `0` skipped, `0` cancelled), dọn sạch **12/12** database tạm trong lần chạy (`7` do runner dọn). Xác minh fresh deploy, replay/baseline immutability, thứ tự enum `PREPARING` trước `workflow_version`/CHECK/3 partial unique indexes, và bảo toàn bản ghi `legacy`/`v1`.
  - `T154` (PostgreSQL `18.6` cô lập tại `127.0.0.1:5433` + Redis `7` local qua `tests/helpers/run-local-tests.ts`):
    - Các khắc phục thực sự phát sinh khi chạy với DB thật:
      - `src/modules/account-lifecycle/intake-access.repository.ts` & `intake-access.service.ts`: đổi `readSchoolAdmin`/`readSupplierAdmin` sang truy vấn tuần tự với `FOR SHARE` sau `lockParents` để giao dịch `SERIALIZABLE` (`authorizationTransaction`) phát hiện xung đột `40001`/retry khi `lifecycle.deactivate` vô hiệu hóa admin bên đối tác trong lúc `dispatch` chạy song song.
      - `tests/account-lifecycle.integration.test.ts` (`T131`): tách hai barrier riêng: `lifecycle.deactivate(schoolAdmin)` kiểm tra race `dispatch` thất bại `409 businessConflict` và giữ replay thành công bởi `supStaff`; và `lifecycle.deactivate(supAdmin)` (vô hiệu hóa cả org supplier) kiểm tra race `dispatch` bị chặn `assertBlocked` (`403`/`409`) không ghi dữ liệu.
      - `tests/supplier-order-creation.integration.test.ts`: sửa kỳ vọng thứ tự UUID `orderBy: [{ id: "asc" }]` & `Decimal.toString()` (`"6"`/`"4"`, `lot.receivedQuantity === item.actualQuantity`), trỏ kiểm tra `PREPARING` public trace đúng token của `DeliveryItem`, tránh trùng chuỗi `deliveryNo` ở `seedLegacyCapDelivery`, và sửa đường dẫn `GET /api/supply-requests` (thay `/api/supplier/orders`).
    - Kết quả chạy lại sau sửa đổi:
      - `npm run test:local:lifecycle`: **PASS 27/27** (`0` fail, `0` skipped, `0` cancelled; retries transaction tự động xử lý qua `authorizationTransaction`; dọn sạch **2/2** database tạm, `1` do runner dọn).
      - `npm run test:local:supplier-orders`: **PASS 1/1** (`0` fail, `0` skipped, `0` cancelled, `7319.57ms`; kiểm đủ search tenant/eligibility/wildcard `\ % _` + recheck `409`, 20+20 create đồng thời + `FP-DE-99999 -> FP-DE-100000`, `6A+4B` distinct QR `PREPARING`, replay `v3` & `dispatch`, grouped budget `6+6`/`previous+current`/legacy partial, 4 role `exactly-once` & `cap3` hủy `PREPARING`; dọn sạch **2/2** database tạm, `1` do runner dọn).
      - `npm run test:local:authorization`: **PASS 47/47** (`0` fail, `0` skipped, `0` cancelled, Redis kết nối thành công; dọn sạch **3/3** database tạm).
  - `T155` (HTTP API walkthrough hai mode & giải mã QR độc lập trên PostgreSQL `18.6` cô lập tại `127.0.0.1:5433` + Redis `7`):
    - **Phương pháp & giới hạn trung thực**: Chạy kịch bản HTTP end-to-end (Express app + DB tạm tạo bởi `createLifecycleTestDatabase` + cleanup tự động trong `finally`) và bộ giải mã QR pixel độc lập chuẩn ISO/IEC 18004 + kiểm chứng Reed-Solomon GF(256) bằng `python3` + `PIL` trong thư mục scratch ngoài repository; **không cài package/framework mới, không giả ngày lô (`manufactureDate`/`expiryDate` = `null`), không chạy UI E2E browser hay quét bằng camera vật lý**. Kết quả JSON: `walkthrough: "T155_PASS"`, `decodedQrCount: 5`, `distinctDecodedUrls: 5`, `allRsValid: true`, `reprintByteIdentical: true`, `supplyRequestsTotal: 1`, `receiptTxCount: 3`.
    - **Mode `REQUEST`**: `POST /api/supply-requests/:id/accept` giữ trạng thái `ACCEPTED` và `orderProgress` (`stage: "CONFIRMED"`, `"Đã xác nhận"`, `nextAction: "ADD_INGREDIENTS"`); thử tổng `6+3=9` và `6+5=11` đều bị chặn `409`, thử nguồn trùng ở dòng thứ 3 bị chặn `400`; phân bổ `6A+4B` tạo đơn `FP-DE-00001` (`201 PREPARING`, `workflowVersion: 2`, `traceabilityVersion: 1`, `expectedArrivalAt: null`, `vehiclePlate: null`), 2 `PLAN-01` lots ở trạng thái `BLOCKED` (`manufactureDate: null`, `expiryDate: null`, `availableQuantity: "0"`); thử `arrival` trước dispatch bị `409`; mở lại `GET /api/deliveries/management/:id` & `GET /api/supply-requests/:id` ở `PREPARING` trả `nextAction: "ENTER_SHIPPING"`; in nhãn & in lại giữa `supStaff`/`supAdmin` giống nhau từng byte PNG (`reprintByteIdentical: true`), bộ giải mã ISO/IEC 18004 trích xuất đúng 2 URL riêng khớp từng dòng và API công khai 8 trường (`actualQuantity: "6"/"4"`, đúng `sourceFacility`); thiếu shipping `POST /:id/dispatch` → `400`, đủ shipping → `200 IN_TRANSIT` (`expectedArrivalAt` UTC, `vehiclePlate` trimmed); `arrival` → 4 vai trò kiểm nhận `APPROVE` → `RECEIVED` và sinh `2` bản ghi `InventoryTransaction` (`RECEIPT`); post-terminal create/dispatch replay trả `200` giữ `RECEIVED` và `updatedAt`, khác body trả `409`; mở lại detail/source giữ `RECEIVED` (`nextAction: "VIEW_DELIVERY"`).
    - **Mode `STANDALONE`**: `GET /api/deliveries/management/options/schools?search=` (`hoa` và ký tự literal `100%_test\vn`) chỉ trả `[schoolHoa.id]` và giữ `supplyRequestsTotal === 1` (không tạo `SupplyRequest` hay `CONFIRMED`); thử nguồn trùng ở dòng thứ 3 bị chặn `400`; tạo đơn `6A+4B` (`garlicSa`) → `201 PREPARING` (`sourceType: "STANDALONE"`, `supplyRequestId: null`, `nextAction: "ENTER_SHIPPING"`, hoàn toàn không qua `CONFIRMED`); mở lại `GET` giữ `PREPARING`; lấy nhãn và giải mã 2 QR (`rsValid: true`), quét công khai HTML (`"Đang chuẩn bị hàng"`) & JSON 8 trường khớp từng nguồn/số lượng; `dispatch` → `arrival` → `REJECT` → `REJECTED`; lập đơn `STANDALONE` giao lại mới (`10kg facB`) không qua `CONFIRMED` → `PREPARING` → giải mã QR (QR thứ 5/5 `rsValid: true`) → `dispatch` → `arrival` → 3 chữ ký đạt `200` → chữ ký thứ 4 trả `409` khi trường chưa tạo `IngredientEntry` → tạo `IngredientEntry` `ACTIVE` cho trường → thử lại chữ ký thứ 4 trả `200 RECEIVED` (tổng `receiptTxCount: 3`); post-terminal replay `saCreateKey` trả `200 REJECTED`, mở lại hai đơn sau terminal & quét công khai xác nhận `RECEIVED` với `"10"`.
  - `T156` (Chạy lại toàn bộ harness DB sau chỉnh sửa code/test cuối cùng, đối chiếu `FR-001`–`FR-035` / `SC-001`–`SC-014` & rủi ro rollout):
    - **Kiểm chứng tổng hợp sau sửa đổi `.ts` cuối cùng** (`tests/account-lifecycle.integration.test.ts` bỏ biến không dùng `supAdmin`):
      - `npm run test:local` trên PostgreSQL `18.6` (`127.0.0.1:5433`, DB điều phối `foodprint_migration_test`) + Redis `7`:
        - `unit`: **PASS 575/575** (`4` suites, `0` fail, `0` skipped, `0` cancelled).
        - `migrations`: **PASS 20/20** (`0` fail, `0` skipped, `0` cancelled).
        - `authorization`: **PASS 47/47** (`0` fail, `0` skipped, `0` cancelled).
        - `lifecycle`: **PASS 27/27** (`0` fail, `0` skipped, `0` cancelled).
        - `supplier-orders`: **PASS 1/1** (`0` fail, `0` skipped, `0` cancelled).
        - Đã kiểm tra/dọn sạch **16/16** database tạm (`9` do runner dọn).
    - **Đối chiếu `FR-001`–`FR-035` & `SC-001`–`SC-014` (`spec.md` ↔ `plan.md` ↔ `data-model.md` ↔ `contracts/` ↔ `tasks.md` ↔ bằng chứng mới)**:
      - **Quyền, scope & hai cách tạo (`FR-001`–`FR-004`, `FR-007`–`FR-013`, `FR-035`, `SC-001`, `SC-003`, `SC-012`)**: Đã kiểm chứng trên 2 role nhà cung cấp (`SUPPLIER_ADMIN`/`STAFF`), live membership/permission recheck, phân lập tenant (`404`/`403`) qua `test:local:authorization`, `test:local:lifecycle`, `test:local:supplier-orders`.
      - **Workflow từng bước & không `CONFIRMED` cho `STANDALONE` (`FR-006`, `FR-025`–`FR-031`, `SC-008`, `SC-011`, `SC-012`)**: `accept` giữ receipt 4 trường & `orderProgress: CONFIRMED`; `create` chuyển `PREPARING` (`workflowVersion: 2`, metadata null); `POST /:id/dispatch` lưu `expectedArrivalAt` (offset→UTC) + `vehiclePlate` (trim 1..40) bằng CAS chuyển `IN_TRANSIT`; `STANDALONE` đi thẳng chọn trường → thêm nguyên liệu → `PREPARING` → `dispatch` không qua `CONFIRMED`; mở lại trả đúng `nextAction`.
      - **Phân bổ đa nguồn & uniqueness theo cặp (`FR-005`, `FR-014`, `FR-032`, `FR-033`, `SC-002`, `SC-013`)**: Ba partial unique indexes (`uq_delivery_items_ingredient_source`, `uq_delivery_items_legacy_ingredient`, `uq_delivery_items_legacy_request_item`), kiểm từng tổng theo nhóm `Decimal`, chặn cặp trùng (`400`/`409`), cho cùng nguyên liệu khác nguồn (`6A+4B`) và khác nguyên liệu cùng nguồn.
      - **Tìm trường linked (`FR-034`–`FR-035`, `SC-014`)**: `GET /api/deliveries/management/options/schools?search=` (`SupplierSchoolOptionsQueryDTO` strict, trim max `100`, escape `\`, `%`, `_`, insensitive partial `name` OR `code`, `AND` eligibility/supplier scope, zero ghi state, recheck live lúc `POST`).
      - **Compound replay v3, mã `FP-DE-`, nhãn QR read OR & public 8 fields (`FR-015`–`FR-018`, `FR-029`, `SC-004`–`SC-007`)**: Sorted allocation canonical `v3` replay/409, per-supplier sequence (`FP-DE-00001+`, `99999 -> 100000`, `20+20` tạo đồng thời), `GET /:id/labels` quyền đọc OR (`T134` đã đồng bộ đúng [contracts/supplier-orders.md](contracts/supplier-orders.md)), QR bất biến ngay `PREPARING`, public allowlist 8 fields HTML/JSON & token log redaction.
      - **Kiểm nhận gộp theo nguồn & bảo toàn legacy (`FR-019`–`FR-024`, `SC-009`–`SC-010`)**: Chặn `arrival`/`inspection` ở `PREPARING` (`409`), kiểm đủ tập source items + `previous RECEIVED + currentGroup = requested` + exact identity/distinct pairs cho `workflowVersion: 2`, `STANDALONE` tự gắn `IngredientEntry` `ACTIVE` ở chữ ký thứ 4 không gộp lot, `exactly-once` receipt + rollback, giữ `legacy` partial (`workflowVersion: null`, `convertQuantity`) và `cap3` hủy `PREPARING`/`IN_TRANSIT` bảo toàn `RECEIVED`.
    - **Tính nguyên vẹn lịch sử & sạch git tree**: [tasks-baseline.md](tasks-baseline.md) (`git diff` rỗng) và [tasks-traceability.md](tasks-traceability.md) được giữ nguyên trạng thái lịch sử không chỉnh sửa; working tree chưa commit/push/deploy, không chứa `.env*`, credentials, `.specify/feature.json` hay artifact sinh tự động.
    - **Rủi ro rollout client/migration & phần ngoài phạm vi thực thi**:
      1. _Thứ tự migration & rollback_: Phải triển khai & commit `20261118000200_delivery_preparing_status` (`ADD VALUE 'PREPARING'`) trước `20261118000300_supplier_order_stages` (`workflow_version`, CHECK constraints, 3 partial unique indexes, gỡ 2 full uniques cũ). Dừng writer cũ tạo thẳng `IN_TRANSIT` trước khi bật `workflowVersion = 2`; sau khi phát sinh dữ liệu đa nguồn, rollback ứng dụng cần rà tương thích trước và **không** khôi phục 2 full uniques cũ hoặc gộp QR.
      2. _Phối hợp client_: Frontend/API client cần cập nhật luồng `REQUEST` (`accept -> create PREPARING -> dispatch -> IN_TRANSIT`) và `STANDALONE` (`options/schools?search= -> create PREPARING -> dispatch`, không qua `CONFIRMED`), giữ nguyên `Idempotency-Key` + body khi retry `create`, giữ `delivery.id` + cặp `expectedArrivalAt`/`vehiclePlate` khi retry `dispatch`, xử lý lỗi field path `400` / xung đột `409`, và bảo đảm trường tạo `IngredientEntry` `ACTIVE` trước chữ ký thứ 4 của đơn `STANDALONE`.
      3. _Tác vụ ngoài phạm vi_: Chưa triển khai lên Azure PostgreSQL (`db:migrate:deploy --azure`), chưa chạy seed/production `auth:bootstrap`, chưa kiểm tra UI frontend E2E hay quét camera vật lý trên điện thoại (`T155` chỉ dùng HTTP API + bộ giải mã `PIL`), và `npm run spec:check` CLI chỉ chạy khi truyền `SPEC_GATE_BASE_SHA`/`SPEC_GATE_HEAD_SHA` của commit git (thay bằng `npm run test:spec-gate` 26/26 và đánh giá `evaluateSpecGate` trên working tree hiện tại).

---

## Lịch sử kiểm chứng baseline — không phải kết quả amendment

Các ghi nhận dưới đây thuộc bản triển khai trước nguồn/QR/mã mới; giữ để review lịch sử, không tái sử dụng làm kết quả của kế hoạch này.

## Verification Evidence (Implementation Run — 2026-11-15)

### Infrastructure-Free Checks (Executed & Passed After Final Code Edit)

- `npm run prisma:validate`: **PASS** (`prisma/schema.prisma` valid).
- `npm run prisma:generate`: **PASS** (Generated Prisma Client 7.10.1 to `./src/generated/prisma`).
- `npm run validate`: **PASS** (`eslint . --max-warnings=0`, `prettier --check .` ("All matched files use Prettier code style!"), `tsc --noEmit`, and `prisma generate && tsc -p tsconfig.build.json` all exited with code 0 and 0 warnings/errors).
- `npm run test:unit`: **PASS** (`526/526` tests passed, `0` failed, `0` skipped, including `tests/supplier-order-creation.test.ts`, `tests/intake-access.test.ts`, `tests/delivery-inspections.test.ts`, `tests/kitchen-nutrition-lists.test.ts`, `tests/authorization.test.ts`, `tests/modules.test.ts`, and `tests/spec-gate.test.mjs`).
- `git status --short`: Clean feature delta (`specs/supplier-order-creation/`, `prisma/`, `database/SCHEMA_BASELINE.md`, `docs/AUTHORIZATION.md`, `src/modules/README.md`, `src/modules/supplier-order/`, downstream module & test updates); `.specify/feature.json` is not present.

### Blocked PostgreSQL Verification (`T033` — Not Executed)

- **Blocker**: `MIGRATION_TEST_DATABASE_URL` is unset (`printenv MIGRATION_TEST_DATABASE_URL | wc -c` returned `0`), and `.env` / Azure PostgreSQL must not be used for disposable migration/integration runs.
- **Compiled & Formatted, Pending PostgreSQL Execution**:
  - `npm run test:migrations` (`tests/migrations.test.ts`)
  - `npm run test:authorization` (`tests/authorization.integration.test.ts`)
  - `npm run test:account-lifecycle:integration` (`tests/account-lifecycle.integration.test.ts`)
  - `npm exec --no -- tsx --test tests/supplier-order-creation.integration.test.ts`
  - `npm exec --no -- tsx --test tests/kitchen-nutrition-wire.integration.test.ts`

### Architecture & Contract Conformance (`T036`, `T038`)

- Verified `src/modules/supplier-order/` preserves strict controller/service/repository/validation/DTO separation (`*.request.dto.ts` and `*.response.dto.ts` imported only in `supplier-order.service.ts`; `creationKey` and `creationFingerprint` never exposed in API DTOs).
- Verified `/api/deliveries/management` is mounted before `/api/deliveries` in `src/routes/index.ts`.
- Verified `docs/AUTHORIZATION.md` and `src/modules/README.md` document all 5 endpoints, roles (`INGREDIENT_SUPPLIER_ADMIN`, `INGREDIENT_SUPPLIER_STAFF`), permissions, idempotency, and canonical `Delivery.schoolId` / `DeliveryItem.ingredientId` / `DeliveryItem.ingredientEntryId` handling.

## Regression fix — file migration test sau merge

- Lỗi đã tái hiện: `TransformError` tại `tests/migrations.test.ts:1546`, `Unexpected "<<"` do sáu dấu conflict merge bị commit vào file. Test chưa chạy được tới bước kết nối PostgreSQL.
- Đã khôi phục thành hai subtest riêng, giữ nguyên assertions của single-dish batch và supplier-order migration. Fixture supplier-order đặt search_path trước replay migration cũ, đóng kết nối và dọn đúng database con do nó tạo. Không sửa migration đã có hoặc source production.
- `npm run test:migrations` trên PostgreSQL18 tạm riêng: PASS 18/18, fail0, skipped0. Bao gồm fresh deploy/schema diff, giữ lịch sử nhiều delivery/request và các CHECK/unique mới.
- ESLint file test, Prettier, `git diff --check`: PASS. `npm run prisma:generate` rồi `npm run typecheck`: PASS. Lần typecheck đầu dùng generated client cũ thiếu photo fields; sinh lại client đã khắc phục, không hand-edit generated code.
- Instance disposable của lần sửa: container `foodprint-migration-fix-test`, bind127.0.0.1:55433. Container đã dừng/tự xóa sau suite; không dùng DB thành viên hoặc Azure. Log: `/tmp/foodprint-migration-fix.log`.
- Kết quả này cập nhật riêng mục migration trong T033; các suite authorization/lifecycle/supplier-order/kitchen integration không được chạy lại trong lần sửa này và không được tự coi PASS.

## Regression fix — authorization CI fixtures

- CI báo fail4 gồm ba subtest và parent suite: fixture Delivery dùng creationMode REQUEST nhưng thiếu creationKey/fingerprint, vi phạm chk_delivery_creation_mode_source. Fixture kiểm nhận còn cần năm phiếu trên cùng nguồn, nên không thể chỉ thêm key/hash vì partial unique mới sẽ chặn.
- Ba fixture lịch sử trong tests/authorization.integration.test.ts được giữ source/canonical fields, chuyển creationMode null đúng chế độ lịch sử đã được migration hỗ trợ. Không nới CHECK hoặc unique; không đổi code runtime, quyền, nội dung assertions hoặc migration.
- npm run test:authorization: PASS46/46, fail0, skipped0 trên PostgreSQL18 disposable riêng foodprint-auth-fixture-test, port55433, và Redis local. Các kịch bản delivery-inspections, menu cooking và source-facility trong log CI đều PASS. Typecheck và ESLint hai file được rà soát đều PASS.
- Kiểm tra mở rộng suite kitchen-nutrition-wire phát hiện các lỗi fixture/contract độc lập đã tồn tại (school context có grades, query món ăn cũ bị400, fixture cooking batch dùng cấu trúc không còn hợp lệ). Thay đổi thử ở file này đã được hoàn nguyên; bản sửa CI chỉ sửa suite authorization. Không khẳng định suite kitchen PASS.
- Logs ở /tmp/foodprint-auth-fixture-authorization.log và /tmp/foodprint-auth-fixture-kitchen.log, ngoài repository. Container PostgreSQL thử đã dừng/tự xóa. Không dùng database Azure hoặc PostgreSQL thành viên.

## Local PostgreSQL setup evidence — 2026-11-15

Theo yêu cầu riêng của user, dùng PostgreSQL đã có trong DataGrip tại127.0.0.1:5433/user foodprint_admin, kiểm tra version18.6 và quyền CREATEDB; tạo mới database điều phối foodprint_migration_test. Không tạo container hoặc sửa DATABASE_URL của ứng dụng; credential ở .env.test.local bị gitignore, không ghi ở đây.

Đã thêm local runner/manifest registry trong tests/helpers và các script test:local, cùng hướng dẫn README mục12. Mỗi lần suite DB tạo base mới; các database con được ghi manifest sau CREATE thành công, dọn đúng tên/owner của lần đó. Test migrations chạy hai lần liên tiếp đều PASS18/18; mỗi lần kiểm/dọn10 DB tên đã ghi, trong đó runner dọn7 DB còn lại (3 đã được harness dọn). Authorization PASS46/46 và dọn3 DB, lifecycle PASS26/26 và kiểm/dọn2 DB, supplier-order baseline integration PASS1/1 và kiểm/dọn2 DB. Unit PASS543/543, trong đó5 unit test mới kiểm config local/URL encoding/name guards/manifest. Không có skipped trong các nhóm nêu trên.

Khi chạy supplier-order baseline, phát hiện fixture userPermissionDenial thiếu supplierId theo CHECK exactly-one-organization. Chỉ thêm supplierA.id vào fixture đó; giữ constraint và assertion403 khi quyền bị thu hồi. Lần chạy lại đạt1/1. Đây là sửa fixture để kiểm chứng local runner, không phải triển khai sources/QR của amendment.

ESLint các test/helper đã sửa, Prettier, typecheck và build đạt; Prisma generation không thay DB. Các kết quả này kiểm chứng setup local và baseline hiện có, không thay thế các kiểm chứng của T041–T098 hoặc tự đánh dấu triển khai amendment đã đạt. Nhật ký kiểm tra ở /tmp/foodprint-local-{migrations,migrations-repeat,authorization,lifecycle,supplier-orders,unit}.log trong workspace phiên này, không đưa credentials vào report.

## Amendment Setup Baseline & Contract Lock (T041–T043) — 2026-11-15

- **Nhánh & Spec baseline (T041)**: Đang thực thi trên nhánh `feat/supplier-order-creation-traceability`. Baseline `T001`–`T040` được giữ nguyên trạng tại [tasks-baseline.md](tasks-baseline.md) (`T033` chưa hoàn tất và được bao phủ lại bởi `T096`); danh sách triển khai hiện hành là `T041`–`T098` trong [tasks.md](tasks.md).
- **Dependency QR (T042)**: Đã cài `qrcode@^1.5.4` (runtime dependency) và `@types/qrcode@^1.5.6` (devDependency); kiểm chứng nạp CommonJS (`require("qrcode")`) và `tsx` ESM-interop (`import QRCode from "qrcode"`) đều trả về `function`.
- **Điều kiện test & Hạ tầng disposable local (T043)**:
  - PostgreSQL local disposable: `npm run test:local:check` PASS (`127.0.0.1:5433`, PostgreSQL `18.6`, database `foodprint_migration_test`, cấu hình qua `.env.test.local` với `schema=foodprint`, cô lập khỏi `.env` và Azure).
  - Redis local: `npm run redis:check` PASS (`PONG` trên `127.0.0.1:6379`; tests unit dùng `MemoryStore` tách biệt và prefix test riêng cho Redis integration).
  - `PUBLIC_TRACE_ORIGIN`: sẽ cấu hình injectable config cho test + validator startup trong `src/config/env.ts` và `src/server.ts` (không đọc header `Host` từ request).
- **Khóa chữ ký helper/repository/DTO (T043)**:
  - `src/utils/delivery-code.ts`: `DELIVERY_CODE_PREFIX = "FP-DE-"`, `DELIVERY_CODE_PATTERN`, `formatDeliveryCode(sequence: bigint): string`, `parseCanonicalDeliverySequence(code: string): bigint | null`.
  - `src/utils/qr-code.ts`: `generateDeliveryQrToken(): string` (32 bytes random -> hex64), `buildDeliveryTraceUrl(origin: string, token: string): string`, `renderDeliveryQrDataUrl(traceUrl: string): Promise<string>` (`width: 384`, `margin: 4`, `errorCorrectionLevel: "M"`), `renderDeliveryQrBatch(...)` (concurrency tối đa 4).
  - `src/utils/delivery-status.ts`: `getDeliveryStatusLabel(status: DeliveryStatus | string): string` dùng chung cho supplier/inspection/public (`IN_TRANSIT` -> `"Đang giao"`, `RECEIVED` -> `"Hoàn thành"`, `REJECTED` -> `"Yêu cầu giao hàng lại"`, giữ nhãn cho `CREATED`/`APPROVED`).
  - `src/modules/supplier-order/*`: Request/Response DTO tách hai file; validation strict theo [contracts/supplier-orders.md](contracts/supplier-orders.md); repository giữ scope `WHERE` và lock theo thứ tự nhất quán với `source-facility` và `intake-access`.
  - `src/modules/delivery-trace/*`: Public GET `/api/public/delivery-items/:token` theo [contracts/public-trace.md](contracts/public-trace.md) (allowlist JSON/HTML, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP/noindex, `406` khi `Accept` không hỗ trợ).
  - `src/modules/delivery/*`: `POST /api/deliveries/:id/arrival` (4 role kiểm nhận trường + `delivery.view` + `delivery.inspect`) và siết `assertReceipt` kiểm tra `lot.sourceFacilityId === item.sourceFacilityId` với đơn `traceabilityVersion === 1`.

### Tiến độ kiểm chứng unit theo Phase (2026-11-15)

- **Phase 2 helpers (`T047`–`T050`)**: PASS 11/11 (`delivery-code`, `delivery-status`, `public-trace-config`, `qr-code`).
- **Phase 2 locks/scopes & dependency mocks (`T052`)**: PASS 65/65 (`delivery-code`, `delivery-status`, `intake-access`, `public-trace-config`, `qr-code`, `source-facility-management`).
- **Phase 3 US1 (`T059`)**: `npm run typecheck` PASS; `tests/intake-access.test.ts` PASS 33/33; nhóm US1 trong `tests/supplier-order-creation.test.ts` PASS 5/5 (cùng 3/3 US2 và 2/3 US3; 1 case HTTP US3 đang giữ payload STANDALONE baseline thiếu mock `$queryRaw`, sẽ nâng cấp tiếp ở Phase 4 & Phase 7). Giới hạn: mock unit DB không thay cho kiểm thử PostgreSQL disposable ở `T096`.

- **Phase 4 US2 (`T060`–`T065`, STANDALONE v1)**: `npm run typecheck` passed (0 errors); `npm exec --no -- tsx --test tests/supplier-order-creation.test.ts tests/intake-access.test.ts` passed **44/44** (11/11 supplier-order unit/HTTP tests + 33/33 intake-access tests including `sourceFacilityIds` sorted lock order). Verified `STANDALONE` requires `sourceFacilityId` per item, `expectedArrivalAt`, `vehiclePlate`, disallows per-item `note`, starts at `IN_TRANSIT` with `statusLabel = "Đang giao"`, `traceabilityVersion = 1`, QR + snapshots (nullable `facilityCode`), `PLAN-01` `BLOCKED` lots, two distinct keys creating sequential `FP-DE-00001`/`FP-DE-00002`, and missing school `IngredientEntry` stored as `null` without auto-creating entries (**lưu ý**: final receipt tại Phase 6 `assertReceipt` vẫn yêu cầu trường gắn `IngredientEntry` `ACTIVE` trước khi ghi nhận nhập kho). Prerequisites tích hợp PostgreSQL thật sẽ chạy ở Phase 7/8 (`T089`–`T090`, `T096`).

- **Phase 5 US4 (`T066`–`T075`, Source options, Labels & Public Trace)**: `npm run typecheck`, `npm run test:rate-limit:redis` (**6/6** PASS sau khi sửa `RedisUnavailableError extends HttpError` tại `src/config/redis.ts` để fail-closed đúng HTTP 503), và `npm exec --no -- tsx --test tests/delivery-trace.test.ts tests/supplier-order-creation.test.ts tests/rate-limit.test.ts tests/qr-code.test.ts tests/delivery-status.test.ts` (**31/31** PASS). Verified `GET /api/deliveries/management/options/source-facilities` (ACTIVE scoped, nullable `facilityCode`, no `isVisible` filter, zero contacts), `GET /api/deliveries/management/:id/labels` (404 foreign before pagination, 409 legacy, stored `qrUrl` reprint không đổi URL/QR/DB, 503 khi render lỗi, không lộ `qrToken`), và public `GET/HEAD /api/public/delivery-items/:token` (HTML/JSON negotiation, 406 unsupported `Accept`, XSS escape, uniform 404 cho invalid/unknown/legacy, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `Content-Security-Policy: default-src 'none'...`, `/api/traceability-anchors` vẫn yêu cầu auth 401, Redis fail-closed 503, và redaction token trên access/error logs).

Kiểm tra kết nối bổ sung: `npm run db:check` với DATABASE_URL override riêng tới database điều phối local đã PASS qua Prisma/SELECT1. Không dùng cấu hình Azure của ứng dụng cho lệnh này.

### Phase 6 (US5) — Xác nhận đến nơi, kiểm nhận v1 và hoàn thành/giao lại (T076–T083)

- **Triển khai chính (`T077`–`T081`)**:
  - `src/modules/delivery/delivery.validation.ts`, `delivery.request.dto.ts`, `delivery.response.dto.ts`: thêm `deliveryArrivalBodySchema` / `deliveryArrivalQuerySchema` (`z.strictObject({})`, chuẩn hóa body rỗng `undefined -> {}` trước `parseRequest`, chặn field lạ/client timestamp/`lots` với `400`), thêm `traceabilityVersion`, `statusLabel` và `deliveryItems[].sourceFacility` (`id`, `name`, `facilityCode`) trên `DeliveryInspectionDTO` (giữ nguyên `DeliveryListItemDTO` cho các danh sách cũ).
  - `src/modules/delivery/delivery.repository.ts`, `delivery.service.ts`, `delivery.controller.ts`, `delivery.routes.ts`: mở endpoint `POST /api/deliveries/:id/arrival` tách biệt quyền bằng chuỗi middleware `requirePermission("delivery.view")` + `requirePermission("delivery.inspect")` (AND), tải lại actor/permissions/trường trong transaction, lock `supply_requests` -> `deliveries` -> sorted `ingredient_lots`, chỉ chấp nhận `traceabilityVersion === 1`, chặn đơn/nguồn đã hủy với `409`, CAS `IN_TRANSIT -> ARRIVED` với server `arrivedAt`, replay `200` khi đã ở `ARRIVED`/`PENDING_APPROVAL`/`RECEIVED`/`REJECTED` mà không hạ trạng thái hay đổi `arrivedAt`. Tại bước chốt chữ ký thứ 4 (`decide`), kiểm tra nguồn v1 (`lot.sourceFacilityId === item.sourceFacilityId` không bắt nguồn vẫn phải `ACTIVE` hồi tố), gắn `IngredientEntry` `ACTIVE` cho `STANDALONE`, cấp tồn kho/ghi `InventoryTransaction` (`RECEIPT`) một lần duy nhất trong cùng transaction.
- **Kiểm chứng (`T076`, `T082`, `T083`)**:
  - `npm run typecheck && npm exec --no -- tsx --test tests/delivery-inspections.test.ts tests/modules.test.ts` → **46/46 PASS, 0 lỗi TS** (gồm 15 test kiểm nhận + 31 test module hiện có; bao gồm HTTP/service arrival 4 vai trò trường + thiếu từng quyền `403`, legacy/hủy `409`, snapshot cơ sở sau đổi tên/ngừng hoạt động, rollback khi mismatch nguồn/thiếu entry/lỗi `receiveLot`, concurrent 4th APPROVE chỉ nhập kho 1 lần, replay `photoHash`, cap 3 lần từ chối và cách ly `STANDALONE`).

### Phase 7 (US3) — Xem kết quả và tránh tạo trùng (`T084`–`T090`)

- **Khắc phục đồng thời (`src/modules/supplier-order/supplier-order.service.ts`)**: chuyển transaction `create()` sang `ReadCommitted` kết hợp khóa hàng tường minh (`guard.assertAccess` + `lockSupplierForDeliveryNumber` `FOR UPDATE`) và retry tối đa 2 lần cho lỗi lock tạm thời (`P2034`/`40001`/`40P01`), giữ `HttpError` và `P2002`/`23505` bubble sạch để replay idempotency không bị `databaseOperation` nuốt thành `503`.
- **Kiểm chứng unit/controller/HTTP (`T084`–`T088`)**: `npm run typecheck && npm exec --no -- tsx --test tests/supplier-order-creation.test.ts` → **14/14 PASS** (gồm quyền đọc OR cho `INGREDIENT_SUPPLIER_ADMIN`/`STAFF`, `/options/source-facilities` đòi `delivery.manage`, summary không trả PNG/`qrToken`/`creationKey`, legacy vs `v1` nullable detail, `orderBy: [{ createdAt: "desc" }, { id: "asc" }]`, supplier khác cùng `deliveryNo` trả `404`, canonical v2 replay/conflict matrix, legacy `409`, lỗi render pre/post-commit giữ nguyên record đã commit).
- **Kiểm chứng tích hợp PostgreSQL & HTTP (`T089`–`T090`)**:
  - `npm run test:local:supplier-orders` (`tests/supplier-order-creation.integration.test.ts`): **1/1 PASS** trên PostgreSQL `18.6` (`3769ms`, dọn sạch DB tạm; race 20+20=40 giao tạo đồng thời giữa hai supplier sinh `FP-DE-00001`..`FP-DE-00020` mỗi bên và 40 `qrToken` 64-hex phân biệt, ranh giới `FP-DE-99999 -> FP-DE-100000`, replay/race `REQUEST`, retry khi render lỗi `503`, `INACTIVE`/`SUSPENDED` `409`, arrival -> 4 chữ ký -> rollback thiếu entry -> gắn entry -> `RECEIVED` + warehouse lot, snapshot bất biến sau đổi tên/dừng, public trace JSON/HTML không auth, `REJECT` -> `STANDALONE` thay thế, cross-tenant `404`, `userPermissionDenial` `403`).
  - `npm run test:local:authorization` (`tests/authorization.integration.test.ts`): **47/47 PASS** (`0` fail, `0` skip, dọn sạch 3 DB tạm; giữ toàn bộ fixture lịch sử `creationMode: null` / cap 3 cũ và bổ sung test HTTP `v1` end-to-end cho `REQUEST` arrival/reject -> `STANDALONE` thay thế -> rollback thiếu `IngredientEntry` tại chữ ký thứ 4 giữ lô `BLOCKED`/0 tồn kho -> gắn entry -> `RECEIVED` đúng 1 `InventoryTransaction` `RECEIPT` -> public allowlist 8 trường không lộ liên hệ/biển số/chữ ký).

### Phase 8 Audit Consumers (`T091`)

- Rà soát `src/modules/warehouse/warehouse.{repository,service}.ts`, `src/modules/kitchen/kitchen.{repository,service}.ts`, `src/modules/menu/menu.{repository,service}.ts` và `tests/kitchen-nutrition-lists.test.ts`: không có tra cứu/unique giả định toàn cục theo `deliveryNo` (chỉ chọn hiển thị `deliveryNo` trong `warehouse.repository.ts`), mọi scope dùng UUID/`schoolId`/`IngredientEntry`, giữ fallback `Ingredient -> IngredientEntry -> SupplyRequestItem` và `SourceFacility` snapshot. Chạy `npm exec --no -- tsx --test tests/modules.test.ts tests/kitchen-nutrition-lists.test.ts` → **46/46 PASS**.

### Phase 8 Tài liệu, CI, Review, Kiểm thử tích hợp, Walkthrough QR & Đối chiếu cuối (`T092`–`T098`)

- **Đồng bộ tài liệu (`T092`)**:
  - Đã cập nhật `.env.example`, `docs/AUTHORIZATION.md`, `src/modules/README.md` và `README.md`: ghi rõ 7 endpoint quản lý `/api/deliveries/management*` (gồm `/options/source-facilities` và `/:id/labels`), endpoint `POST /api/deliveries/:id/arrival` chỉ dành cho 4 vai trò kiểm nhận của trường, truy xuất công khai `GET /api/public/delivery-items/:token` (danh sách cho phép 8 trường, HTML/JSON, headers bảo mật, ẩn token khỏi log), bắt buộc `sourceFacilityId` / `vehiclePlate` / `expectedArrivalAt`, `statusLabel`, thứ tự rollout schema trước app và duy trì hostname đã in. Không thêm quyền ngầm hoặc seed tài khoản/dữ liệu mẫu.
- **Scripts & CI (`T093`)**:
  - `package.json`: bổ sung `tests/delivery-code.test.ts`, `tests/public-trace-config.test.ts`, `tests/qr-code.test.ts`, `tests/delivery-status.test.ts` và `tests/delivery-trace.test.ts` vào `test:unit`; thêm script `"test:supplier-orders:integration": "tsx --test tests/supplier-order-creation.integration.test.ts"`.
  - `.github/workflows/ci.yml`: chạy `npm run test:supplier-orders:integration` trong job PostgreSQL 18 + Redis 7 disposable hiện có, không đưa Azure credentials vào quality job và không đổi CD để seed.
- **Review phân lớp & bảo mật tĩnh (`T094`)**:
  - Đã kiểm tra `src/modules/supplier-order/`, `src/modules/delivery/`, `src/modules/delivery-trace/`, `src/utils/resource-access.ts`, `src/utils/qr-code.ts`, `src/utils/public-trace-html.ts`, `src/app.ts`, `src/routes/index.ts`, `prisma/schema.prisma` và migration `20261116000200_supplier_order_creation` / `20261118000100_supplier_delivery_traceability`:
  - `grep` xác nhận chỉ `*.service.ts` import `*.request.dto.ts` / `*.response.dto.ts`; controller và repository hoàn toàn không import DTO.
  - Không có service method mới nào dựng Prisma `where`/`select`/`include`/`orderBy` (`src/modules/delivery/delivery.service.ts` chỉ giữ lại nhánh baseline `getAll` gọi `readListPage` với `deliveryListSelect`).
  - Route công khai `/api/public/delivery-items/:token` không có endpoint list/search, không bypass kiểm nhận, không lộ thông tin liên hệ/xe/trường, token random 32-byte (hex64), URL đã lưu bất biến, log trong `src/app.ts` che token bằng `redactPublicTraceUrl`, response đặt `Cache-Control: no-store, private, max-age=0`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Content-Security-Policy`, `Vary: Accept` và HTML thoát ký tự qua `escapeHtml`. Migration tạo composite unique `uq_deliveries_supplier_no` trước khi bỏ `deliveries_delivery_no_key` và giữ đúng partial unique predicates.
- **Kiểm tra runtime, build, lint, format & unit (`T095`)**:
  - Môi trường & dependency ghi nhận từ `package.json` / runtime local: Node.js `v24.22.1`, npm `11.19.1`, `prisma` / `@prisma/client` / `@prisma/adapter-pg` `7.10.1`, `typescript` `6.0.3`, `tsx` `4.23.15`, `eslint` `10.13.0`, `prettier` `3.9.10`, `qrcode` `^1.5.4`, `@types/qrcode` `^1.5.6`, `express` `^4.21.2`, `zod` `4.6.7`, `pg` `^8.13.3`.
  - `npm run prisma:validate`: PASS.
  - `npm run prisma:generate`: PASS (`7.10.1`).
  - `npm run validate` (`eslint . --max-warnings=0`, `prettier --check .`, `tsc --noEmit`, `npm run build`): PASS (0 lỗi, 0 cảnh báo, không in secrets).
  - `npm run test:unit`: **565/565 PASS** (`4` suites, `0` fail, `0` skipped; mọi file unit mới đều thực thi case thực).
- **Kiểm tra tích hợp PostgreSQL 18.6 disposable & Redis 7 (`T096`, bao phủ phần còn thiếu của `T033`)**:
  - Instance local: PostgreSQL `18.6` (`127.0.0.1:5433`, DB điều phối `foodprint_migration_test`) và Redis (`127.0.0.1:6379`).
  - `npm run test:local:migrations`: **19/19 PASS** (`0` fail, `0` skip).
  - `npm run test:local:authorization`: **47/47 PASS** (`0` fail, `0` skip).
  - `npm run test:local:lifecycle`: **26/26 PASS** (`0` fail, `0` skip).
  - `npm run test:local:supplier-orders`: **1/1 PASS** (`0` fail, `0` skip).
  - `npm run test:rate-limit:redis`: **6/6 PASS** (`0` fail, `0` skip).
  - `npm run test:cache:redis`: **5/5 PASS** (`0` fail, `0` skip).
  - `npm run test:auth:redis`: **5/5 PASS** (`0` fail, `0` skip).
  - Mọi database tạm được harness dọn sạch theo tên sau khi `CREATE` thành công; không thay đổi database thành viên hay Azure.
- **Walkthrough nhãn QR & quét giải mã PNG độc lập (`T097`)**:
  - Thực hiện kịch bản HTTP thật trên DB PostgreSQL `18.6` tạm + Redis `7` (dùng decoder ảnh Python PIL chuẩn ISO/IEC 18004 + kiểm chứng Reed-Solomon GF(256) trong vùng scratch ngoài repo, kết quả `walkthrough: "T097_PASS"`):
  - Tạo đơn 3 dòng cho supplier thứ nhất (`FP-DE-00001`) và 2 dòng cho supplier thứ hai (`FP-DE-00001`), xác nhận 3 lô dự kiến (`PLAN-01`) có `status = BLOCKED`, `availableQuantity = "0"`, `manufactureDate = null`, `expiryDate = null` (không khai ngày lô giả).
  - Lấy nhãn phân trang (`page=1&limit=2`, `page=2&limit=2`, `page=1&limit=10`) và in lại trang 1 (`reprintByteIdentical = true`); giải mã cả 5 ảnh PNG (`384x384`, QR version `7`, Reed-Solomon hợp lệ) cho đúng 5 `traceUrl` phân biệt trùng khớp giá trị đã lưu (`totalPrintedItemsDecoded = 5`, `distinctQrUrlsDecoded = 5`).
  - Gọi URL công khai không đăng nhập với `Accept: text/html` và `Accept: application/json`: cả hai đều trả HTTP `200`, đầy đủ header bảo mật (`Cache-Control: no-store, private, max-age=0`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex, nofollow, noarchive`, CSP `default-src 'none'...`), JSON chỉ gồm đúng 8 trường được phép (`actualQuantity`, `deliveryNo`, `ingredientName`, `sourceFacility`, `status`, `statusLabel`, `supplierName`, `unit`), HTML escape ký tự đặc biệt và hiển thị `"Chưa có mã cơ sở"` khi `facilityCode` null, không lộ tên trường nhận/biển số xe/số điện thoại/lịch giao/chữ ký.
  - Đổi `PUBLIC_TRACE_ORIGIN` sang origin mới và in lại đơn cũ: QR cũ giữ nguyên URL origin ban đầu (`envChangePreservedOldUrl = true`), đơn kế tiếp của supplier thứ nhất mang mã `FP-DE-00002` dùng origin mới. Đưa cơ sở nguồn cung về `INACTIVE` và đổi tên nguyên liệu/cơ sở: truy xuất công khai đơn cũ vẫn trả HTTP `200` theo snapshot bất biến lúc tạo (`stoppedSourcePreservedSnapshot = true`).
- **Đối chiếu cuối & rủi ro/điều kiện triển khai (`T098`)**:
  - Đối chiếu [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md), [tasks.md](tasks.md), [contracts/supplier-orders.md](contracts/supplier-orders.md), [contracts/public-trace.md](contracts/public-trace.md), `FR-001`–`FR-024` và `SC-001`–`SC-010`: toàn bộ yêu cầu nghiệp vụ và tiêu chí chấp nhận đều có triển khai và bằng chứng kiểm chứng tương ứng. `npm run spec:check` (so với `dev`) PASS và `npm run test:spec-gate` đạt **26/26 PASS**. [tasks-baseline.md](tasks-baseline.md) giữ nguyên trạng thái lịch sử (`T033` do `T096` bao phủ); git working tree sạch khỏi `.env`, credentials, `.specify/feature.json` và output sinh tự động.
  - **Điều kiện tiên quyết & rủi ro rollout còn lại**:
    1. Phải triển khai migration PostgreSQL (`db:migrate:deploy`) trước khi bật writer v1 để có `uq_deliveries_supplier_no`, `traceability_version`, các cột snapshot/QR trên `delivery_items` và CHECK ràng buộc trước khi bỏ `deliveries_delivery_no_key`.
    2. Cấu hình `PUBLIC_TRACE_ORIGIN` là origin HTTPS công khai ổn định trước khi in nhãn thật, và tiếp tục duy trì DNS/route cho các hostname từng được in vì `qrUrl` lưu cố định theo từng dòng.
    3. CD không tự seed dữ liệu hay kích hoạt quyền; đảm bảo chạy `npm run auth:bootstrap` (hoặc cấp quyền hợp lệ qua quản trị viên) và trường có `IngredientEntry` `ACTIVE` trước khi chốt chữ ký nhận hàng thứ 4 cho đơn `STANDALONE`.
    4. Không tự downgrade `uq_deliveries_supplier_no` về unique toàn cục sau khi nhiều nhà cung cấp cùng sử dụng mã `FP-DE-00001`.

## Regression CI — T083 và cấu hình Cloudinary local (2026-11-15)

Máy dev có đủ ba biến CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET trong .env, nhưng job code_quality không truyền các biến này và không có .env local. Test T083 dùng photoPublicId giả và bị gọi vào documentStorage.download thật khi map inspection DTO, khiến test phụ thuộc cấu hình ký URL ngoài phạm vi kiểm nhận.

Đã mock documentStorage.download riêng trong TestContext của T083; mock được tự khôi phục khi test kết thúc. Giữ các assertion photoHash/reject/immutability/cap3/null-counter và thêm assertion URL ảnh replay lấy từ publicId đã lưu, không phải publicId mới gửi lại. Không thay runtime storage hoặc cấp Cloudinary secrets cho CI unit.

Bằng chứng: focused T083 tái hiện đúng503 trước sửa với cả ba biến CLOUDINARY rỗng; sau sửa focused1/1 PASS, toàn bộ npm run test:unit trong cùng điều kiện rỗng đạt565/565 (4 suites, fail0, skipped0). Typecheck và ESLint file test đạt; Prettier/diff check đạt. Log unit tại /tmp/foodprint-ci-cloudinary-unit.log; không cần dùng credentials thật để kiểm chứng bản sửa.

## Regression CI — schema diff sau migration supplier-order

Ca supplier-order stages chỉ deploy đến `20261118000300_supplier_order_stages` rồi so với schema hiện tại, trong khi schema đã có enum `retained_sample_event_type` và ba bảng version từ migration blockchain phía sau. Vì vậy `prisma migrate diff --exit-code` trả2 dù hai migration supplier-order đã áp dụng thành công.

Đã giữ các kiểm tra enum commit, workflow CHECK, ba partial unique indexes và dữ liệu legacy/v1 tại đúng mốc supplier-order. Sau các assertion này, test copy/deploy toàn bộ migration phía sau từ danh sách history hiện hành, xác nhận danh sách migration hoàn tất đầy đủ và snapshot legacy/v1 không đổi, rồi mới so với schema hiện tại. Không hardcode migration blockchain hoặc bỏ qua mã2; không sửa schema, SQL migration hay runtime ứng dụng.

Bằng chứng kiểm chứng mới:

- `npm run test:local:migrations`: PASS **20/20**, fail0, skipped0, cancelled0; gồm đúng ca lỗi CI và kiểm full schema diff. PostgreSQL local18.6 tại `127.0.0.1:5433`, target do harness tạo; kiểm tra/dọn **12 database** của invocation, trong đó7 do runner dọn. Không thao tác database ứng dụng/Azure.
- `npm run prisma:generate`, `npm run typecheck`, `npm run build`: PASS; client local đã được sinh lại theo schema hiện tại.
- `npm run test:unit`: PASS **601/601**,4 suites, fail0, skipped0; log tại `/tmp/foodprint-ci-stages-unit.log`. Lần gọi đầu bị sandbox chặn socket IPC của tsx (`EPERM`); đã chạy lại thành công ngoài sandbox.
- `npm run lint`, `npm run format:check`, ESLint/Prettier cho `tests/migrations.test.ts` và `git diff --check`: PASS.

## Regression CI — kiểm nhận cần multipart và ảnh (2026-11-16)

Các case mới trong `tests/supplier-order-creation.integration.test.ts` còn gửi JSON chỉ có `decision`, trong khi contract ảnh kiểm nhận yêu cầu multipart với trường `photo`. Controller trả400 vì thiếu ảnh trước khi service kiểm tra trạng thái, nên assertion PREPARING409 thất bại tại dòng1409; các case APPROVE/REJECT phía sau cũng dùng payload cũ.

Đã chuyển các request nghiệp vụ này sang helper `inspectionForm` hiện có, mỗi lần gửi tạo FormData riêng có ảnh JPEG. Giữ một request JSON riêng để kiểm thiếu ảnh400, rồi gửi đủ ảnh để kiểm PREPARING409, không có approval, trạng thái vẫn PREPARING và ảnh tạm được dọn. Helper tạo fixture cho các ca receipt lỗi giờ kiểm200 của từng quyết định đầu tiên, tránh tiếp tục với fixture chưa có đủ ba chữ ký. HTTP/authorization/PostgreSQL vẫn chạy thật, chỉ external photo storage được mock như trước.

Kiểm chứng mới: `npm run test:local:supplier-orders` PASS **1/1**, fail0, skipped0, cancelled0 trên PostgreSQL local18.6 qua harness hiện có; đã kiểm tra/dọn2 database của invocation, trong đó1 do runner dọn. Suite chạy hết các ca PREPARING, split6+4, concurrent final approval, grouped budget rollback, legacy partial receipt và cap3. Log tại `/tmp/foodprint-ci-supplier-orders-integration.log`. Typecheck/build và ESLint file test cũng PASS.

Kiểm tra hồi quy toàn bộ: `npm run test:unit` PASS **601/601**,4 suites, fail0, skipped0, cancelled0; log tại `/tmp/foodprint-ci-supplier-orders-unit.log`. `npm run lint`, `npm run format:check` và `git diff --check` PASS. Thay đổi chỉ gồm integration test và evidence này; không thay runtime hoặc schema/migration.
