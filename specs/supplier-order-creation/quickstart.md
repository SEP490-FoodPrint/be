# Quickstart: Supplier order creation

## Trạng thái

Đây là thiết kế và hướng dẫn kiểm chứng sau triển khai, chưa phải báo cáo tính năng đã hoạt động. Bước plan chỉ tạo tài liệu; chưa sửa src/prisma, tạo migration, kết nối DB, chạy nghiệp vụ hoặc kiểm thử phần mềm. Xem [plan](plan.md), [data-model](data-model.md), [hợp đồng HTTP](contracts/supplier-orders.md).

## Prerequisites

- Node/npm đúng .nvmrc/package.json, dependencies hiện có; npm ci khi môi trường chưa cài, không thêm dependency cho feature.
- Sau khi implementation đã viết schema/migration được review: PostgreSQL disposable local được chọn và ủy quyền rõ ràng. Không dùng database thành viên/Azure hoặc tự áp migration vào dữ liệu thật.
- .env riêng không commit; URL dùng schema=foodprint theo README. Prisma generate không triển khai migration và không thay cho kiểm chứng SQL.
- Fixture riêng: supplier A/B, admin/staff A, trường liên kết ACTIVE với A, trường chưa liên kết, nguyên liệu ACTIVE/INACTIVE của từng supplier; yêu cầu đã tiếp nhận có nhiều dòng, nguồn đã có Delivery lịch sử và nguồn chưa có phiếu. Fixture không đưa vào migration như seed.
- Để chạy HTTP thật cần Redis local cho auth/rate limit; có thể dùng injection unit/HTTP không DB. Không flush Redis hoặc dọn key ngoài namespace thử.

## Kiểm tra sau triển khai

Từ repository root:

```sh
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
```

Đăng ký tests/supplier-order-creation.test.ts vào test:unit khi viết file; kiểm chứng cả validation, service/HTTP và repository query. Không đánh dấu PASS khi chưa chạy hoặc dùng file-level test runner output thay số assertion/test thực tế.

Khi MIGRATION_TEST_DATABASE_URL đã trỏ instance disposable được phép:

```sh
npm run test:migrations
npm run test:authorization
npm run test:account-lifecycle:integration
npm exec --no -- tsx --test tests/supplier-order-creation.integration.test.ts
```

File integration mới phải dùng harness tạo database mới, triển khai migrations hiện hành và dọn đúng DB của lần chạy; không chỉ đổi tên biến DATABASE_URL rồi dùng database thành viên. Kiểm thử quan hệ/permission/pause race cần barrier xác định, không dùng sleep ngẫu nhiên.

## POST REQUEST

Chuẩn bị API_BASE, SUPPLIER_TOKEN, REQUEST_ID và CREATE_KEY (UUID mới), không ghi token vào repo. Chỉ chạy POST trên dữ liệu thử được phép:

```sh
curl -sS -X POST "$API_BASE/api/deliveries/management" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" \
  -H "Idempotency-Key: $CREATE_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceType\":\"REQUEST\",\"supplyRequestId\":\"$REQUEST_ID\"}"
```

Kỳ vọng201, CREATED, đủ toàn bộ dòng/Decimal/unit nguồn, trường đúng và nguồn IN_PROGRESS. Replay cùng key/body ->200 cùng id/time, không đổi updatedAt. Key mới cùng nguồn ->409; cùng key body khác ->409. Override items/schoolId ->400.

## STANDALONE và options

GET `/api/deliveries/management/options/schools` và `/options/ingredients` lấy target/dòng hợp lệ bằng role admin hoặc staff có delivery.manage. Không dùng endpoint ingredient quản trị admin-only làm dependency cho staff.

Tạo JSON theo [contract](contracts/supplier-orders.md) với sourceType STANDALONE, schoolId của trường đã liên kết ACTIVE và items từ nguyên liệu supplier A; gửi POST với key mới. Kỳ vọng201, CREATED, schoolId bắt buộc, supplyRequestId/requestNo null, không cần lịch sử yêu cầu/giao bị từ chối. Dùng hai key khác cho hai đơn độc lập cùng nội dung -> hai id; replay từng key -> phiếu tương ứng, không tạo thêm.

GET `/api/deliveries/management` và `/:id` cho cả hai role, kiểm tra sourceType, schoolName, nullable source, items ở detail, phân trang và không có key/hash/credential. Các đơn supplier B không xuất hiện; ID B ->404.

## Ma trận xác nhận

