# Quickstart: Kiểm chứng đơn giao có nguồn cung / QR

## Trạng thái và điều kiện trước chạy

Đây là hướng dẫn chạy SAU khi implement amendment 2026-11-15; chưa phải bằng chứng feature đã chạy. Các pass của baseline lưu cuối tài liệu không áp dụng cho QR/mã/arrival mới. Không chạy DDL/seed vào DB thành viên/Azure để làm theo guide này.

- Hoàn tất tasks mới sau plan, Node/npm theo repo, dependencies cài bằng npm ci; PUBLIC_TRACE_ORIGIN cấu hình đúng origin phục vụ public route. Giữ .env untracked, không ghi URL có credentials/token vào report.
- Unit/HTTP dùng dependency injection và không cần DB/Redis; public tests inject MemoryStore tường minh như test hiện hành, runtime vẫn Redis.
- Integration phải chọn instance PostgreSQL disposable local riêng, có ủy quyền tạo/ghi/xóa DB thử bên trong. Set MIGRATION_TEST_DATABASE_URL với schema=foodprint, REDIS_URL local, namespace test riêng. Không dùng Azure hoặc database đang có dữ liệu của thành viên. Nếu chưa có ủy quyền/hạ tầng, báo BLOCKED cho các check đó.
- Fixture trên instance thử: hai supplier/admin/staff đủ delivery.manage, linked ACTIVE school; bốn school inspection role đủ view/inspect; active school entries, ít nhất hai source facilities mỗi supplier; một facility ACTIVE legacy có code null; nguồn ACCEPTED chưa có delivery, thêm fixture legacy nhiều deliveries/request cho cap3.

## Kiểm tra tĩnh và unit sau implement

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run build
npm run lint
npm run format:check
npm run test:unit
```

Các file unit mới delivery-code/qr-code/delivery-trace phải có trong test:unit. Chạy riêng khi cần khoanh vùng:

```bash
npm exec --no -- tsx --test tests/supplier-order-creation.test.ts tests/delivery-inspections.test.ts tests/delivery-code.test.ts tests/qr-code.test.ts tests/delivery-trace.test.ts
```

Các test mới chỉ được gọi sau khi tồn tại. Unit kiểm DTO/strict validation/source set, canonical fingerprint, no raw Prisma in service mới, render failure before commit, headers/HTML escaping/public allowlist. Không tự thêm coverage threshold/framework.

## Migration và concurrency trên instance disposable đã cho phép

Sau khi operator tự set đúng MIGRATION_TEST_DATABASE_URL/REDIS_URL cho instance thử:

```bash
npm run test:migrations
npm run test:authorization
npm run test:account-lifecycle:integration
```

Suite migration phải tạo legacy fixtures gồm source/code/metadata null, nhiều lot nguồn khác nhau và nhiều legacy deliveries/request trước migration mới. So sánh IDs/codes/status/created_at/updated_at/approvals/lots/history trước/sau; không có snapshot/token/version giả. Kiểm composite supplier/code cho phép00001 trùng giữa suppliers, unique cùng supplier và giữ các source/idempotency/receipt partial uniques.

Chạy ít nhất20 ý định tạo riêng biệt đồng thời ở mỗi supplier: mã không trùng trong supplier, cả hai có00001 khi dãy rỗng, QR không nhầm dòng, không cast lỗi DG/legacy. Kiểm99999->100000, số0/bad padding, mã sát trần80. Replay/response timeout giữ cùng id/mã/QR/URL/timestamps; lỗi giữa transaction rollback header/items/lots/source state, không thêm receipt. Không dùng chạy tuần tự thay kiểm concurrency thật.

Helper hiện retry tối đa3 lần, nên phải ghi cả số thành công/thất bại và số retry khi có contention503. Nếu thử lại ở client/harness, giữ nguyên key/body và dùng deadline tường minh, không tạo ý định mới. Chỉ kết luận hoàn tất bài20 đơn khi đủ20 kết quả đã commit ở mỗi supplier và không có bản sao; hết deadline mà còn thiếu phải ghi FAIL/BLOCKED phù hợp, không coi không trùng trên vài đơn thành công là đủ chứng minh tải.

## Hành trình tạo đơn và QR

Chuẩn bị API_BASE/SUPPLIER_TOKEN/INSPECTOR_TOKEN trong shell riêng, không commit. Dùng [contract](contracts/supplier-orders.md) để lấy chính xác body REQUEST/STANDALONE và các IDs từ fixture; không dùng các UUID ví dụ làm dữ liệu thật.

1. GET options schools/ingredients/source-facilities bằng admin rồi staff; kiểm tenant/permission/page và active nguồn. Staff vẫn không được quản trị source-facility. Source legacy code null được chọn và hiển thị tên, không tự cấp code.
2. POST REQUEST cùng Idempotency-Key UUID, đủ nguồn từng source item, plate/ETA bắt buộc. Expected201 IN_TRANSIT, FP-DE theo supplier, đủ lượng nguồn, snapshot/traceUrl từng dòng, nguồn IN_PROGRESS. GET detail xác nhận. Không gửi quantity override hoặc sources thiếu/thừa.
3. POST STANDALONE với linked school, 1..100 own ingredients/positive actualQuantity/unit/source. Expected201 IN_TRANSIT, source request null; không cần lịch sử reject. Không có school entry vẫn create được nhưng kiểm receipt ở phần sau phải409 cho tới khi trường cấu hình entry hợp lệ bằng nghiệp vụ/fixture đã cho phép.
4. Gửi thiếu/rỗng plate, ETA thiếu/sai timezone, source INACTIVE/foreign hoặc source bị dừng cạnh tranh trước commit: lỗi400/404/409 theo contract, không lưu đơn một phần. Rename/deactivate source SAU create không đổi snapshot hoặc làm mất QR.
5. GET labels với page/limit, tải đủ N ảnh cho N dòng. In/mở ảnh PNG bằng QR reader độc lập hoặc camera; scan phải tới đúng stored URL. Quét trên điện thoại cần origin mạng/HTTPS truy cập được, localhost trên máy dev không thay thế được điều này. In lại/replay cùng dòng phải giữ QR, hai đơn cùng ingredient/code khác supplier phải phân biệt.
6. QR public không login: Accept text/html đọc được, Accept application/json có đúng allowlist. Không có school/xe/lịch giao/account/contract/photo/approval details trong body/HTML/metadata/error. Test text nguồn có HTML đặc biệt được escape; invalid token404, unsupported Accept406, no-store/no-referrer/CSP/noindex. QR không approve/arrival; token không xuất hiện trong log. `/api/traceability-anchors` và protected management vẫn cần auth.

## Arrival, kiểm nhận và kho

Sau create v1, xác nhận N lô dự kiến BLOCKED/available0/no inventory receipt. Ngày SX/HSD null thật; không mô tả lô dự kiến là batch nhà sản xuất.

```bash
curl -X POST "$API_BASE/api/deliveries/$DELIVERY_ID/arrival" \
  -H "Authorization: Bearer $INSPECTOR_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Expected200 ARRIVED và server arrivedAt. Supplier/public/sai trường/thiếu inspect bị403/404; nguồn đã hủy409. Replay arrival không đổi arrivedAt và không hạ trạng thái tiến triển. Không có receipt ở bước arrival.

