# Tasks: Quản lý nguyên liệu của nhà cung cấp

**Input**: Thiết kế tại `specs/008-supplier-ingredient-management/`.

**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contract](contracts/ingredient-management.md), [quickstart.md](quickstart.md), `.specify/memory/constitution.md` và `AGENTS.md`.

**Tests**: Có kiểm thử vì spec yêu cầu các acceptance scenarios và SC-001–005, plan/constitution yêu cầu unit, migration và real authorization. Dùng Node test runner hiện có; không thêm framework.

**Organization**: Ba phase theo US1/US2/US3. Mỗi story kiểm chứng độc lập bằng fixture; không cần tạo dữ liệu qua story trước. Các bước sửa cùng module được thực hiện tuần tự để tránh xung đột file.

## Format: `[ID] [P?] [Story] Description`

- Mọi task bắt đầu bằng checkbox, ID tuần tự và đường dẫn file.
- [P] đánh dấu công việc có thể làm song song trong nhóm được nêu tại Dependencies, sau khi đủ prerequisite.
- [US1]/[US2]/[US3] ánh xạ story trong spec; setup, foundation và polish không gắn story.
- Chỉ đánh dấu hoàn tất khi có kết quả kiểm chứng. Trạng thái dưới đây đã được cập nhật sau triển khai và kiểm chứng local; kết quả tại quickstart.md.

## Path Conventions

Đường dẫn từ repository root: `src/`, `prisma/`, `tests/`, `docs/`. Migration mới được đặt tại `prisma/migrations/<timestamp>_supplier_ingredient_management/migration.sql`; thay timestamp bằng thời điểm thực tế lúc tạo và dùng cùng đường dẫn cho toàn bộ tác vụ migration.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Xác nhận đúng feature và chuẩn bị kiểm thử mà không thay dữ liệu đang sử dụng.

- [x] T001 Xác nhận nhánh feat/008-supplier-ingredient-management, đọc và đối chiếu phạm vi tại specs/008-supplier-ingredient-management/spec.md và specs/008-supplier-ingredient-management/plan.md; ghi prerequisite Node/dependencies/disposable local PostgreSQL còn thiếu vào specs/008-supplier-ingredient-management/quickstart.md, không ghi credentials hoặc đọc/in URL bí mật.
- [x] T002 Đăng ký tests/ingredient-management.test.ts trong script test:unit tại package.json và tạo khung file test với Node test runner/tsx, tái sử dụng cách inject auth/repository của tests/modules.test.ts; không thêm dependency hoặc thay cấu hình lint toàn repo.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, tương thích dữ liệu và phạm vi tin cậy dùng chung cho ba story.

**Gate**: Hoàn thành T003–T012 trước khi nối endpoint story. Có thể viết fixture/test story sớm theo hợp đồng, nhưng không mở chức năng khi nền tảng chưa hoàn chỉnh.

