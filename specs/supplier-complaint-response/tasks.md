---
description: "Tasks nhà cung cấp xem/phản hồi khiếu nại, UUID và complaintCode dùng chung"
---

# Tasks: Nhà cung cấp xem và phản hồi khiếu nại nguyên liệu

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [API contract](contracts/ingredient-quality-feedback-api.md), [producer contract](contracts/complaint-code-producer.md), [quickstart.md](quickstart.md).

**Branch**: `feat/supplier-complaint-response`.

**Status**: Đã cập nhật theo FR-015 và lựa chọn B: giữ id UUID/UUID paths, thêm complaintCode duy nhất lưu trên đơn gốc. Bản50task này thay bản40task trước; do toàn bộ task cũ chưa thực hiện, IDs được đánh lại tuần tự T001–T050, không mang trạng thái hoàn thành cũ sang.

**Tests**: Kiểm chứng các acceptance scenarios, phân quyền/atomicity, mã dùng chung và migration đã yêu cầu trong spec/plan. Dùng Node test runner/tsx hiện có. Viết tests trước phần triển khai tương ứng; không lấy lỗi harness/import/config sai làm bằng chứng hành vi đã được kiểm chứng. Integration chỉ chạy trên instance/disposable DB được phép; việc viết fixture không tự cho phép ghi DB.

**Organization**: Setup → Foundation → US1 → US2 → US3 → Polish. Cả ba story đều P1. Storage/migration/allocator là nền tảng dùng chung; không thêm story tạo khiếu nại hoặc HTTP creator BGH ngoài spec.

## Format: `[ID] [P?] [Story] Description`

- [P] chỉ áp dụng trong wave được ghi rõ; mỗi task có ID, paths và checkbox.
- Story phases bắt buộc [US1]/[US2]/[US3]; Setup/Foundation/Polish không gắn story.
- Nếu implement dùng agents: tối đa3 subagents đồng thời; chỉ giao task [P] cùng wave, một file một owner. Agent chính tích hợp/review/kiểm chứng. Không yêu cầu khởi chạy agents trong lệnh tạo tasks này.
- Chỉ tick task sau khi công việc và kiểm chứng của task thực sự hoàn tất; ghi rõ prerequisite thiếu, không coi no-op hoặc test fixture là kết quả production.

## Path Conventions

Paths tính từ repository root. Hoàn thiện7file của module ingredient-quality-feedback, bổ sung đúng một cột complaintCode và một sequence qua migration mới; giữ UUID PK/FK, CHECK response cũ, role grants và legacy SCHOOL/SYSTEM list. Không thêm Counter table, SQL function/trigger, default cấp mã, frontend hoặc endpoint tạo đơn BGH.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Chốt baseline và điểm mở rộng, chuẩn bị harness phục vụ thiết kế mới.

