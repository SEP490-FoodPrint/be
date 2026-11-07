# Tasks: Tra cứu và xem chi tiết trường học, nhà cung cấp

**Input**: Design documents from `specs/006-school-supplier-admin/`
**Branch**: `feat/006-school-list`
**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/admin-directory.md](contracts/admin-directory.md), [quickstart.md](quickstart.md).

**Tests**: Các task kiểm thử thực hiện tiêu chí acceptance của spec, chiến lược unit/HTTP/integration trong plan và quality gate bắt buộc của AGENTS.md/constitution. Viết kịch bản trước implementation; hoàn tất và chạy sau khi nối luồng. Không áp dụng TDD cho mọi thay đổi tài liệu.

**Organization**: Theo bốn user story P1; mọi đường dẫn tương đối từ repository root. Không tạo model/migration, seed, grant quyền, frontend, sắp xếp tùy chọn hoặc chỉ số hoạt động ngoài spec.

## Format: `[ID] [P?] [Story] Description`

[P] chỉ công việc có thể làm đồng thời với task độc lập trong cùng giai đoạn đã đủ prerequisite. Không chạy đồng thời hai task sửa cùng tệp. [US1]–[US4] ánh xạ story trong spec; task nền/hoàn thiện không có story label.

## Phase 1: Setup

**Goal**: Xác nhận môi trường và chuẩn bị kiểm thử theo dự án hiện có.

- [x] T001 Đối chiếu .nvmrc, package.json và README.md; ghi prerequisite Node/npm, Prisma Client và trạng thái hạ tầng trong specs/006-school-supplier-admin/quickstart.md, không ghi secret hoặc tự chọn DB test.
- [x] T002 Tạo tests/school-supplier-admin.test.ts với fixture principal/repository/storage giả và HTTP harness theo tests/modules.test.ts; đăng ký tệp mới trong script test:unit của package.json, không thêm framework.

**Checkpoint**: Môi trường và harness đã rõ; chưa thay schema/dữ liệu.

## Phase 2: Foundational — chặn các user story

**Goal**: Cung cấp read transaction và primitive validation dùng chung; giữ scope từ resource-access và parser generic hiện hành.

- [x] T003 [P] Tạo withReadTransaction trong src/utils/read-transaction.ts dùng shared Prisma client, callback cùng tx và isolationLevel RepeatableRead; giữ HttpError, chuyển lỗi hạ tầng sang 503, không chứa query nghiệp vụ hay provider call.
- [x] T004 [P] Bổ sung primitive Zod cho page/limit, query rỗng và ánh xạ nhiều issue/field path tại src/utils/directory-validation.ts (tái sử dụng src/utils/request-validation.ts); giữ nguyên hành vi parseListQuery/readListPage của module không liên quan, giới hạn offset 2147483647 và message tiếng Việt không phản chiếu raw input.
- [x] T005 Thêm và chạy kiểm chứng transaction/validation trong tests/school-supplier-admin.test.ts: cùng tx, RepeatableRead, giữ 400/403/404, chuyển lỗi DB sang 503, unknown keys/array/multiple issues và giới hạn số; dùng src/utils/read-transaction.ts và src/utils/directory-validation.ts đã hoàn tất.

**Checkpoint**: Nền tảng sẵn sàng cho các story.

## Phase 3: User Story 1 — Tra cứu toàn bộ danh sách (P1, MVP)

**Goal**: GET /api/schools và /api/suppliers tìm kiếm/lọc toàn scope, đủ liên hệ, total và hasNext.

**Independent Test**: Dữ liệu 100 đơn vị mỗi loại, mục khớp ngoài 5 dòng đầu; 12 kết quả chia 5/5/2; literal %, _, backslash, case/dấu; scope và null chính xác.

### Tests

- [x] T006 [P] [US1] Viết kiểm thử hợp đồng list trong tests/school-supplier-admin.test.ts: search/status AND, query strict/default/trim/max 255, null liên hệ, ISO dates, total/hasNext, trang trống/vượt cuối, thiếu quyền trước I/O và lỗi 503; hoàn thiện fixture theo hợp đồng trước implementation.
- [ ] T007 [P] [US1] Thêm kịch bản PostgreSQL cho list trong tests/authorization.integration.test.ts: bộ 100 đơn vị, tìm tên/mã/taxCode, literal %, _, backslash, phân biệt dấu và snapshot hai connection commit giữa count/items; dùng DB tạm/Redis prefix của harness, không seed DB thành viên.