- [x] T003 Mở rộng tests/migrations.test.ts bằng fixture nâng cấp từ schema ngay trước migration mới: category null/blank, trùng giữa supplier, khác hoa/thường và khoảng trắng bao quanh; xác nhận định danh/FK/tên phân loại giữ nguyên, ảnh mặc định null/[], đúng ba cột danh mục, FK Restrict và CHECK; giữ kịch bản fresh deploy và dùng database tạm local của harness hiện có.
- [x] T004 Cập nhật prisma/schema.prisma với model IngredientCategory ánh xạ ingredient_categories trong schema foodprint, đúng id/categoryName/categoryDescription; thay Ingredient.category bằng categoryId nullable, quan hệ Restrict/NoAction và index, thêm coverImage nullable TEXT và imageDescription TEXT[] mặc định []; giữ unique supplierId/name và mọi quan hệ hiện có.
- [x] T005 Viết migration mới tại prisma/migrations/<timestamp>_supplier_ingredient_management/migration.sql theo data-model.md: tạo bảng/cột/FK/index/CHECK, backfill DISTINCT chuỗi category có ý nghĩa giữ nguyên giá trị, đối chiếu mapping trước khi drop category, bảo đảm atomic; không sửa migration cũ, tạo seed/function/trigger hoặc chạy lên DB hiện có.
- [x] T006 [P] Thay select và mapping category tại src/modules/menu/menu.service.ts sang quan hệ danh mục cho main/seasoning options và menu detail; giữ output category string/null, pagination và lọc ACTIVE cho lựa chọn mới, không thêm lọc trạng thái vào lịch sử.
- [x] T007 [P] Thay category select/filter/distinct và các projection liên quan tại src/modules/supplier-onboarding/supplier-onboarding.service.ts sang quan hệ/categoryId; giữ filter tên chính xác, category legacy string/null và danh mục dựa trên nguyên liệu ACTIVE; dùng allowlist khi trả ingredients để không lộ trường mới ngoài hợp đồng.
- [x] T008 Cập nhật fixture category tại tests/supplier-onboarding.integration.test.ts và regression consumer tại tests/modules.test.ts theo quan hệ mới; bổ sung xác nhận shape/filter legacy không đổi và không lộ ảnh mới qua việc spread/include bản ghi.
- [x] T009 Thêm helper quản trị nguyên liệu tại src/utils/resource-access.ts yêu cầu chính xác INGREDIENT_SUPPLIER_ADMIN, orgType SUPPLIER, supplierId hợp lệ và ingredient.manage; trả trusted scope cho repository, giữ nguyên listScopes.ingredient và quyền đọc nghiệp vụ cũ.
- [x] T010 Tạo nền tảng src/modules/ingredient/ingredient.repository.ts với shared Prisma client, internal operation-specific input types, khả năng nhận cùng transaction client, đọc supplier status, nạp actor qua loadPrincipal(id, tx), khóa supplier/target theo thứ tự ổn định và đọc nguyên liệu bằng id + supplierId; không import DTO, không mở transaction độc lập trong repository.
- [x] T011 Định nghĩa hợp đồng output tại src/modules/ingredient/ingredient.response.dto.ts cho management item, category và trang items/pagination; đồng thời giữ hợp đồng danh sách legacy, category string/null, timestamp ISO và projection allowlist theo contracts/ingredient-management.md.
- [x] T012 Chuyển truy vấn danh sách legacy từ src/modules/ingredient/ingredient.service.ts sang src/modules/ingredient/ingredient.repository.ts, map tường minh DTO trong service và giữ injection seam hoặc cập nhật tests/modules.test.ts tương ứng; chạy prisma:validate, prisma:generate, typecheck và kiểm thử migration trên DB tạm được chọn, ghi kết quả vào specs/008-supplier-ingredient-management/quickstart.md.

**Checkpoint**: Schema và consumer khớp nhau; đọc legacy giữ quyền/shape; service ingredient không còn tự dựng Prisma query. Integration chưa chạy do thiếu local DB phải được ghi là prerequisite chưa đạt, không đánh dấu foundation hoàn tất.

## Phase 3: User Story 1 — Thêm nguyên liệu thuộc nhà cung cấp của mình (Priority: P1) — MVP

**Goal**: Admin tạo nguyên liệu của supplier hiện tại với danh mục tùy chọn, một ảnh bìa và nhiều ảnh mô tả; staff bị chặn.

**Independent Test**: Fixture admin A/B, staff A và catalog; gọi POST management và GET categories. Kiểm tra row bằng repository/test DB, không phụ thuộc endpoint chi tiết US2. Tạo hợp lệ trả 201, supplier A/ACTIVE; staff có manage vẫn 403; ép supplier B bị 400; tên trùng cùng supplier trả 409.

### Tests for User Story 1

Viết test theo hợp đồng trước phần triển khai, xác nhận các kịch bản chưa có chức năng bị fail đúng nguyên nhân.

- [x] T013 [P] [US1] Viết unit/HTTP tests tạo nguyên liệu và đọc categories tại tests/ingredient-management.test.ts: defaults, một cover/ba ảnh đúng thứ tự, danh mục rỗng, pagination, invalid URL/mảng cover/nested issues, unknown fields, staff có manage, sai role/quyền, supplier không ACTIVE và lỗi DB được che an toàn.
- [x] T014 [P] [US1] Thêm kịch bản create/catalog thật tại tests/authorization.integration.test.ts với admin A/B và staff được gán manage trong fixture DB tạm; kiểm tra ownership tự gắn, tên trùng gồm INACTIVE và hai create cùng tên đồng thời, rollback khi category không tồn tại, recheck actor/quyền/supplier trong transaction.