- [x] T001 Đọc spec/plan/contract/constitution và AGENTS.md; ghi baseline nhánh, authorization cho DB/control/disposable tests, producer BGH chưa có và SC-006 chưa đo trong `specs/supplier-complaint-response/quickstart.md`; kiểm tra thứ tự/collision migration dự kiến, không chạy DDL khi chỉ có cấu hình.
- [x] T002 Chuẩn bị repository/service factory injection tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts` và `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts`, giữ exports/router hiện tại hoạt động, dùng shared Prisma client/tx; không tạo client mới, fake success hoặc mount stub endpoint.
- [x] T003 Chuẩn bị harness unit/HTTP tại `tests/ingredient-quality-feedback.test.ts` và khung suite `tests/complaint-code.test.ts`; đăng ký cả hai trong `package.json` test:unit, giữ Node test runner, không thêm framework/dependency/runner hoặc đổi cấu hình kết nối.

**Checkpoint**: Baseline/ownership rõ; source test harness có thể mở rộng mà không chạm dữ liệu môi trường thành viên.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared storage/code contract và auth/DTO/query foundation trước mọi story.

### Tests và nền tảng complaintCode

- [x] T004 [P] Viết tests formatter/parser tại `tests/complaint-code.test.ts`: bigint1/99999/100000/MAX_BIGINT, canonical uppercase/padding, reject0/âm/vượt range/noncanonical/non-bigint input phù hợp contract, không chuyển Number, không DB side effects; số dài hơn5chữ số không bị cắt.
- [x] T005 [P] Bổ sung ca upgrade/fresh migration trong `tests/migrations.test.ts`: legacy rows/timestamp trùng, backfill created_at ASC/id ASC giữ mọi cột cũ, NOT NULL/unique/CHECK/range, empty next1 và Nrows nextN+1, vượt99999 không cắt, sequence BIGINT/CACHE1/NO CYCLE/ownership và không default/function/trigger; chỉ viết tests, chưa áp migration ngoài harness được phép.
- [x] T006 [P] Viết producer-contract fixture helpers/cases trong `tests/supplier-onboarding.integration.test.ts`: shared allocator+formatter+INSERT cùng tx, nhiều trường cấp mã global không trùng, rollback không lưu đơn nhưng cho phép gap, code/id lưu một lần; fixture chỉ chứng minh contract/storage, không tuyên bố HTTP creator BGH hoặc grants đã có.
- [x] T007 Bổ sung IngredientQualityFeedback.complaintCode String @unique(map: ingredient_quality_feedback_complaint_code_key) @map(complaint_code) @db.VarChar(25) trong `prisma/schema.prisma`, không nullable/default; giữ UUID PK/FK, enums/relations/partial indexes và không tạo Counter model.
- [x] T008 Soạn migration SQL mới tại `prisma/migrations/20261120000300_ingredient_feedback_complaint_code/migration.sql` sau khi kiểm tra collision/thứ tự: transaction ACCESS EXCLUSIVE, nullable column→deterministic backfill→NOT NULL/unique/canonical-positive/range CHECK qua CASE an toàn; giữ UUID/nội dung/status/response/ownership/timestamps, self-assign updated_at cũ, giữ CHECK response; padding không cắt; tạo sequence mới BIGINT1..MAX/CACHE1/NO CYCLE OWNED BY code, setval empty→next1/N→nextN+1 chỉ lần này; chỉ viết file, không áp vào member/Azure hoặc sửa applied history.
- [x] T009 Triển khai pure formatComplaintCode/parser tại `src/utils/complaint-code.ts`: FP-CP- với tối thiểu5digits, positive BIGINT≤9223372036854775807, canonical uppercase, varchar25; không kết nối DB/Redis, không UUID-derived code, không reset/recycle hay hứa gapless numbering.
- [x] T010 Thêm nextComplaintCodeSequence(tx) tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`: chỉ SQL nextval tên sequence cố định, trả bigint và dùng tx của producer, không transaction riêng/format trong repo/MAX+1; API nội bộ chỉ dành tạo đơn theo producer contract, chưa thêm HTTP creator hoặc role grants.
- [x] T011 Chạy focused pure-code tests, prisma:validate/prisma:generate với schema đích và kiểm tra tĩnh draft migration so với `tests/migrations.test.ts`; ghi kết quả thật tại `specs/supplier-complaint-response/quickstart.md`, giữ generated client không commit. Kiểm chứng SQL thực bắt buộc ở T046 khi có authorization; không báo migration đã qua chỉ từ schema validate.

### Auth, schema, DTO và legacy query