### Implementation

- [x] T008 [P] [US1] Mở organizationListQuerySchema trong src/modules/organization/organization.validation.ts cho search/status; cập nhật src/modules/organization/organization.request.dto.ts và src/modules/organization/organization.response.dto.ts bằng z.infer và projection liên hệ/total, bảo toàn public/cooking-mode schemas.
- [x] T009 [P] [US1] Tạo schema strict list trong src/modules/supplier/supplier.validation.ts cùng src/modules/supplier/supplier.request.dto.ts và src/modules/supplier/supplier.response.dto.ts; định nghĩa search/status, null contact và pagination.total, chỉ service import DTO.
- [x] T010 [US1] Bổ sung read count/items nhận trusted scope và tx trong src/modules/organization/organization.repository.ts; AND scope/status với OR name/code, escape literal search, take=limit, id asc và select allowlist; bỏ quyết định phân quyền list khỏi repository.
- [x] T011 [US1] Tạo src/modules/supplier/supplier.repository.ts để chuyển query list khỏi service: nhận trusted scope/tx, AND scope/status với OR name/taxCode và literal search; count/items chung predicate, take=limit, id asc; giữ factory seam cho test.
- [x] T012 [US1] Cập nhật src/modules/organization/organization.service.ts: listScopes.organization trước I/O, withReadTransaction, repository cùng tx, explicit DTO/null/Date mapping và hasNext từ total; không dựng Prisma query trong service.
- [x] T013 [US1] Cập nhật src/modules/supplier/supplier.service.ts theo Request/Response DTO, listScopes.supplier và cùng tx cho count/items; map allowlist/ISO/null, giữ hành vi scope SCHOOL quan hệ ACTIVE/SUSPENDED và SUPPLIER own.
- [x] T014 [US1] Cập nhật src/modules/organization/organization.controller.ts, src/modules/supplier/supplier.controller.ts và hai file organization.routes.ts/supplier.routes.ts tương ứng để gọi validator/service, sendSuccess/sendError với error.fields; chạy test US1 và sửa regression list trong tests/modules.test.ts mà không làm yếu assertion scope/projection.

**Checkpoint**: Các tiêu chí của US1 có thể kiểm chứng độc lập; thiếu hạ tầng phải ghi rõ, không xem là đã đạt.

## Phase 4: User Story 2 — Tổng quan số lượng (P1)

**Goal**: Hai summary độc lập bộ lọc danh sách, chỉ System Admin có permission tương ứng.

**Independent Test**: Mỗi loại 100 đơn vị/85 ACTIVE trả 100/85 dù đổi bộ lọc list; dữ liệu trống 0/0; sai role/quyền 403.

### Tests

- [x] T015 [US2] Viết kiểm thử summary trong tests/school-supplier-admin.test.ts: query rỗng strict, 100/85 và 0/0, SYSTEM thiếu quyền, tổ chức không phải SYSTEM và lỗi 503; dữ liệu được ánh xạ chỉ total/activeCount.

### Implementation

- [x] T016 [P] [US2] Bổ sung summary query/Request DTO/Response DTO và repository/service trong src/modules/organization/organization.validation.ts, src/modules/organization/organization.request.dto.ts, src/modules/organization/organization.response.dto.ts, src/modules/organization/organization.repository.ts, src/modules/organization/organization.service.ts; kiểm tra ROLES.SYSTEM_ADMIN/ORG_TYPES.SYSTEM + school.manage, hai count cùng snapshot.
- [x] T017 [P] [US2] Bổ sung summary query/DTO/repository/service trong src/modules/supplier/supplier.validation.ts, src/modules/supplier/supplier.request.dto.ts, src/modules/supplier/supplier.response.dto.ts, src/modules/supplier/supplier.repository.ts, src/modules/supplier/supplier.service.ts; SYSTEM_ADMIN + supplier.view OR supplier.manage; total/ACTIVE cùng snapshot.
- [x] T018 [US2] Đăng ký GET /summary và controller trong src/modules/organization/organization.routes.ts, src/modules/organization/organization.controller.ts, src/modules/supplier/supplier.routes.ts, src/modules/supplier/supplier.controller.ts; không nhận filter list, không để route ID bắt summary.
- [ ] T019 [US2] Bổ sung và chạy kiểm chứng summary trong tests/authorization.integration.test.ts với 100/85, 0/0, độc lập list và permission thật; chạy unit summary trong tests/school-supplier-admin.test.ts, ghi prerequisite thiếu nếu chưa chạy được integration.

