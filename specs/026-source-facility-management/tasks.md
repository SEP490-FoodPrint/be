# Tasks: Quản lý cơ sở cung cấp nguyên liệu

**Input**: Design documents từ specs/026-source-facility-management/

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/source-facility-api.md](contracts/source-facility-api.md), [quickstart.md](quickstart.md).

**Branch**: feat/026-source-facility-management

**Tests**: Bao gồm kiểm thử được yêu cầu bởi các acceptance scenario và SC-001–006 trong spec, cùng chiến lược kiểm chứng đã chốt trong plan. Viết các ca của mỗi story trước implementation và quan sát thất bại đúng hành vi còn thiếu; không yêu cầu suite phải lỗi import hoặc lỗi biên dịch. Kiểm thử PostgreSQL thực chỉ chạy khi instance disposable được chọn rõ ràng và được phép; mọi trạng thái bị chặn phải được ghi thật.

**Organization**: Bốn user story theo spec: US1 thêm (P1), US2 danh sách/chi tiết (P1), US3 sửa (P2), US4 dừng (P2). Giữ schema hiện có; không có task migration, seed database thành viên, DELETE hoặc kích hoạt lại.

## Format: ID, P, Story, Description

- Mọi task có checkbox, ID tuần tự và đường dẫn file cụ thể.
- [P] chỉ cho phép chạy song song với task khác file khi các dependency trong phần cuối đã hoàn tất; không bỏ qua thứ tự test trước implementation.
- [US1]–[US4] bắt buộc trong phase story; setup/foundation/polish không gắn story.

## Path Conventions

Đường dẫn dưới đây tương đối từ repository root. Source tại src/, test tại tests/, tài liệu feature tại specs/026-source-facility-management/. Repository hiện có, không khởi tạo project hoặc cài dependency mới.

## Phase 1: Setup — Chuẩn bị phạm vi và test seam

**Purpose**: Xác nhận baseline và chuẩn bị fixture tái sử dụng, không tác động database.

- [x] T001 Đối chiếu nhánh feat/026-source-facility-management, Node/npm theo .nvmrc và package.json, module hiện có với specs/026-source-facility-management/plan.md; ghi prerequisite còn thiếu vào specs/026-source-facility-management/quickstart.md, xác nhận không cần thay prisma/schema.prisma hoặc migration.
- [x] T002 Chuẩn bị factory AuthPrincipal, repository/connect giả lập và HTTP helper trong tests/source-facility-management.test.ts; chuẩn bị nhóm fixture source facility dùng lại supplier/admin/session và cleanup của tests/authorization.integration.test.ts, chưa chạy hoặc tạo dữ liệu ngoài database disposable.

**Checkpoint**: Có test seam để inject service/repository và fixture tích hợp dùng chung; không tạo framework/client/database mới.

## Phase 2: Foundational — Các phần dùng chung bắt buộc

**Purpose**: Phân quyền, validation chung, DTO và transaction/repository đủ để triển khai độc lập từng story.