Dùng bốn token vai trò kiểm nhận của đúng trường và POST inspection hiện có (giữ contract ảnh multipart):

- 1..3 APPROVE: PENDING_APPROVAL, chưa có receipt. Vai trò đã ký không sửa quyết định, không đổi actor/photo/reason để ký lại.
- APPROVE cuối đủ4: RECEIVED/statusLabel Hoàn thành, available=received mỗi lot, đúng một RECEIPT/lot. Hai thao tác cuối đồng thời/replay không nhận kho hai lần.
- Tiêm fixture test sai source lot/null source v1, expiry/date/quantity/history sai hoặc standalone thiếu entry: final APPROVE409, final decision/status/lot/kho rollback cùng nhau. Không làm fixture lỗi bằng sửa dữ liệu member/Azure.
- REJECT kèm reason: REJECTED/statusLabel Yêu cầu giao hàng lại; chặn APPROVE đến sau, lot vẫn BLOCKED/available0. Lập standalone mới đủ source/plate/ETA, có mã/QR mới và cần bốn quyết định mới; không đổi/copy chữ ký đơn cũ.
- Cap3 dùng fixture legacy chung supplyRequest: lần thứ3 hủy yêu cầu và các đợt chưa nhận, giữ RECEIVED/history. Standalone mới vẫn không liên kết/tăng/reset cap nguồn cũ; null counters không được gom thành một nhóm.

## Rollout và báo cáo

Chỉ review migration/schema trong PR, không sửa applied SQL để qua check. Sau kiểm thử disposable đạt, triển khai reviewed migration qua CD hoặc ủy quyền riêng; ngừng writer cũ trước bật create v1, cấu hình public origin ổn định. Không khôi phục unique global nếu đã có code trùng giữa supplier. Cập nhật docs AUTHORIZATION/module endpoints và client payload để nguồn/plate/ETA bắt buộc.

Ghi rõ branch/commit, từng check PASS/FAIL/BLOCKED, instance disposable được chọn, scan evidence, số creates cạnh tranh, số lần receipt và snapshot preservation. Không đưa token/credentials vào report. Bước plan hiện chỉ kiểm định dạng/liên kết tài liệu, chưa cài dependencies/chạy tests/DDL/mutation DB.

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