**Checkpoint**: Các tiêu chí của US2 có thể kiểm chứng độc lập; thiếu hạ tầng phải ghi rõ, không xem là đã đạt.

## Phase 5: User Story 3 — Chi tiết trường SA-04 (P1)

**Goal**: Mở trực tiếp trường ACTIVE/INACTIVE và ba nhóm lớp/quan hệ/tài khoản theo quyền độc lập.

**Independent Test**: Mở trường INACTIVE chưa tải danh sách; ba nhóm đúng parent, đúng projection và total; nhóm trống 200/0, parent ngoài scope 404, thiếu quyền nhóm 403.

### Tests

- [x] T020 [P] [US3] Viết kiểm thử detail và ba nhóm trường trong tests/school-supplier-admin.test.ts: UUID/query, null, toàn bộ trạng thái/năm học, quan hệ UNLINKED, roleCode/roleName, quyền từng nhóm không yêu cầu school.manage và parent trống/ngoài scope.
- [ ] T021 [P] [US3] Thêm integration SA-04 trong tests/authorization.integration.test.ts: hai trường, supplier có quan hệ với từng trường, user SCHOOL/denial/System thiếu quyền; chứng minh count/items không lộ tenant và supplier chỉ thấy quan hệ của mình, không thấy lớp/tài khoản.

### Implementation

- [x] T022 [US3] Thêm detail schema/DTO/repository/service trong src/modules/organization/organization.validation.ts, src/modules/organization/organization.request.dto.ts, src/modules/organization/organization.response.dto.ts, src/modules/organization/organization.repository.ts, src/modules/organization/organization.service.ts; findFirst với scope AND id, hỗ trợ INACTIVE và explicit mapping, ngoài scope 404.
- [x] T023 [P] [US3] Định nghĩa params schoolId/query page-limit strict cùng src/modules/class/class.validation.ts, src/modules/class/class.request.dto.ts, src/modules/class/class.response.dto.ts; lớp có academicYear nullable, registeredMealPortions đã lưu và timestamps.
- [x] T024 [P] [US3] Định nghĩa params/query strict cùng src/modules/school-supplier/school-supplier.validation.ts, src/modules/school-supplier/school-supplier.request.dto.ts, src/modules/school-supplier/school-supplier.response.dto.ts; phân biệt status quan hệ với supplierStatus, bổ sung supplierName.
- [x] T025 [P] [US3] Định nghĩa params/query strict cùng src/modules/user/user.validation.ts, src/modules/user/user.request.dto.ts, src/modules/user/user.response.dto.ts; account DTO chỉ id/schoolId/fullName/email/roleCode/roleName/status theo mọi AccountStatus.
- [x] T026 [US3] Tạo src/modules/class/class.repository.ts: chuyển persistence list hiện có khỏi service, thêm parent check có scope và count/items theo trường nhận cùng tx, id asc/select allowlist; giữ generic /classes không thêm filter.
- [x] T027 [US3] Tạo src/modules/school-supplier/school-supplier.repository.ts: chuyển persistence hiện có, thêm parent school check theo scope quan hệ, count/items AND schoolId và join supplier name/status; giữ mọi lần liên kết, kể cả UNLINKED, không group theo supplier.
- [x] T028 [US3] Tạo src/modules/user/user.repository.ts: chuyển persistence hiện có, parent school check theo user scope, count/items với schoolId và Role.code/name; giữ projection generic /users hiện có, không trả password/grants.
- [x] T029 [US3] Cập nhật src/modules/class/class.service.ts dùng Request/Response DTO, listScopes.class trước I/O, read transaction và mapping; thêm handler validate/sendSuccess/next tại src/modules/class/class.controller.ts, export router con trong src/modules/class/class.routes.ts.
- [x] T030 [US3] Cập nhật src/modules/school-supplier/school-supplier.service.ts dùng DTO, listScopes school-supplier, cùng tx cho parent/count/items và mapping status riêng; thêm handler tại src/modules/school-supplier/school-supplier.controller.ts và export router con tại src/modules/school-supplier/school-supplier.routes.ts.
- [x] T031 [US3] Cập nhật src/modules/user/user.service.ts dùng DTO và listScopes.user/assertOrganizationManager hiện hành; SYSTEM user.manage, SCHOOL admin school_user.manage, không SUPPLIER scope tài khoản trường; thêm handler tại src/modules/user/user.controller.ts và router con tại src/modules/user/user.routes.ts.
- [x] T032 [US3] Gắn GET /:id tại src/modules/organization/organization.controller.ts và src/modules/organization/organization.routes.ts; mount router con /schools/:schoolId/classes, /suppliers, /accounts tại src/routes/index.ts với mergeParams/params phù hợp; giữ mỗi nhóm guard riêng và thứ tự public/me/summary trước ID.
- [ ] T033 [US3] Chạy kiểm chứng US3 trong tests/school-supplier-admin.test.ts và tests/authorization.integration.test.ts khi đủ hạ tầng; sửa regression trong tests/modules.test.ts, bảo toàn generic list/query và public ACTIVE-only/cooking-mode route, không đánh dấu integration pass nếu chưa chạy.