- [x] T003 [P] Thêm SourceFacilityManagementScope và sourceFacilityManagementScope tại src/utils/resource-access.ts: đúng INGREDIENT_SUPPLIER_ADMIN, SUPPLIER membership hợp lệ, source_facility.manage; đồng bộ listScopes["source-facility"] để bỏ nhánh SYSTEM toàn cục và staff, luôn trả phạm vi supplierId tin cậy.
- [x] T004 [P] Hoàn thiện trường văn bản dùng chung, schema query page/limit và params sourceFacilityId tại src/modules/source-facility/source-facility.validation.ts; dùng Zod strict, parseRequest/requestUuidSchema, trim, giới hạn phân trang hiện có và lỗi tiếng Việt; chưa thêm hành vi create/update/deactivate trước task story tương ứng.
- [x] T005 Tạo các Request DTO query/params trong src/modules/source-facility/source-facility.request.dto.ts bằng z.infer với type-only import schema từ src/modules/source-facility/source-facility.validation.ts; chỉ service được import DTO, bổ sung DTO từng thao tác ở phase story.
- [x] T006 [P] Tạo hợp đồng list item/page/detail/create trong src/modules/source-facility/source-facility.response.dto.ts theo allowlist tại specs/026-source-facility-management/contracts/source-facility-api.md; ngày giờ là string ISO, facilityCode read giữ string|null cho legacy và create mới là string.
- [x] T007 Tạo src/modules/source-facility/source-facility.repository.ts với select/list/find scoped, actor qua loadPrincipal(id, tx), supplierStatus, lockSupplier, lockTarget, nameExists và nhận diện constraint lỗi tên/mã; dùng client chung, internal input types, locks supplier trước target, không import DTO hoặc tự mở transaction.
- [x] T008 Tái cấu trúc src/modules/source-facility/source-facility.service.ts sang repository injection: chuyển mọi Prisma query/select/where/order sang src/modules/source-facility/source-facility.repository.ts, map allowlist/ISO trong service, kiểm tra supplier ACTIVE cho read và tạo write helper dùng authorizationTransaction để recheck actor/quyền/scope/supplier trong cùng tx; giữ getAll hoạt động và không đổi kiểu seam ngoài phạm vi cần thiết.

**Checkpoint**: Service không còn query; repository áp supplierId; mọi write sẽ dùng cùng Serializable transaction với actor recheck. Phase này chặn tất cả story. Không thêm cache, bypass, counter hoặc schema.

## Phase 3: User Story 1 — Thêm cơ sở của mình (Priority: P1) — MVP

**Goal**: POST /api/source-facilities tạo cơ sở cho supplier hiện tại, có mã FP-SF tự sinh theo dãy riêng.

**Independent Test**: Admin A tạo hai cơ sở nhận 00001/00002; B nhận 00001; POST trả 201 và đúng dữ liệu/audit. Staff/SYSTEM hoặc field readonly bị chặn. Hai create khác tên cùng supplier thành công không trùng mã.

### Tests for User Story 1

- [x] T009 [P] [US1] Viết unit/HTTP cho create và formatter trong tests/source-facility-management.test.ts: chỉ name bắt buộc, trim/null/empty của bốn optional, giới hạn và nhiều lỗi error.fields, cấm field readonly kể cả null/rỗng, ISO/allowlist/audit, trùng tên 409 và supplier/role/permission không hợp lệ; thêm ca formatter 1, 99999, 100000, số vượt Number.MAX_SAFE_INTEGER và giới hạn 80 ký tự.
- [x] T010 [P] [US1] Viết ca create tích hợp trong tests/authorization.integration.test.ts: A/B có dãy riêng và cùng tên hợp lệ giữa supplier; staff/SYSTEM dù có permission vẫn bị chặn; tên đã có kể cả INACTIVE không tạo lại; dùng login/session và database mới tạo của suite hiện có.

### Implementation for User Story 1