### Implementation for User Story 1

- [x] T015 [US1] Định nghĩa strict Zod create/category-list schemas và parser safeParse tại src/modules/ingredient/ingredient.validation.ts, Request DTO z.infer với type-only schema import tại src/modules/ingredient/ingredient.request.dto.ts; giữ hợp đồng parser danh sách legacy, defaults/null/trim/giới hạn tên và ảnh theo contract, gom lỗi tiếng Việt với field path và không lộ input.
- [x] T016 [US1] Thêm operation create, category-exists và paginated category-list vào src/modules/ingredient/ingredient.repository.ts; create chỉ nhận trusted supplier scope, projection đúng allowlist, danh mục dùng chung sau khi caller được kiểm tra phạm vi; map P2002/P2003 có liên quan thành HttpError 409/400 trước transaction wrapper.
- [x] T017 [US1] Triển khai create/listCategories tại src/modules/ingredient/ingredient.service.ts: role/quyền và supplier ACTIVE cho cả đọc catalog, authorizationTransaction cho ghi, nạp lại actor và xác nhận supplier không đổi trước mutation, kiểm tra category trong cùng tx, map output DTO; không query hoặc dựng where/select/include trong service.
- [x] T018 [US1] Nối POST /api/ingredients/management và GET /api/ingredients/management/categories trong src/modules/ingredient/ingredient.controller.ts và src/modules/ingredient/ingredient.routes.ts, đặt static route trước params, dùng shared response helper/status 201/200, giữ router mount src/routes/index.ts và GET legacy hiện hành; controller không import DTO.
- [x] T019 [US1] Chạy nhóm US1 trong tests/ingredient-management.test.ts và tests/authorization.integration.test.ts, kiểm tra POST thật không làm đổi dữ liệu supplier B và categories không cung cấp write API; ghi kết quả SC-001/002/003 vào specs/008-supplier-ingredient-management/quickstart.md.

**Checkpoint**: US1 có thể demo độc lập bằng create/catalog và kiểm chứng row; không tự deploy DB đang sử dụng tại checkpoint này.

## Phase 4: User Story 2 — Xem và sửa nguyên liệu thuộc sở hữu (Priority: P1)

**Goal**: Admin xem nguyên liệu riêng gồm ACTIVE/INACTIVE, xem chi tiết và sửa dữ liệu/ảnh/danh mục mà không đổi chủ sở hữu hoặc tự bật lại nguyên liệu.

**Independent Test**: Seed fixture trực tiếp trong DB tạm với nguyên liệu A/B, không cần POST US1; kiểm tra list/detail/PATCH, bỏ qua giữ nguyên, null/[] xóa đúng, target B và không tồn tại cùng 404, staff bị chặn.

### Tests for User Story 2

- [x] T020 [P] [US2] Thêm unit/HTTP tests list/detail/PATCH tại tests/ingredient-management.test.ts: scope, cả hai trạng thái, pagination/hasNext, UUID, sửa rỗng, omit/null/[], nhiều issue, DTO an toàn, cùng lỗi 404 cho target B/missing và không đổi trạng thái INACTIVE sau sửa.
- [x] T021 [P] [US2] Thêm integration read/update tại tests/authorization.integration.test.ts: actor vừa bị thu hồi quyền/khóa/chuyển membership, supplier không ACTIVE, update trùng tên đồng thời, category không tồn tại phải rollback toàn bộ lần sửa, và GET legacy vẫn cho staff có quyền đọc.

### Implementation for User Story 2