**Checkpoint**: Các tiêu chí của US3 có thể kiểm chứng độc lập; thiếu hạ tầng phải ghi rõ, không xem là đã đạt.

## Phase 6: User Story 4 — Chi tiết nhà cung cấp và minh chứng SA-08 (P1)

**Goal**: Mở supplier trực tiếp, lấy chứng nhận theo supplier và xem từng tệp có quyền/ownership xác minh.

**Independent Test**: Supplier INACTIVE chưa tải list; nhiều sibling files mở được; sai certificate_N/cross supplier/metadata lỗi bị chặn; quyền theo chứng nhận dù applicant đổi tổ chức.

### Tests

- [x] T034 [P] [US4] Viết unit/HTTP tests trong tests/school-supplier-admin.test.ts cho supplier detail, certificate list và file endpoint: query/UUID, ISO/null, batch metadata, no-store/60 giây, storage chỉ gọi sau quyền/nhóm hợp lệ, hạ tầng 503 và không lộ metadata nội bộ.
- [ ] T035 [P] [US4] Thêm integration SA-08 trong tests/authorization.integration.test.ts: System chỉ supplier_certification.view mở được file, chỉ registration.view bị chặn endpoint mới, supplier khác/sai nhóm 404, applicant đổi supplier không đổi ownership; endpoint review cũ giữ permission.

### Implementation