- [x] T011 [P] [US1] Tạo formatter và nhận diện mã canonical thuần tại src/utils/source-facility-code.ts: FP-SF- viết hoa, số dương bigint pad tối thiểu năm chữ số, không Number/giới hạn 64-bit, kiểm tra mã mới không vượt varchar(80); không dùng hoặc sửa dãy registration-id.
- [x] T012 [P] [US1] Thêm create strict schema/validator tại src/modules/source-facility/source-facility.validation.ts và Request DTO tương ứng tại src/modules/source-facility/source-facility.request.dto.ts: chỉ name/address/contactName/contactPhone/contactEmail, bốn optional mặc định null sau normalize; gửi facilityCode hoặc trường khác phải 400.
- [x] T013 [P] [US1] Thêm highestCodeNumber/create tại src/modules/source-facility/source-facility.repository.ts: numeric MAX hậu tố canonical của đúng supplier trên cả INACTIVE/isVisible=false, CASE bảo vệ cast từng hậu tố bên trong MAX, trả text/bigint; insert cùng tx và allowlist/audit; chỉ dịch constraint tên thành 409, giữ unique mã cho shared retry.
- [x] T014 [US1] Thêm create trong src/modules/source-facility/source-facility.service.ts dùng write helper, kiểm tra tên qua repository, tính max+1 bằng bigint và formatter, truyền trusted scope/actor cho repo, map CreateResponse chỉ trả sau commit; mã vượt độ dài hoặc hết retry trả 503, không query/transaction độc lập.
- [x] T015 [US1] Nối POST / và controller create tại src/modules/source-facility/source-facility.routes.ts và src/modules/source-facility/source-facility.controller.ts; xác thực/helper scope trước controller, validate rồi gọi service, sendSuccess với 201; áp guard chung để mọi route hiện có đều bị giới hạn supplier admin.
- [x] T016 [US1] Bổ sung race cấp mã trên hai connection thật trong tests/authorization.integration.test.ts: barrier chỉ ở attempt đầu sau đọc actor và trước lock supplier; ép snapshot cũ, chứng minh retry đọc lại max và mã không trùng; thêm race cùng tên chỉ một thành công/một 409, giữ khóa A không dùng dãy/khóa toàn cục cho B.
- [x] T017 [US1] Bổ sung numeric/legacy cases trong tests/authorization.integration.test.ts: 99999 sang 100000, số lớn hơn 64-bit vẫn chính xác, canonical cao ở INACTIVE/isVisible=false được tính; null/malformed/lowercase không bị cast hoặc đánh lại; hậu tố 74 chữ số 9 làm create tiếp theo 503 không insert, restart service không reset dãy.
- [x] T018 [US1] Bổ sung rollback/retry và actor recheck trong tests/source-facility-management.test.ts và tests/authorization.integration.test.ts: thu hồi quyền/đổi membership/supplier trước ghi không tạo cơ sở; cùng tx cho actor/max/insert; unique mã không bị dịch thành 409 tên, lỗi sau cấp số rollback và hết retry trả 503 không partial writes.

**Checkpoint**: US1 đáp ứng FR-004–006/010/014–017 và SC-001/002/005/006 cho thao tác tạo. Có thể xác minh MVP bằng kết quả POST mà không cần endpoint chi tiết mới.

## Phase 4: User Story 2 — Danh sách và chi tiết (Priority: P1)

**Goal**: GET danh sách phân trang và GET một cơ sở của chính supplier, bao gồm ACTIVE/INACTIVE.

**Independent Test**: Fixture 45 cơ sở A, có INACTIVE/isVisible=false và cơ sở B: đọc ba trang 20/20/5, không trùng/thiếu/lẫn B; chi tiết đúng allowlist; UUID của B và UUID không tồn tại cùng 404.

### Tests for User Story 2

- [x] T019 [P] [US2] Viết unit/HTTP GET trong tests/source-facility-management.test.ts: query/UUID strict, limit tối đa 100/offset hợp lệ, list rỗng/trang cuối/hasNext/order, Date ISO và projection list/detail, legacy mã null, supplier inactive và role/permission denied, target ngoài scope cùng 404.
- [x] T020 [P] [US2] Viết ca đọc tích hợp trong tests/authorization.integration.test.ts với 45 cơ sở A và dữ liệu B: phân trang 20/20/5 trên tập không đổi, ACTIVE/INACTIVE/isVisible=false đều có trong quản trị, chi tiết tenant đúng và không dùng facilityCode thay UUID.

### Implementation for User Story 2