- [x] T012 [P] Thêm typed read scope list/detail và supplier response scope tại `src/utils/resource-access.ts`: supplier chỉ ADMIN/STAFF, SUPPLIER membership duy nhất, đọc view_details, ghi kiểm tra riêng view_details VÀ respond; nhánh SUPPLIER listScopes dùng cùng helper, giữ SCHOOL own/details và SYSTEM chỉ legacy list, không bypass.
- [x] T013 [P] Định nghĩa Zod strict schemas/parseRequest tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.validation.ts`: page/limit defaults/limits, feedbackId UUID lowercase, empty query, response body chỉ supplierResponse trim1–5.000 Unicode code points/giữ newline; tạo `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.request.dto.ts` bằng z.infer/type-only imports; complaintCode hoặc actor/status/time/org fields trong input đều bị từ chối.
- [x] T014 [P] Định nghĩa SupplierFeedbackListItem/List, FeedbackDetail và LegacyFeedbackList/Item trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.response.dto.ts`: id UUID cùng complaintCode string bắt buộc cho output mới, school.code nullable, users chỉ id/fullName, ISO/null/pagination; legacy list vẫn10fields không thêm complaintCode/supplierResponse.
- [x] T015 Bổ sung scope/AND-permission/default grants regressions tại `tests/authorization.test.ts`: admin/staff, supplier view_own-only403, school own/details, SYSTEM list/detail, malformed membership; giữ catalog/bootstrap và SCHOOL scope hiện có, không tự cấp thêm grants để làm test qua.
- [x] T016 Bổ sung validation cases tại `tests/ingredient-quality-feedback.test.ts`: multi-field errors/path tiếng Việt, unknown fields, defaults/limits/offset, UUID paths và FP-CP-code thay UUID400, giả mạo complaintCode400, Unicode/trim/newline/boundary1/5.000/5.001, blank/null/non-string.
- [x] T017 Tách listLegacy/query/select vào `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`, truyền trusted SCHOOL/SYSTEM scope; cập nhật `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts` chỉ dùng Request DTO và map allowlist10fields/Dates/pagination/order id ASC, không thêm code vào legacy list hoặc dựng Prisma args trong service.
- [x] T018 Kiểm chứng foundation bằng focused code/scope/validation/legacy-list unit và guards trong `tests/modules.test.ts`; ghi bằng chứng cùng trạng thái chưa chạy SQL thực vào `specs/supplier-complaint-response/quickstart.md`, đối chiếu shared producer contract và khả năng inject allocator spy cho supplier tests.

**Checkpoint**: Nền tảng source/storage thiết kế đã tích hợp. Không coi schema generate hoặc fixture tests chưa chạy là migration deployed; T046/T047 còn là gates bắt buộc trước bàn giao.

## Phase 3: User Story 1 — Xem danh sách khiếu nại (Priority: P1) — MVP

**Goal**: Supplier admin/staff xem đúng đơn được gửi tới đơn vị, thấy UUID và mã gốc dùng chung cùng metadata trường/chuyến.

**Independent Test**: Chuẩn bị A/B cùng school X và school Y; A GET list chỉ thấy chuyến của A, đủ trạng thái, đúng order/pages/projection/code đã lưu. Nhiều GET không cấp số hoặc đổi dữ liệu.

### Tests for User Story 1

- [x] T019 [P] [US1] Viết unit/HTTP list cases trong `tests/ingredient-quality-feedback.test.ts`: admin/staff,401/403/view_own-only, mọi người gửi, SUBMITTED/RESPONDED, exact UUID+complaintCode/school/delivery allowlist, school.code null không UUID fallback, ISO/null, pagination/hasNext/no-store, code thiếu/sai503 và allocator spy không được gọi.
- [x] T020 [P] [US1] Bổ sung real-data list cases vào `tests/supplier-onboarding.integration.test.ts` sau producer fixtures T006: nhiều suppliers/trường/pages/timestamp bằng nhau, code global duy nhất, school.code null/trùng, empty/beyond-last, SUSPENDED/UNLINKED/inactive school/expired contract vẫn giữ trách nhiệm theo delivery; repeated GET không đổi last_value/is_called trong test không có producer cạnh tranh.

### Implementation for User Story 1