- [x] T036 [US4] Thêm detail validation/DTO/repository/service tại src/modules/supplier/supplier.validation.ts, src/modules/supplier/supplier.request.dto.ts, src/modules/supplier/supplier.response.dto.ts, src/modules/supplier/supplier.repository.ts, src/modules/supplier/supplier.service.ts; scope AND id, ACTIVE/INACTIVE, mapping giống item list và 404 ngoài scope.
- [x] T037 [US4] Định nghĩa params supplierId, params id/documentId, page-limit và empty-query schemas tại src/modules/supplier-certification/supplier-certification.validation.ts; tạo src/modules/supplier-certification/supplier-certification.request.dto.ts và src/modules/supplier-certification/supplier-certification.response.dto.ts với documents metadata và URL result.
- [x] T038 [US4] Tạo src/modules/supplier-certification/supplier-certification.repository.ts: chuyển query generic khỏi service, thêm parent supplier check và certificate count/items/find-by-id trong trusted scope, cùng tx và safe selects; giữ generic /supplier-certifications chỉ page/limit và trường cũ.
- [x] T039 [US4] Bổ sung batch read RegistrationRequest theo anchor IDs tại src/modules/supplier-certification/supplier-certification.repository.ts, chỉ APPROVED/requestType SUPPLIER và select metadata cần thiết; không đọc mọi hồ sơ hoặc query từng chứng nhận, không dùng applicant.supplierId làm quyền.
- [x] T040 [US4] Thêm resolver nội bộ trong src/modules/supplier-certification/supplier-certification.service.ts dùng readDocuments từ src/utils/onboarding-documents.ts: anchor nội bộ chính xác, certificate_N/index hợp lệ, ID không trùng, bytes safe integer dương, format hợp lệ; malformed/legacy thành nhóm rỗng, không catch nuốt lỗi I/O.
- [x] T041 [US4] Triển khai list theo supplier trong src/modules/supplier-certification/supplier-certification.service.ts: listScopes supplier-certification trước I/O, parent/count/items/batch metadata cùng tx, map explicit certificate DTO/documents allowlist; thiếu metadata trả [], không trả documentUrl/publicId/profileData.
- [x] T042 [US4] Triển khai mở tệp trong src/modules/supplier-certification/supplier-certification.service.ts: đọc chứng nhận có scope, xác minh tệp đúng nhóm anchor, ngoài scope/nhóm 404; gọi DocumentStorage.download sau transaction, trả url/expiresIn=60, chuẩn hóa storage failure 503.
- [x] T043 [US4] Thêm validate/handler tại src/modules/supplier-certification/supplier-certification.controller.ts và export router con tại src/modules/supplier-certification/supplier-certification.routes.ts; đăng ký GET /:id/documents/:documentId, guard supplier_certification.view + scope, Cache-Control no-store, không đòi registration.view.
- [x] T044 [US4] Thêm supplier detail handler tại src/modules/supplier/supplier.controller.ts và src/modules/supplier/supplier.routes.ts, summary trước ID; mount /suppliers/:supplierId/certifications tại src/routes/index.ts với params đúng và quyền riêng, không blanket supplier.view.
- [ ] T045 [US4] Chạy tests/school-supplier-admin.test.ts, tests/onboarding.test.ts và integration tests/authorization.integration.test.ts khi có local test target; xác minh metadata hỏng/anchor thiếu/URL ngoài/hồ sơ sai loại/file mất và không thay quyền endpoint onboarding cũ.

**Checkpoint**: Các tiêu chí của US4 có thể kiểm chứng độc lập; thiếu hạ tầng phải ghi rõ, không xem là đã đạt.

## Phase 7: Polish & Cross-Cutting Concerns

**Goal**: Hoàn tất tài liệu tích hợp, regression và quality gates; ghi kết quả thật.

- [x] T046 [P] Cập nhật docs/AUTHORIZATION.md và src/modules/README.md về 11 endpoint, permission/scope/parent check, null/total và tính tương thích; dẫn specs/006-school-supplier-admin/contracts/admin-directory.md cho frontend.
- [x] T047 Kiểm tra code của các module chạm tới trong src/modules/organization/, src/modules/supplier/, src/modules/class/, src/modules/school-supplier/, src/modules/user/, src/modules/supplier-certification/ và src/utils/read-transaction.ts: DTO chỉ service tiêu thụ, repository không import DTO, không Prisma query trong service, không secret/raw DB response/cache/schema change.
- [x] T048 Chạy npm run prisma:validate, npm run validate (đã gồm typecheck/build) và npm run test:unit theo package.json; xử lý lỗi trong phạm vi feature, ghi lệnh/kết quả thực vào specs/006-school-supplier-admin/quickstart.md.
- [ ] T049 Thực hiện toàn bộ ma trận trong specs/006-school-supplier-admin/quickstart.md; chạy npm run test:authorization chỉ với target local disposable được chọn rõ ràng, db:check/redis:check khi hạ tầng sẵn có; ghi PASS/FAIL/BLOCKED có lý do, không chạy Azure/migration/seed DB thành viên.
- [x] T050 Đối chiếu spec/plan/tasks và hợp đồng tại specs/006-school-supplier-admin/ trước bàn giao; kiểm tra branch feat/006-school-list, số feature 006 và .github/scripts/spec-gate.mjs; chỉ tick task đã hoàn tất, ghi các kiểm chứng còn bị chặn trong specs/006-school-supplier-admin/quickstart.md.

