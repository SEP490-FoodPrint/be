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