- [x] T021 [US2] Hoàn thiện list/find và projection riêng list/detail tại src/modules/source-facility/source-facility.repository.ts: supplierId trong mọi WHERE, thứ tự id tăng, limit+1, không lọc status/isVisible, không query count/total hoặc trả user relations.
- [x] T022 [US2] Hoàn thiện getAll/getDetail tại src/modules/source-facility/source-facility.service.ts: dùng Request/Response DTO, supplier ACTIVE, map ISO/allowlist, cắt trang/hasNext và cùng thông báo không tìm thấy cho null/out-of-scope; read legacy không sinh lại mã.
- [x] T023 [US2] Nối GET / và GET /:sourceFacilityId trong src/modules/source-facility/source-facility.controller.ts và src/modules/source-facility/source-facility.routes.ts; validation query/params và sendSuccess giữ envelope/page hiện hành, controller không import DTO.
- [x] T024 [US2] Cập nhật regression HTTP liên quan source-facilities trong tests/modules.test.ts để giữ anonymous/forged-role checks và thích ứng injection seam sau refactor; bảo đảm không mở lại SYSTEM hoặc staff scope khi dùng app factory hiện có.

**Checkpoint**: US2 kiểm chứng độc lập bằng fixture; không phải gọi POST để chuẩn bị dữ liệu. Đạt FR-007/008/013 và SC-003, không thay đổi contract create của US1.

## Phase 5: User Story 3 — Sửa thông tin cơ sở (Priority: P2)

**Goal**: PATCH năm trường nhập, giữ mã/chủ sở hữu/trạng thái và các trường omitted.

**Independent Test**: Sửa riêng địa chỉ và clear email của cơ sở A; đối chiếu trường omitted, mã và audit người tạo. Cơ sở INACTIVE vẫn sửa được nhưng không ACTIVE lại; gửi mã hoặc sửa target B bị chặn.

### Tests for User Story 3

- [x] T025 [P] [US3] Viết unit/HTTP PATCH trong tests/source-facility-management.test.ts: partial/omit khác null/empty, name không null/rỗng, body {} bị từ chối, nhiều lỗi cùng lúc, cấm facilityCode/id/supplier/status/isVisible/audit, Date/allowlist và supplier-role guard.
- [x] T026 [P] [US3] Viết ca update tích hợp trong tests/authorization.integration.test.ts: sửa ACTIVE/INACTIVE, tên trùng cùng supplier 409 kể cả race đổi tên, tenant 404, giữ mã/isVisible/created audit/IngredientLot links và chỉ cập nhật updated audit; request thất bại giữ nguyên dữ liệu.

### Implementation for User Story 3

- [x] T027 [P] [US3] Thêm update strict partial schema tại src/modules/source-facility/source-facility.validation.ts và DTO z.infer tại src/modules/source-facility/source-facility.request.dto.ts; cần ít nhất một trường, không default null cho omitted, cho clear bốn optional và chỉ nhận năm trường đã xác nhận.
- [x] T028 [P] [US3] Thêm update scoped tại src/modules/source-facility/source-facility.repository.ts: lọc id+supplierId, chỉ ghi editable fields và updatedByUserId, không ghi đè omitted/code/status/isVisible/created audit; dùng tx được truyền, nhận diện trùng tên 409, đọc lại kết quả cùng tx.
- [x] T029 [US3] Thêm update tại src/modules/source-facility/source-facility.service.ts: write helper recheck actor, lock target scoped và kiểm tra tồn tại, gọi repo với actor hiện tại rồi map detail; cho sửa INACTIVE và không thay mã/trạng thái.
- [x] T030 [US3] Nối PATCH /:sourceFacilityId tại src/modules/source-facility/source-facility.controller.ts và src/modules/source-facility/source-facility.routes.ts; validate params/body trước service, trả 200 qua sendSuccess, dùng guard chung.

**Checkpoint**: Đạt FR-009/010/012/013/014/016 cho sửa; không cần create hoặc deactivate API để kiểm chứng bằng fixture.

## Phase 6: User Story 4 — Dừng hoạt động và giữ lịch sử (Priority: P2)

**Goal**: POST /:sourceFacilityId/deactivate chỉ chuyển ACTIVE sang INACTIVE, dừng lặp thành công.