**Checkpoint**: Tài liệu và kết quả kiểm chứng khớp phạm vi đã thực hiện.

## Dependencies & Execution Order

### Phase và story dependencies

```text
Setup T001–T002
  → Foundation T003–T005
    → US1 T006–T014 (MVP)
      → US2 T015–T019
      → US3 T020–T033
      → US4 T034–T045
        → Polish T046–T050 sau khi cả US2, US3, US4 hoàn tất
```

US2/US3/US4 tái sử dụng hợp đồng, repository và transaction seam đã có ở US1. Đây là phụ thuộc kỹ thuật để tránh tạo nền tảng trùng, không phải phụ thuộc dữ liệu màn hình: summary không phụ thuộc bộ lọc list, detail không cần tải list trước. US3 và US4 không phụ thuộc nhau về nghiệp vụ. Trình tự mặc định an toàn: Phase 1 → 2 → 3 → 4 → 5 → 6 → 7.

### Prerequisites của task

| Task                                    | Prerequisite trực tiếp                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| T003, T004                              | T001–T002; hai task này độc lập nhau                                                     |
| T005                                    | T003–T004                                                                                |
| T006–T009                               | T005; T006/T007 và T008/T009 có thể thực hiện riêng các cặp độc lập                      |
| T010 → T012                             | T008 cho repository; T010 cho service                                                    |
| T011 → T013                             | T009 cho repository; T011 cho service                                                    |
| T014                                    | T006–T013; nối routes và chạy US1                                                        |
| T015                                    | T014                                                                                     |
| T016, T017                              | T015; hai module độc lập                                                                 |
| T018 → T019                             | T016–T017 cho routes; T018 cho kiểm chứng                                                |
| T020–T022                               | T014; mặc định sau T019 để tránh sửa chung file                                          |
| T023–T025                               | T014; ba module độc lập                                                                  |
| T026 → T029                             | T023 cho repository; T026 cho service/controller/router con                              |
| T027 → T030                             | T024 cho repository; T027 cho service/controller/router con                              |
| T028 → T031                             | T025 cho repository; T028 cho service/controller/router con                              |
| T032 → T033                             | T022 và T029–T031 cho wiring; T020–T021 và T032 cho kiểm chứng                           |
| T034–T037                               | T014; mặc định sau T033 để tránh sửa chung tests/index                                   |
| T038 → T039 → T040 → T041 → T042 → T043 | T037 trước T038; sau đó theo chuỗi repository/metadata/resolver/list/download/controller |
| T044                                    | T036 và T043                                                                             |
| T045                                    | T034–T044                                                                                |
| T046–T047                               | T019, T033, T045                                                                         |
| T048 → T049 → T050                      | T046–T047 trước quality; sau đó kiểm chứng và đối chiếu cuối                             |

T007/T019/T021/T035 chỉ bổ sung kịch bản vào harness có chính sách target hiện hành, không tự chạy integration khi chưa có target được operator chọn. T002 chỉ tạo harness/unit đăng ký script; không tạo fixture DB thật.

### Trong từng story

Viết test case trước; sau đó schema/DTO → repository → service → controller/routes → wiring → chạy test. Không cần tạo persistence model mới. Generic endpoint hiện có đi qua kiến trúc phân lớp khi module bị sửa, nhưng query/projection/envelope cũ phải được bảo toàn. Service định nghĩa transaction boundary, các repository tham gia dùng cùng tx; không ký URL trong transaction.

### Parallel opportunities và ví dụ theo story

- Foundation: T003 (read transaction) song song T004 (validation). T005 chờ cả hai.
- US1: T006 (unit/HTTP) song song T007 (integration cases); T008 (school contracts) song song T009 (supplier contracts). Khi hợp đồng xong, hai chuỗi T010 → T012 và T011 → T013 có thể do hai người thực hiện; T014 chờ hợp nhất.
- US2: Sau T015, T016 (school summary) song song T017 (supplier summary); T018 chờ cả hai.
- US3: T020 song song T021; T023/T024/T025 độc lập; sau hợp đồng, các chuỗi class T026 → T029, relationship T027 → T030 và user T028 → T031 có thể làm đồng thời, rồi T032 nối routes.
- US4: T034 song song T035. Sau khi test cases đã ghi xong, T036 (supplier detail) độc lập với chuỗi certification T037 → T038 → T039 → T040 → T041 → T042 → T043; T044 chờ cả hai.
- T046 (tài liệu) có thể song song T047 (review code), sau khi các story hoàn tất.