- [x] T021 [US1] Thêm listSupplier tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`: Delivery.supplierId từ scope, select id+complaintCode cùng list allowlist và school id/name/code/delivery id/deliveryNo, order createdAt DESC/id ASC, skip/take limit+1; không cấp số, N+1 hoặc lọc toàn bộ data trong bộ nhớ.
- [x] T022 [US1] Triển khai supplier list branch tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts`: trusted scope, gọi repository, parse canonical code đã lưu rồi map string bắt buộc/ISO/null/pagination, code thiếu/sai503 an toàn; không formatter để cấp mã/allocator/cache/current relationship filter, giữ listLegacy.
- [x] T023 [US1] Cập nhật GET list trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.routes.ts` và `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.controller.ts`: authenticate/scope guard trước validate, shared success envelope, supplier private/no-store; controller không DTO imports/queries; giữ mount ở `src/routes/index.ts`, chỉ bổ sung injection nếu harness cần.
- [x] T024 [US1] Chạy focused supplier-list unit/HTTP và legacy regressions trong `tests/ingredient-quality-feedback.test.ts`, ghi kết quả vào `specs/supplier-complaint-response/quickstart.md`; đối chiếu mã lấy từ bản ghi, không tự tick integration T020 trước runner T047.

**Checkpoint**: MVP list đủ UUID+complaintCode và isolation. Story này không hoàn thành thay US2/US3 hoặc chứng minh producer BGH thật.

## Phase 4: User Story 2 — Xem chi tiết khiếu nại (Priority: P1)

**Goal**: Đọc nội dung đầy đủ và phản hồi hiện có, giữ mã gốc, kiểm chứng lô cùng chuyến; trường đọc trong phạm vi được phép.

**Independent Test**: Gọi trực tiếp GET detail bằng UUID bằng supplier/SCHOOL own/details, không cần mở list trước; cùng code đã lưu, foreign/nonexistent cùng404, lot sai503 không lộ id/code lô khác.

### Tests for User Story 2

- [x] T025 [P] [US2] Viết unit/HTTP detail cases trong `tests/ingredient-quality-feedback.test.ts`: id+complaintCode khớp list/nguồn, description/users/ISO/null và response tuple, lot null/đúng/sai, code/tuple sai503, foreign/nonexistent cùng404, SCHOOL own/details, SYSTEM/AUTHORITY403, FP-CP path400, no-store và không gọi allocator.
- [x] T026 [P] [US2] Bổ sung integration detail/school readback tại `tests/supplier-onboarding.integration.test.ts`: đơn RESPONDED fixture có code gốc, school own/details/other-school, tác giả/người phản hồi chuyển org hoặc locked, lot FK khác delivery503, history không cản đọc, GET không đổi timestamps/code/sequence trong test cô lập producer.

### Implementation for User Story 2

- [x] T027 [US2] Thêm findDetail/findLotInDelivery trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`: id UUID+trusted supplier/school scope, own-only thêm submittedByUserId, select stored complaintCode/users id+fullName; lot phải đúng lotId+DeliveryItem.deliveryId của complaint+Delivery scope, không nested include lô không scoped hoặc allocator.
- [x] T028 [US2] Triển khai getDetail/mapper dùng lại cho response tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts`: withReadTransaction cho detail+lot cùng snapshot,404 an toàn, parser code/response tuple/lot mismatch503, map id+code đã lưu và nullable fields tường minh; không current membership tác giả, fallback hoặc catch-all readListPage bọc business errors.
- [x] T029 [US2] Thêm GET /:feedbackId tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.routes.ts` và handler trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.controller.ts`: supplier/SCHOOL guards trước schema validation, SYSTEM detail403, paths luôn UUID, shared200/no-store và không DTO imports/DB calls trong controller.
- [x] T030 [US2] Chạy focused detail/list unit/HTTP trong `tests/ingredient-quality-feedback.test.ts`, ghi evidence tại `specs/supplier-complaint-response/quickstart.md`; phân biệt SCHOOL đọc cùng code/response theo FR-011 với creator BGH chưa tích hợp, integration thực đợi T047.

**Checkpoint**: US1/US2 đều gọi độc lập; mã gốc được giữ và trường đọc cùng phản hồi trong scope hiện có.

## Phase 5: User Story 3 — Gửi phản hồi chính thức (Priority: P1)

**Goal**: Ghi một phản hồi với quyền tại điểm chấp nhận, giữ id/mã gốc và không cấp số khi phản hồi/retry.

**Independent Test**: POST hợp lệ rồi supplier/SCHOOL GET detail có cùng id/code/text/actor/time; repeated POST409. Hai responders đủ quyền cho cùng đơn hợp lệ: một200/một409; các interleaving quản trị quyền dùng barriers.

### Tests for User Story 3

- [x] T031 [P] [US3] Viết unit/HTTP response cases tại `tests/ingredient-quality-feedback.test.ts`: đủ hai quyền, actor/role/scope đổi bị chặn, complaintCode/actor/time/status giả mạo400, server-owned response tuple, cùng tx/conditional count0/already-responded409, rollback readback/code lỗi, actor-query/direct COMMIT retry tối đa3, hết retry/lỗi thường503,200/no-store/CSRF/session/rate-limit và mọi attempt không gọi allocator/đổi code.
- [x] T032 [P] [US3] Viết real auth/concurrency cases có barriers tại `tests/authorization.integration.test.ts`: admin/staff cùng phản hồi một đơn một200/một409, repeated POST giữ winner/id/code; response cạnh tranh denial/status lock/role-grant replacement theo cả hai thứ tự, fresh snapshot/retry đúng, không503 do sanitize sớm và không sleep đoán lock order.
- [x] T033 [P] [US3] Viết end-to-end response/readback/invariants tại `tests/supplier-onboarding.integration.test.ts`: supplier POST rồi SCHOOL own/details đọc cùng UUID/complaintCode/reply, foreign404, history sau unlink/inactive/expired, lot readback lỗi hoặc code lỗi mô phỏng qua repository injection làm rollback, không tắt CHECK để tạo dữ liệu code sai; chỉ complaint response/updatedAt đổi, nội dung/người gửi/id/code và mọi timestamps ngoài complaint/sequence giữ nguyên khi không có producer/admin writes cạnh tranh.
- [x] T034 [US3] Bổ sung dynamic authorization trên session cũ tại `tests/authorization.integration.test.ts` sau T032: locked account, đổi role/membership, mất grant, permission inactive/denial mới áp dụng cho list/detail/POST; view_own-only/respond-only/SCHOOL/SYSTEM/AUTHORITY POST403, không tin token claims và không lộ đơn ngoại tổ chức.

### Implementation for User Story 3

- [x] T035 [US3] Thêm readActor/findResponseMetadata/lockResponseContext tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`: identitySelect+principalFromIdentity trực tiếp cùng tx, scoped metadata lock IDs; khóa school→supplier→actor user→actor role→hai permission rows FOR SHARE theo ID→scoped delivery→scoped complaint, tagged parameters/shared parent helpers; không loadPrincipal/catch-all hoặc current intake/relationship ACTIVE guard.
- [x] T036 [US3] Thêm respondIfSubmitted/scoped readback trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`: updateMany id+Delivery.supplierId+SUBMITTED, đồng thời response/byUser/time/status=RESPONDED với updatedAt do Prisma; trả count, cùng tx, không transaction riêng, không complaintCode trong update data hoặc allocator trong write/readback.
- [x] T037 [US3] Triển khai respond tại `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts`: original scope/quyền→authorizationTransaction→metadata/locks→recheck ACTIVE actor/roleId/role/org/supplierId không đổi và đủ hai quyền→target+metadata recheck→conditional write→scoped detail/lot/code map cùng tx;404 ngoài scope,409 replied/count0,503 metadata/code/infrastructure không nhất quán, chỉ trả sau commit; không allocator/side effects hoặc sanitize conflict trước wrapper.
- [x] T038 [US3] Thêm POST /:feedbackId/response trong `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.routes.ts` và `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.controller.ts`: supplier AND-permission guard trước validate params/query/body strict, body duy nhất supplierResponse, shared200 FeedbackDetail giữ UUID/code/no-store; giữ cookie/CSRF/session/limiter, không thêm PUT/PATCH/DELETE reply.
- [x] T039 [US3] Chạy focused module/code unit/HTTP cùng retry regressions trong `tests/authorization.test.ts` và `tests/supplier-staff-management.test.ts`; review race/readback tests đã sẵn runner, ghi bằng chứng tại `specs/supplier-complaint-response/quickstart.md`; không nhận integration đạt trước T047.

**Checkpoint**: Ba story hoàn chỉnh ở cấp module/HTTP; quality, SQL migration và real authorization/integration còn là gates bắt buộc.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Review cuối, đồng bộ tài liệu và kiểm chứng thực tế migration/consumer feature.

- [x] T040 [P] Cập nhật ownership/method-path mapping trong `src/modules/README.md`: supplier list/detail/response, code đã lưu/UUID paths, SCHOOL detail, legacy SCHOOL/SYSTEM list và phân biệt meal-complaints; không mô tả BGH creator như đã có.
- [x] T041 [P] Cập nhật `docs/AUTHORIZATION.md`: supplier ADMIN/STAFF view_details, phản hồi AND respond, school own/details, SYSTEM chỉ legacy list, hiện trạng grants/denials và creator BGH ngoài phạm vi; không thay catalog/bootstrap để ngầm mở quyền.
- [x] T042 [P] Cập nhật `database/SCHEMA_BASELINE.md` về migration mới/code/sequence/backfill và preserve timestamps/ownership, nguồn verification/deployment status thật; giữ manifest/checksums/applied migrations, không tự khẳng định Azure đã deploy.
- [x] T043 Hoàn thiện validation/rollout guide và Evidence log tại `specs/supplier-complaint-response/quickstart.md`: migration/auth local prerequisites, writer inventory/maintenance/no-old-writer, DB sequence USAGE theo operator, producer contract dependency và rollback forward-fix; giữ SC-006 chưa đo, không thực hiện deploy/GRANT hoặc tạo endpoint BGH để tick task.
- [x] T044 Review tích hợp `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.service.ts`, `src/modules/ingredient-quality-feedback/ingredient-quality-feedback.repository.ts`, các DTO/validation/controller/routes, `src/utils/resource-access.ts`, `src/utils/complaint-code.ts`, `prisma/schema.prisma` và draft migration: phân lớp, safe projection/scope/lot, same tx/retry/locks, id/code bất biến, allocator chỉ producer, không default/function/trigger/Counter/cache quyền; sửa vấn đề trước quality checks.
- [x] T045 Chạy prisma:validate/prisma:generate, npm run validate và npm run test:unit theo `package.json`; xác nhận cả suite module và complaint-code được gọi cùng legacy/meal-complaint/retry regressions, ghi kết quả thật tại `specs/supplier-complaint-response/quickstart.md`; generated client/dist không hand-edit hoặc commit.
- [x] T046 Khi có authorization cho đúng instance/control/disposable DB, chạy test:local:check nếu được phép rồi npm run test:local:migrations theo `tests/helpers/run-local-tests.ts`; xác nhận T005 dùng SQL thật, upgrade/fresh/backfill/sequence/constraints/preserved rows/drift và không default/functions/triggers, cleanup chỉ manifest; ghi kết quả tại `specs/supplier-complaint-response/quickstart.md`, thiếu prerequisite thì task vẫn chưa xong.
- [x] T047 Khi có authorization và Redis/local DB phù hợp, chạy npm run test:local:authorization qua `tests/helpers/run-local-tests.ts`; hai integration files thực thi tuần tự, gồm producer-contract fixtures/global allocation T006, consumer history/readback/no-allocation và real auth/races; cleanup đúng manifest, ghi pass/fail thật tại `specs/supplier-complaint-response/quickstart.md`, không tạo container hoặc reset member DB.
- [x] T048 Đối chiếu FR-001–FR-015/SC/task coverage và formatting/links giữa `specs/supplier-complaint-response/spec.md`, `specs/supplier-complaint-response/plan.md`, `specs/supplier-complaint-response/tasks.md`, `specs/supplier-complaint-response/contracts/ingredient-quality-feedback-api.md`, `specs/supplier-complaint-response/contracts/complaint-code-producer.md` và `specs/supplier-complaint-response/quickstart.md`; đồng bộ final behavior, giữ feature pointer ignored.
- [x] T049 Kiểm tra branch/spec association và spec gate tại `.github/scripts/spec-gate.mjs` với base/head/ref đúng feature diff chứa source/schema/plan/tasks; ghi kết quả tại `specs/supplier-complaint-response/quickstart.md`, không nhận HEAD cũ/no-op là pass, không tự commit/push chỉ để tạo bằng chứng.
- [x] T050 Chốt evidence và chỉ tick task hoàn tất trong `specs/supplier-complaint-response/tasks.md`, ghi bàn giao tại `specs/supplier-complaint-response/quickstart.md`: phân biệt shared storage/producer-contract fixtures với creator HTTP BGH chưa có, báo phụ thuộc tạo đơn thật/SC-006 chưa đo; kiểm tra định dạng tài liệu vừa đổi và git diff cuối, không coi integration/gate chưa chạy là đạt hoặc tự deploy/GRANT.

**Checkpoint**: Feature consumer chỉ sẵn sàng bàn giao với bằng chứng quality/migration/integration tương ứng. Hành trình BGH tạo đơn thật→supplier đọc chỉ được nghiệm thu khi owner producer đã tích hợp; task bàn giao phải ghi đúng phụ thuộc, không tự mở rộng scope.

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup T001–T003
  → Foundation T004–T018
  → US1 T019–T024
  → US2 T025–T030
  → US3 T031–T039
  → Polish T040–T050
```