| Nhóm                  | Kỳ vọng cần chứng minh                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quyền                 | Hai role manage đều tạo/options/read; thiếu manage không tạo; quyền đọc theo resource OR hiện hành; SYSTEM/role/org sai không bypass.                                      |
| REQUEST               | Copy đủ dòng/đúng lượng/unit; strict override; source quota, ACCEPTED->IN_PROGRESS nguyên tử; nguồn DRAFT/SENT/CANCELLED/COMPLETED hoặc ngoài scope không tạo.             |
| STANDALONE            | Không nguồn vẫn tạo được; bắt buộc linked ACTIVE school, own ACTIVE ingredients, Decimal dương/unit hợp lệ; không tự tạo request hoặc IngredientEntry.                     |
| Race                  | Hai actor cùng nguồn chỉ một Delivery; cùng actor/key giữ một kết quả; đổi relationship/role/denial/intake trong lúc tạo bị recheck đúng.                                  |
| Rollback              | Lỗi sau header/item/source update không để phiếu dở dang hoặc nguồn đổi trạng thái.                                                                                        |
| Lịch sử               | Migration giữ nhiều Delivery cũ/request, backfill school/ingredient/entry chính xác, giữ số lượng/mã/trạng thái/chữ ký/timestamps.                                         |
| Tenant scopes         | School A/B không đọc lots/deliveries/inventory/feedback/traceability của nhau dù nguồn null; supplier cũng đúng owner.                                                     |
| Entry mapping         | Standalone CREATED được tạo khi trường chưa có entry; receipt thiếu entry409, không AVAILABLE/RECEIPT; sau cấu hình entry hợp lệ có thể nhận theo điều kiện chuẩn.         |
| Inspection có nguồn   | Bốn chữ ký, cap nhận từng source item, reject count/cancel phần chưa nhận và receipt một lần giữ hành vi cũ.                                                               |
| Inspection standalone | Chuẩn bị ARRIVED/lots bằng fixture riêng; bốn chữ ký và kiểm tra lots/date/unit/owner vẫn có; REJECT chỉ phiếu hiện tại, không query/cancel nhóm null hoặc sửa yêu cầu cũ. |
| Kho/bếp/menu          | Lot standalone RECEIVED có mapping entry đúng trường, được chọn đúng theo entry/handlingType, không mất tên hoặc available quantity khi không có source item.              |
| Serialization         | Date ISO UTC, Decimal chuỗi, nullable source rõ ràng; không leak record/key/hash/secret; old source-based DTO giữ giá trị cũ.                                              |

Không mở action ARRIVED hoặc tự sinh lots trong feature; fixture chỉ để chứng minh consumer hiện có tương thích, không phải thao tác production mới.

## Bằng chứng và giới hạn cần ghi

Sau implementation ghi từng lệnh thực sự chạy, test pass/fail/skipped, version code, DB disposable đã dùng và dữ liệu đã dọn. Nếu chưa được cấp instance local, ghi integration/migration chưa chạy; không chuyển sang DB khác. Việc thiết kế migration không phải cho phép deploy remote hoặc seed.

Đặc biệt phải báo nếu còn consumer dereference nguồn bắt buộc hoặc chưa chuyển school scope: đó là lỗi chặn hoàn tất, không xem là tối ưu sau này. CREATED chưa có lô hoặc entry không có nghĩa đã sẵn sàng nhập kho. Các hành trình sau CREATED vẫn phụ thuộc dữ liệu và transition hợp lệ theo workflow đã có.

## Kết quả bước plan — 2026-11-15

Đã tạo plan/research/data-model/contracts/quickstart, đối chiếu hiến chương I–VI trước/sau thiết kế. Hai research agent chỉ đọc code/schema. Không có extension hooks. Chỉ kiểm tra cấu trúc, liên kết tài liệu và định dạng; chưa chạy tests phần mềm, tạo migration hoặc thay DB. tasks.md sẽ được tạo bằng speckit-tasks.

## Setup Baseline & Prerequisites (T001–T002)

- **Nhánh làm việc**: `feat/supplier-order-creation` (chỉ có thư mục spec `specs/supplier-order-creation/` trước khi implement).
- **Tài liệu đã đối chiếu**: `AGENTS.md`, `.specify/memory/constitution.md`, `specs/supplier-order-creation/{spec,plan,data-model,quickstart}.md` và `specs/supplier-order-creation/contracts/supplier-orders.md`.
- **Router mount & quyền**:
  - `src/routes/index.ts` dòng 137 hiện mount `router.use("/deliveries", ...)`; router mới `/deliveries/management` phải đăng ký **trước** dòng này.
  - `src/constants/permission-catalog.ts` đã cấp sẵn `delivery.manage`, `delivery.view`, `delivery.receive` cho `INGREDIENT_SUPPLIER_ADMIN` và `INGREDIENT_SUPPLIER_STAFF`.
- **Điều kiện PostgreSQL disposable**:
  - `npm run test:migrations` và các test tích hợp yêu cầu `MIGRATION_TEST_DATABASE_URL` trỏ tới database disposable local (pattern `/foodprint_migration_test(?:_[a-z0-9_]+)?$`); tuyệt đối không dùng `.env` thành viên hoặc Azure DB.
  - Mọi kiểm thử chỉ chạy sau khi xác nhận biến môi trường hợp lệ; nếu không có instance disposable được cấp phép, phần chạy PostgreSQL thực tế được giữ nguyên trạng thái chưa chạy và ghi rõ trong báo cáo.

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