**Independent Test**: Dừng cơ sở có lô liên quan; còn đọc được, mã/isVisible/sourceFacilityId không đổi; dừng lại không đổi audit; tạo cơ sở tiếp theo không tái sử dụng mã.

### Tests for User Story 4

- [x] T031 [P] [US4] Viết unit/HTTP deactivate trong tests/source-facility-management.test.ts: body absent/{} hợp lệ, null/array/status/reason không hợp lệ; ACTIVE sang INACTIVE, dừng lặp không ghi audit, tenant 404 và actor/supplier/quyền không hợp lệ không được ghi.
- [x] T032 [P] [US4] Viết ca dừng tích hợp trong tests/authorization.integration.test.ts: cơ sở có IngredientLot vẫn dừng được, liên kết/lịch sử/mã/isVisible không đổi, lặp idempotent, còn xem/sửa được, create tiếp không tái sử dụng mã; target B và quyền bị thu hồi không đổi dữ liệu.

### Implementation for User Story 4

- [x] T033 [P] [US4] Thêm schema/validator action empty strict tại src/modules/source-facility/source-facility.validation.ts và Request DTO tại src/modules/source-facility/source-facility.request.dto.ts; chỉ chuẩn hóa undefined thành {}, từ chối null/array/trường không được phép.
- [x] T034 [P] [US4] Thêm deactivate trong src/modules/source-facility/source-facility.repository.ts: update scoped id+supplierId+status ACTIVE sang INACTIVE, đặt updatedByUserId và để Prisma @updatedAt cập nhật thời gian; không sửa code/isVisible/lô/created audit và không có phương thức delete/reactivate.
- [x] T035 [US4] Thêm deactivate trong src/modules/source-facility/source-facility.service.ts: cùng write helper/tx, khóa và đọc target scoped, 404 nếu thiếu; INACTIVE trả lại DTO hiện tại không gọi write; ACTIVE gọi repo rồi map detail sau commit, không kiểm tra chặn vì có lô lịch sử.
- [x] T036 [US4] Nối POST /:sourceFacilityId/deactivate tại src/modules/source-facility/source-facility.controller.ts và src/modules/source-facility/source-facility.routes.ts; validate params/body, dùng guard chung và sendSuccess 200 cho cả chuyển trạng thái và dừng lặp.

**Checkpoint**: Đạt FR-011/012/013/014/016 và SC-004; không xóa, bật lại hoặc thay đổi nghiệp vụ lô/đơn hàng.

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Đồng bộ tài liệu/quyền và kiểm chứng toàn bộ feature.

- [x] T037 [P] Cập nhật docs/AUTHORIZATION.md với đúng năm endpoint, supplier-admin-only kể cả danh sách, permission source_facility.manage và scope supplier; ghi ngoại lệ rõ với mô tả SYSTEM toàn cục chung hiện có, không thêm permission/grant mới.
- [x] T038 [P] Cập nhật src/modules/README.md về ownership/module và năm endpoint source facility, mã riêng mỗi supplier, không xóa và bảo toàn lịch sử; liên kết contract specs/026-source-facility-management/contracts/source-facility-api.md khi phù hợp.
- [x] T039 [P] Đăng ký tests/source-facility-management.test.ts vào script test:unit tại package.json; giữ test:authorization/CI hiện có để chạy phần integration đã mở rộng, không thêm framework/dependency hoặc thay lockfile.
- [x] T040 Rà soát và bổ sung kiểm chứng xuyên suốt năm route trong tests/source-facility-management.test.ts, tests/authorization.integration.test.ts, tests/authorization.test.ts và tests/modules.test.ts: staff/SYSTEM có permission vẫn bị chặn, cập nhật kỳ vọng generic list scope cho chức năng admin-only, supplier/account inactive, unknown/readonly input, actor recheck cùng tx, safe projection/ISO, 404 không lộ tenant, lỗi 503 không lộ SQL; kiểm tra không còn Prisma query hoặc DTO import sai tầng trong src/modules/source-facility/.
- [x] T041 Chạy npm run prisma:validate, npm run validate và npm run test:unit; chạy npm run test:authorization khi hạ tầng disposable được chọn/được phép, theo specs/026-source-facility-management/quickstart.md; ghi lệnh, pass/fail, thời gian concurrency/fixture lớn hoặc prerequisite bị chặn vào quickstart.md, đối chiếu FR-001–017/SC-001–006 và cập nhật checkbox đã hoàn thành trong specs/026-source-facility-management/tasks.md bằng kết quả thật.