Thứ tự thi công tránh sửa cùng file. Người dùng vẫn gọi trực tiếp detail bằng UUID hoặc POST đúng quyền, không bắt buộc mở list trước. US2 dùng list mapping, US3 dùng detail/lot/code mapping; shared storage và producer contract hoàn tất trước các story.

### Within Each Phase

- Setup tuần tự. Foundation test wave T004/T005/T006 chỉ viết vào ba file tests riêng; sau đó T007(schema)→T008(SQL)→T009(formatter)→T010(allocator)→T011(kiểm chứng tĩnh/unit/generate). Việc viết file migration không đồng nghĩa đã áp DDL.
- Foundation scope/DTO wave T012/T013/T014 sau T011; T015→T016→T017→T018 tích hợp tuần tự. Không owner nào vừa sửa repository/source vừa sửa tests được giao cho người khác.
- US1 test wave T019/T020→T021→T022→T023→T024. US2 test wave T025/T026→T027→T028→T029→T030.
- US3 test wave T031/T032/T033; T034 chỉ bắt đầu khi owner T032 đã bàn giao file; T035→T036→T037→T038→T039 tuần tự.
- Polish doc wave T040/T041/T042→T043→T044→T045→T046→T047→T048→T049→T050. Chạy integration DB chỉ khi đủ authorization, không dựng hạ tầng mới để bỏ qua prerequisite. Không lặp full suites đã qua trừ khi source/SQL thay đổi, failure hoặc concern mới yêu cầu.