Không chạy hai task cùng ghi tests/school-supplier-admin.test.ts, tests/authorization.integration.test.ts, src/routes/index.ts hoặc cùng module organization/supplier. Làm US2/US3/US4 đồng thời chỉ khi đã phân quyền sở hữu tệp và tuần tự hóa wiring/test chung; mặc định làm theo thứ tự pha. Các chuỗi song song bổ sung nêu ở đây vẫn phải thỏa prerequisite; [P] không bỏ qua dependency.

## Requirement Coverage

| Phạm vi                                                | Tasks thực hiện và kiểm chứng                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| FR-001–006, SC-001–002: search/filter/contact/total    | T004–T014                                                                   |
| FR-007–008, SC-003: summary độc lập, role + permission | T015–T019                                                                   |
| FR-009–010, SC-004: detail định danh/INACTIVE/public   | T020–T022, T032–T036, T044–T045                                             |
| FR-011–014: lớp, quan hệ, tài khoản trường             | T020–T021, T023–T033                                                        |
| FR-015–018, SC-006: chứng nhận và nhiều tệp            | T034–T035, T037–T045                                                        |
| FR-019–021, SC-005: permission/denial/scope            | T006–T007, T012–T013, T015–T019, T020–T021, T029–T032, T034–T035, T041–T045 |
| FR-022–023: envelope/allowlist/serialization/lỗi       | T003–T006, T008–T014, T020, T023–T025, T029–T034, T037–T045, T047–T049      |
| Regression và quality gates                            | T014, T019, T033, T045–T050                                                 |

## Implementation Strategy

### MVP first

Hoàn tất Setup + Foundation + US1 (T001–T014), kiểm chứng hai danh sách trên toàn bộ phạm vi cho phép. Đây là phần bàn giao đầu tiên hữu ích cho frontend chuyển tìm kiếm/lọc sang backend. MVP không thay thế yêu cầu phải hoàn thành các story còn lại trong phạm vi đã chốt.

### Incremental delivery

Sau MVP, thêm US2 để có card tổng quan; US3 để hoàn thiện SA-04; US4 để hoàn thiện SA-08. Mỗi story có checkpoint riêng, không làm mất hành vi story đã hoàn tất. Chỉ chạy thao tác môi trường đúng quyền hiện có; tasks không cấp phép triển khai Azure, bootstrap, seed hoặc thay schema.

### Definition of completion

Một task chỉ được tick khi đã thực hiện và có bằng chứng kiểm chứng phù hợp. Test bị chặn bởi prerequisite không được ghi PASS. Trước bàn giao, T050 đối chiếu trạng thái thật trong tasks.md và quickstart.md; các điểm chưa xác minh phải được ghi rõ.

## Notes

- Danh sách gồm 50 task: Setup 2, Foundation 3, US1 9, US2 5, US3 14, US4 12, Polish 5.
- 16 task có [P]; cơ hội song song khác chỉ được thực hiện khi prerequisite đã xong và tệp không xung đột.
- Không có extensions.yml tại thời điểm tạo task: không có hook before_tasks/after_tasks cần chạy.
- Đây là danh sách công việc để thực hiện; chưa có task implementation nào được đánh dấu hoàn tất trong lần sinh tài liệu.

## Trạng thái thực thi

Đã triển khai các endpoint và chạy unit/quality gates. T007/T019/T021/T033/T035/T045/T049 còn mở: kịch bản tích hợp đã bổ sung một phần, chưa đủ bằng chứng PostgreSQL thật do thiếu MIGRATION_TEST_DATABASE_URL local disposable. Cần hoàn thiện các trường hợp tích hợp còn thiếu và chạy toàn ma trận trước khi coi feature hoàn tất. Không có hook before/after implement được cấu hình.