**Checkpoint**: Không đánh dấu hoàn tất kiểm chứng PostgreSQL khi chỉ có mock/unit hoặc thiếu hạ tầng; không chạy lại các bước đã đạt trừ khi có thay đổi/lỗi mới. Không reformat cả repository để sửa lỗi cũ ngoài feature.

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1 (T001–T002)
  -> Phase 2 (T003–T008)
       -> US1 (T009–T018)
       -> US2 (T019–T024)
       -> US3 (T025–T030)
       -> US4 (T031–T036)
  -> Phase 7 (T037–T041), sau khi đủ bốn story
```

Story không có phụ thuộc nghiệp vụ bắt buộc vào story khác: có thể dùng fixture để xác minh riêng. Tuy nhiên chúng chỉnh chung các file module và test nên lịch thực hiện mặc định là US1 -> US2 -> US3 -> US4; không mở đồng thời hai story trên cùng file.

### Task Dependencies

| Phạm vi    | Dependency và các lượt thực hiện                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup      | T001 -> T002.                                                                                                                                                                        |
| Foundation | Sau T002, T003/T004/T006 độc lập; T005 sau T004; T007 sau T003/T006; T008 sau T003–T007.                                                                                             |
| US1        | T009/T010 cùng lượt test; khi test đã sẵn sàng và xác nhận hành vi thiếu, T011/T012/T013 cùng lượt implementation; T014 sau cả ba; T015 sau T014; T016 -> T017 -> T018 sau endpoint. |
| US2        | T019/T020 cùng lượt test; T021 -> T022 -> T023 -> T024 sau test.                                                                                                                     |
| US3        | T025/T026 cùng lượt test; T027/T028 cùng lượt implementation sau test; T029 sau cả hai; T030 sau T029.                                                                               |
| US4        | T031/T032 cùng lượt test; T033/T034 cùng lượt implementation sau test; T035 sau cả hai; T036 sau T035.                                                                               |
| Polish     | T037/T038/T039 độc lập sau đủ story; T040 sau chúng; T041 sau T040.                                                                                                                  |

Trong mọi story: test được viết trước; repository trước service; validation/DTO trước controller; service trước endpoints. T016–T018 mở rộng cùng integration file nên làm tuần tự. Không giữ barrier ở retry hoặc đặt barrier sau supplier lock.

### Requirement Coverage

| Yêu cầu spec                                                       | Task chịu trách nhiệm chính                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| FR-001: đủ năm thao tác                                            | T015, T023, T030, T036, T040                                               |
| FR-002–003: admin, permission, supplier scope                      | T003, T007–T008, T009–T010, T018, T020, T040                               |
| FR-004–005, FR-010, FR-015: dữ liệu nhập, mặc định, chuẩn hóa, lỗi | T004–T006, T009, T012, T014, T025, T027, T031, T033                        |
| FR-006, FR-017: tên/mã scoped, tự cấp mã và race                   | T011, T013–T014, T016–T018, T026, T028                                     |
| FR-007–008: danh sách và chi tiết                                  | T006–T008, T019–T024                                                       |
| FR-009: sửa allowlist và omitted                                   | T025–T030                                                                  |
| FR-011–012: dừng, không xóa/bật lại, vẫn sửa INACTIVE              | T026, T029, T031–T036                                                      |
| FR-013–014: target tenant, recheck actor cùng tx                   | T007–T008, T018, T020, T026, T029, T032, T035, T040                        |
| FR-016: audit đúng, giữ người/thời điểm tạo                        | T009, T013–T014, T026, T028–T029, T031–T035                                |
| SC-001–006: bằng chứng hoàn tất                                    | Các task test của từng story và T041; kết quả thật ghi trong quickstart.md |

### Parallel Opportunities và ví dụ cho từng story

| Story | Lượt test khác file                   | Lượt implementation khác file                                              |
| ----- | ------------------------------------- | -------------------------------------------------------------------------- |
| US1   | T009 unit/HTTP cùng T010 integration. | Sau test, T011 formatter, T012 validation/Request DTO và T013 repository.  |
| US2   | T019 unit/HTTP cùng T020 integration. | Không đánh dấu song song thêm: query, service và endpoint nối theo thứ tự. |
| US3   | T025 unit/HTTP cùng T026 integration. | Sau test, T027 validation/Request DTO cùng T028 repository.                |
| US4   | T031 unit/HTTP cùng T032 integration. | Sau test, T033 validation/Request DTO cùng T034 repository.                |

Foundation có T003/T004/T006 khác file; polish có T037/T038/T039 khác file. Các ví dụ chỉ áp dụng sau prerequisite tương ứng; đây không phải chỉ dẫn chạy integration lên database đang sử dụng.

## Implementation Strategy

### MVP First — User Story 1

1. Hoàn tất Setup và Foundation.
2. Làm US1 đến T018: supplier admin có thể tạo cơ sở, nhận mã tự sinh và phản hồi chi tiết ngay từ POST.
3. Xác minh US1 theo checkpoint; đây là mốc MVP, không phải yêu cầu dừng công việc còn lại hoặc tự deploy.

### Incremental Delivery

Tiếp tục US2 để xem danh sách/chi tiết, US3 để sửa, US4 để dừng; sau mỗi story chạy kiểm tra phù hợp với thay đổi và giữ kết quả các story trước. Hoàn thiện tài liệu và quality gates ở Phase 7. Chỉ PR code khi đủ spec/plan/tasks và các kết quả kiểm chứng được ghi trung thực.

## Notes

- Tổng cộng 41 task: setup 2, foundation 6, US1 10, US2 6, US3 6, US4 6, polish 5. Có 21 task [P], chia theo các lượt dependency trên.
- Mọi thay đổi source thực hiện trên branch feature đã xác nhận, theo constitution và AGENTS.md; giữ CommonJS/import, DTO tách riêng, no DB query trong service.
- Không sửa schema, migration đã áp dụng, generated output, permission catalog hoặc dữ liệu legacy; mọi fixture chỉ thuộc database test mới khi được phép.
- Không commit, push, mở PR hoặc deploy chỉ vì hoàn tất task; các hành động đó theo yêu cầu phiên làm việc và quy trình dự án.
- Khi chỉ một phần task hoàn thành, chỉ tick phần có bằng chứng; task bị chặn vẫn để trống và ghi prerequisite cụ thể.

## Implementation result — 2026-11-14

Hoàn tất 41/41 task. Triển khai được điều phối tối đa ba subagent với ownership file riêng; agent chính tích hợp service/controller/routes và kiểm chứng. Các bài test POST/chi tiết/PATCH/deactivate đã được quan sát lỗi 404 trước triển khai. Bộ unit riêng đạt 21/21; bộ unit toàn dự án đạt 442/442; authorization integration trên PostgreSQL 18 tạm đạt 43/43, gồm bốn nhóm source facility. npm run prisma:validate và npm run validate đều đạt. Chi tiết lệnh, regression đã sửa và thời gian kiểm thử nằm trong quickstart.md. Không có before_implement/after_implement hook được cấu hình.