### Parallel Opportunities and File Ownership

| Wave                    | [P] tasks        | Files riêng từng owner                                                                                                            |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Foundation — tests      | T004, T005, T006 | tests/complaint-code.test.ts; tests/migrations.test.ts; tests/supplier-onboarding.integration.test.ts                             |
| Foundation — scopes/DTO | T012, T013, T014 | src/utils/resource-access.ts; module validation+request.dto cùng owner; module response.dto                                       |
| US1                     | T019, T020       | tests/ingredient-quality-feedback.test.ts; tests/supplier-onboarding.integration.test.ts                                          |
| US2                     | T025, T026       | tests/ingredient-quality-feedback.test.ts; tests/supplier-onboarding.integration.test.ts                                          |
| US3                     | T031, T032, T033 | tests/ingredient-quality-feedback.test.ts; tests/authorization.integration.test.ts; tests/supplier-onboarding.integration.test.ts |
| Polish                  | T040, T041, T042 | src/modules/README.md; docs/AUTHORIZATION.md; database/SCHEMA_BASELINE.md                                                         |

Tổng16 tasks [P], tối đa3 task trong một wave. Các tên module file rút ngắn trong bảng có path đầy đủ ở task. Không giao cùng test file ở wave sau khi wave trước còn đang chạy. Agent chính giữ source integration, SQL/schema integration, review và verification; nguyên tắc này vẫn áp dụng dù không dùng agents.