- [x] T022 [US2] Thêm management-list, UUID-param và partial-update schemas/parser tại src/modules/ingredient/ingredient.validation.ts cùng inferred contracts trong src/modules/ingredient/ingredient.request.dto.ts; giữ tri-state omit/null/value, không áp default ảnh lên PATCH và từ chối status/supplierId/category cũ.
- [x] T023 [US2] Thêm scoped find-detail, list và update operation tại src/modules/ingredient/ingredient.repository.ts; list order id/take limit+1 gồm cả INACTIVE, query và mutation đều có supplier scope, không dùng unique update không kiểm tra ownership; tái sử dụng cùng tx và mapping conflict.
- [x] T024 [US2] Triển khai listManagement/getDetail/update tại src/modules/ingredient/ingredient.service.ts với scope helper, supplier ACTIVE cho mọi lần đọc, recheck actor và target/category trong transaction cho sửa, giữ trường omit/trạng thái và map DTO ISO; không trả persistence record.
- [x] T025 [US2] Nối GET management, GET management/:ingredientId và PATCH management/:ingredientId qua src/modules/ingredient/ingredient.controller.ts và src/modules/ingredient/ingredient.routes.ts; giữ categories static route ưu tiên và legacy GET không bị siết quyền.
- [x] T026 [US2] Chạy test US2 tại tests/ingredient-management.test.ts và tests/authorization.integration.test.ts, kiểm tra FR-005/006/012/013 và regression tests/modules.test.ts; ghi kết quả và prerequisite chưa đạt vào specs/008-supplier-ingredient-management/quickstart.md.

**Checkpoint**: List/detail/update chạy độc lập trên fixture; không tiết lộ dữ liệu B và không mất trường khi sửa một phần.

## Phase 5: User Story 3 — Ẩn nguyên liệu và bảo toàn lịch sử (Priority: P2)

**Goal**: Admin ẩn nguyên liệu riêng để ngừng lựa chọn mới, vẫn đọc được hồ sơ đã sử dụng nguyên liệu.

**Independent Test**: Fixture A có nguyên liệu ACTIVE gắn menu/kho/hợp đồng; gọi hide hai lần, kiểm tra INACTIVE trong quản trị và bị loại khỏi lựa chọn mới, mọi FK/hồ sơ cũ giữ nguyên. Không cần dùng create/PATCH để chuẩn bị fixture.

### Tests for User Story 3

- [x] T027 [P] [US3] Thêm unit/HTTP tests hide tại tests/ingredient-management.test.ts: ACTIVE → INACTIVE, ẩn lại thành công không đổi updatedAt, body lạ bị từ chối, staff/sai quyền/ngoài scope bị chặn, không có xóa hoặc bật lại.
- [x] T028 [P] [US3] Thêm integration hide tại tests/authorization.integration.test.ts với nguyên liệu có liên kết lịch sử, kiểm tra list quản trị còn hàng, main/seasoning choices không có hàng, FK và hồ sơ cũ còn đủ; kiểm thử hide/update đồng thời cùng recheck actor/quyền/supplier.

### Implementation for User Story 3

- [x] T029 [US3] Thêm validator hide nhận không body hoặc strict object rỗng và UUID param tại src/modules/ingredient/ingredient.validation.ts; thêm inferred Request DTO nếu service cần input chuẩn hóa tại src/modules/ingredient/ingredient.request.dto.ts, không nhận status từ client.
- [x] T030 [US3] Thêm operation hide theo id + supplierId trong src/modules/ingredient/ingredient.repository.ts; ghi INACTIVE bằng tx hiện có, no-op khi đã INACTIVE để giữ timestamp, không delete/cascade hoặc ghi hồ sơ nghiệp vụ khác.
- [x] T031 [US3] Triển khai hide tại src/modules/ingredient/ingredient.service.ts với authorizationTransaction, recheck actor/supplier/target, 404 thống nhất và output DTO; sửa nguyên liệu ẩn vẫn giữ INACTIVE, không cung cấp phục hồi.
- [x] T032 [US3] Nối POST management/:ingredientId/hide trong src/modules/ingredient/ingredient.controller.ts và src/modules/ingredient/ingredient.routes.ts; trả 200 qua sendSuccess cho cả lần ẩn đầu và ẩn lại, chuyển lỗi qua asyncHandler.
- [x] T033 [US3] Thêm regression sau ẩn cho supplier discovery/category choices tại tests/supplier-onboarding.integration.test.ts và menu/history tại tests/modules.test.ts; nếu còn luồng lựa chọn mới chưa lọc ACTIVE thì sửa đúng điểm tại src/modules/menu/menu.service.ts hoặc src/modules/supplier-onboarding/supplier-onboarding.service.ts, không áp filter vào lịch sử.
- [x] T034 [US3] Chạy test US3 và regression history tại tests/ingredient-management.test.ts, tests/authorization.integration.test.ts và tests/supplier-onboarding.integration.test.ts; ghi bằng chứng SC-004 và tính idempotent vào specs/008-supplier-ingredient-management/quickstart.md.