## Parallel Example: User Story 1

Sau T018, hai owner có thể viết T019(unit/HTTP) và T020(real-data list) ở hai file riêng. Agent chính review rồi tích hợp repository/service/routes ở T021–T024. Không giao hai agent sửa cùng module hoặc cùng integration file.

## Parallel Example: User Story 2

Sau T024, T025(unit/HTTP detail) và T026(real-data detail/school readback) độc lập về file. Chờ bàn giao rồi agent chính làm T027–T030; lot/code mapper chỉ một owner sửa.

## Parallel Example: User Story 3

Sau T030, tối đa3 owner làm T031(unit), T032(auth/concurrency), T033(readback/invariants). T034 dùng lại auth integration file sau T032; agent chính làm T035–T039 tuần tự, không để allocator lọt vào supplier response callback.

## Requirement Coverage

| Requirement | Implementation / validation tasks                                                  |
| ----------- | ---------------------------------------------------------------------------------- |
| FR-001      | T012, T015, T019, T031–T032, T034, T047                                            |
| FR-002      | T012, T015, T031–T032, T034–T038                                                   |
| FR-003      | T012, T019–T023, T025–T029, T032–T038                                              |
| FR-004      | T020–T022, T026–T028, T033, T035–T037                                              |
| FR-005      | T013, T016, T019–T024                                                              |
| FR-006      | T007–T014, T019–T024                                                               |
| FR-007      | T014, T025–T030                                                                    |
| FR-008      | T013, T016, T031, T036–T038                                                        |
| FR-009      | T031–T038                                                                          |
| FR-010      | T031–T032, T035–T039                                                               |
| FR-011      | T026–T029, T033, T036–T038                                                         |
| FR-012      | T015–T016, T019, T025, T031–T032, T034, T037–T038                                  |
| FR-013      | T013–T014, T016, T019, T025, T027–T028, T031, T044                                 |
| FR-014      | T005, T017–T018, T026, T033, T036–T038, T040–T047                                  |
| FR-015      | T004–T011, T014, T016, T019–T023, T025–T029, T031–T033, T036–T038, T042–T047, T050 |
| SC-001      | T015, T020, T026, T032, T034, T045, T047                                           |
| SC-002      | T005–T006, T019–T024, T045–T047                                                    |
| SC-003      | T006, T026, T031, T033, T036–T039, T045–T047                                       |
| SC-004      | T031–T032, T035–T039, T045, T047                                                   |
| SC-005      | T005, T016, T031–T034, T044–T047                                                   |
| SC-006      | T043, T050 ghi rõ chưa đo; không tạo task frontend hoặc thay bằng test backend     |

FR-015 bao phủ shared storage/migration/allocation contract và supplier consumer. Creator HTTP BGH và authorization của producer chưa được triển khai trong feature này; T043/T050 phải ghi phụ thuộc đó, không nhận fixture là producer thật. Setup T001–T003 và các gates T048–T050 hỗ trợ toàn bộ requirements.

## Implementation Strategy

### MVP First — User Story 1

Hoàn thành Setup/Foundation và US1 để có list đúng supplier, id UUID cùng complaintCode lưu sẵn, metadata trường/chuyến và phân trang. Có thể demo checkpoint bằng fixture được phép; không xem đó là nghiệm thu creator BGH hoặc tự cho phép deploy/merge.

### Incremental Delivery

Thêm US2 để đọc detail/câu trả lời hiện có và kiểm chứng lô/mã; thêm US3 để phản hồi một lần với auth/concurrency. Giữ regressions legacy ở từng mốc. Hoàn tất gates migration/quality/authorization và ghi đúng readiness producer/SC-006 khi bàn giao.

### Parallel Team Strategy

Nếu dùng subagents, chỉ chạy tasks [P] trong cùng wave, tối đa3 subagents, một owner/file. Agent chính giữ source/schema/SQL integration và verification. Không chia ba story cho ba agents cùng sửa service/repository/routes.

## Notes

- Tổng50 tasks: Setup3, Foundation15, US1=6, US2=6, US3=9, Polish11; tất cả chưa thực hiện khi sinh bản cập nhật.
- Mã global do producer tạo một lần; supplier đọc và trả kết quả phản hồi giữ nguyên mã. UUID paths và legacy list10fields không đổi; missing/invalid code không được che bằng fallback/lazy generation.
- Chỉ so sequence không đổi trong tests không có producer cạnh tranh; gaps là bình thường, không kiểm thử liên tục số như business requirement.
- Chỉ so preserved User timestamps do riêng phản hồi, không gộp vào test quản trị đã cố ý touchUser. Migration backfill giữ mọi cột cũ; không tự sửa dữ liệu lịch sử sai ngoài cột mã.
- Không tự thêm HTTP tạo đơn BGH, grants, seed, function/trigger, Counter table, container hoặc workflow. Migrations/data writes trên DB chỉ được chạy khi task/target đã có authorization, không dựa riêng credentials.
- Không tự commit/push, deploy hoặc GRANT. Báo rõ đã/chưa kiểm chứng và phụ thuộc ngoài phạm vi; không tick task bị chặn hoặc kết quả chưa xác minh.