**Checkpoint**: Cả ba story đáp ứng scope; ẩn không xóa hoặc vô hiệu hóa hồ sơ đã tồn tại.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Đồng bộ tài liệu, kiểm tra toàn bộ và ghi kết quả có thật.

- [x] T035 [P] Cập nhật docs/AUTHORIZATION.md và src/modules/README.md với sáu endpoint quản trị, role+permission+supplier ACTIVE, ngoại lệ giữ GET đọc cũ cho staff đủ quyền và catalog chỉ đọc; đối chiếu specs/008-supplier-ingredient-management/contracts/ingredient-management.md.
- [x] T036 [P] Cập nhật database/SCHEMA_BASELINE.md về migration/category FK/ảnh mới và trạng thái kiểm chứng thực tế, giữ phần baseline cũ; ghi yêu cầu phối hợp phiên bản ứng dụng với migration vào specs/008-supplier-ingredient-management/data-model.md, không ghi đã deploy nếu chưa chạy.
- [x] T037 Chạy các script trong package.json: prisma:validate, prisma:generate, validate và test:unit; sửa lỗi thuộc phạm vi thay đổi, không format cả repo, bảo đảm typecheck/build hoàn tất và ghi lỗi nền hoặc prerequisite thiếu tại specs/008-supplier-ingredient-management/quickstart.md.
- [x] T038 Chạy test:migrations, test:authorization và test:supplier-onboarding từ package.json trên PostgreSQL local tạm được chọn tường minh; đối chiếu SC-001–005, concurrency và nâng cấp dữ liệu legacy tại specs/008-supplier-ingredient-management/quickstart.md; nếu thiếu hạ tầng phải ghi chưa chạy, không dùng DB đang sử dụng để thay thế.
- [x] T039 Kiểm tra cấu trúc feature bằng .github/scripts/spec-gate.mjs theo cách chạy được repository hỗ trợ, đối chiếu đủ specs/008-supplier-ingredient-management/spec.md, plan.md, tasks.md với nhánh 008; rà diff không chứa generated Prisma/dist/.env/.specify/feature.json và không sửa migration đã áp dụng.
- [x] T040 Hoàn thiện bảng kết quả thực thi trong specs/008-supplier-ingredient-management/quickstart.md và trạng thái checkbox tại specs/008-supplier-ingredient-management/tasks.md; ghi kiểm tra đã chạy/bị chặn, không tự commit/push/deploy hoặc đánh dấu task chưa kiểm chứng là hoàn tất.

## Dependencies & Execution Order

### Phase Dependencies

Setup T001 → T002 → Foundational T003–T012 → các story → Polish T035–T040.

Trong foundation:

- T003 thiết kế test trước thay schema; T004 → T005 để migration và Prisma thống nhất.
- T006 và T007 cùng bắt đầu sau T005, sửa file khác nhau; T008 chờ cả hai.
- T009 → T010 → T011 → T012 theo thứ tự an toàn; T012 chờ toàn bộ T003–T011 và kết quả migration tests.
- Không đổi database đang sử dụng trong bất kỳ tác vụ nào nếu chưa có authorization cho target đó. Cho phép ghi schema/migration file theo yêu cầu tính năng không đồng nghĩa deploy.

### User Story Dependencies

```text
Setup → Foundation ┬→ US1: create + catalog ─┐
                   ├→ US2: list/detail/edit ├→ Polish + final checks
                   └→ US3: hide/history ────┘
```

Mỗi story dùng fixture độc lập, chỉ phụ thuộc nền tảng về mặt nghiệp vụ. Do cùng sửa ingredient.service/repository/validation/routes và hai file test, lịch triển khai mặc định là US1 → US2 → US3; không chỉnh cùng file song song. Story sau tái sử dụng primitive đã có, nhưng không yêu cầu gọi endpoint story trước để hoạt động.

### Within Each Story

Test contracts và fixture trước, xác nhận fail vì tính năng chưa có; validation/DTO → repository → service → controller/routes → chạy kiểm chứng. Không coi test chưa chạy vì thiếu DB là pass.

### Parallel Opportunities

- Foundation: T006 ↔ T007 sau T005.
- US1: T013 ↔ T014 sau foundation; hoàn tất test trước T015–T019.
- US2: T020 ↔ T021 sau khi phần chỉnh file của US1 hoàn tất.
- US3: T027 ↔ T028 sau khi phần chỉnh file của US2 hoàn tất.
- Polish: T035 ↔ T036 sau cả ba story; T037 → T038 → T039 → T040 thực hiện tuần tự để kết quả thống nhất.

## Parallel Example: User Story 1

Viết unit/HTTP contract tại tests/ingredient-management.test.ts (T013) đồng thời viết integration create/catalog tại tests/authorization.integration.test.ts (T014). Hai file riêng; hợp đồng chung đã cố định trong contracts/ingredient-management.md. Không chạy chung integration tạo/xóa DB nếu harness không cô lập được database của từng tiến trình.

## Parallel Example: User Story 2

T020 chuẩn bị assertions omit/null/[] và 404 trong file unit; T021 chuẩn bị fixture real DB/revocation/unique race trong file integration. Sau đó triển khai T022–T025 theo thứ tự, tránh hai người sửa service/repository cùng lúc.

## Parallel Example: User Story 3

T027 viết idempotent hide/validation bằng repository giả; T028 chuẩn bị history/concurrency trên DB tạm. Sau đó T029–T033 lần lượt nối chức năng và regression; không sửa tests/modules.test.ts đồng thời với foundation T008.

## Implementation Strategy

### MVP First

Hoàn thành setup + foundation + US1 (T001–T019). Demo admin tạo nguyên liệu đúng supplier, chọn danh mục, lưu một ảnh bìa/nhiều ảnh và chặn staff. Kiểm chứng row trực tiếp qua fixture/repository khi chưa có chi tiết US2. MVP là checkpoint đánh giá; nhiệm vụ triển khai đầy đủ vẫn cần US2, US3 và final checks.

### Incremental Delivery

Tiếp tục US2 để xem/sửa; sau đó US3 để ngừng lựa chọn mới và giữ lịch sử. Mỗi increment chạy test riêng và regression đọc cũ. Không mặc định deploy sau mỗi story: thay cột category cần phối hợp phiên bản theo plan, deploy chỉ khi được phép.

### Requirement Coverage

| Yêu cầu            | Task chính                                       |
| ------------------ | ------------------------------------------------ |
| FR-001/002, SC-002 | T009–T010, T013–T018, T020–T025, T027–T032, T038 |
| FR-003/004, SC-001 | T004–T005, T013–T019, T021–T026                  |
| FR-005/006/012     | T011–T012, T020–T026                             |
| FR-007, SC-003     | T004–T005, T013–T019, T020–T026                  |
| FR-008/009/010     | T003–T008, T014–T018                             |
| FR-011, SC-004     | T027–T034                                        |
| FR-013             | T013–T018, T020–T025, T027–T032                  |
| FR-014, SC-005     | T003–T008, T012, T036, T038                      |

## Notes

Có 40 task: setup 2, foundation 10, US1 7, US2 7, US3 8, polish 6. Có 10 task [P] trong 5 cặp công việc khác file; chúng chỉ song song sau các prerequisite ghi trên.

Đã kiểm tra không có .specify/extensions.yml khi sinh tasks: không có before_tasks/after_tasks hooks phải thực thi. Đã triển khai và kiểm chứng toàn bộ task trên hạ tầng test local; chưa deploy database đang sử dụng hoặc Azure. Kết quả chi tiết tại quickstart.md.
