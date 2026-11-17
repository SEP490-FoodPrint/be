# Tasks: Nhà cung cấp xem trường đã liên kết và hợp đồng

**Input**: Thiết kế tại `specs/supplier-linked-schools/`

**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [API contract](contracts/supplier-schools-api.md), [quickstart.md](quickstart.md).

**Tests**: Bao gồm các kiểm chứng được mô tả trong Independent Test, acceptance scenarios và SC-001–SC-005 của spec; tuân thủ kiểm tra backend/phân quyền bắt buộc của AGENTS.md. Các test trong từng story được viết trước phần triển khai và phải thể hiện lỗi khi hành vi chưa có; không viết test chỉ để đối chiếu từng dòng triển khai.

**Organization**: Ba story đều P1 theo spec. Tasks được chia theo story để có checkpoint độc lập; triển khai lần lượt vì dùng chung bảy file module và các file test.

## Format: `[ID] [P?] [Story] Description`

- Mỗi task có checkbox chưa hoàn thành, ID tuần tự và đường dẫn file cụ thể.
- `[P]` chỉ cho công việc có thể song song trong cùng wave đã nêu, sau khi các prerequisite hoàn tất.
- `[US1]`/`[US2]`/`[US3]` chỉ dùng trong phase user story.
- Một file chỉ có một người/agent sửa tại một thời điểm; không chạy đồng thời các story trên các file module dùng chung.
- Dùng `src/`, `tests/`, `docs/` và `specs/` tương đối từ repository root. Không có task tạo model, migration, seed hoặc frontend.

## Phase 1: Setup — Phạm vi và cấu trúc dùng chung

**Purpose**: Chuẩn bị cấu trúc theo kiến trúc hiện có, không khởi tạo ứng dụng/framework mới.

- [x] T001 Đối chiếu `specs/supplier-linked-schools/spec.md`, `specs/supplier-linked-schools/plan.md`, `AGENTS.md` và `.specify/memory/constitution.md`; ghi trong `specs/supplier-linked-schools/quickstart.md` baseline kiểm chứng và điều kiện test local đã xác định, giữ SC-006 chưa đo; không sửa quyền hoặc dữ liệu thực.
- [x] T002 Tạo bộ khung bảy file `src/modules/supplier-school/supplier-school.routes.ts`, `src/modules/supplier-school/supplier-school.controller.ts`, `src/modules/supplier-school/supplier-school.validation.ts`, `src/modules/supplier-school/supplier-school.request.dto.ts`, `src/modules/supplier-school/supplier-school.response.dto.ts`, `src/modules/supplier-school/supplier-school.service.ts` và `src/modules/supplier-school/supplier-school.repository.ts`; chuẩn bị factory injectable, dùng shared Prisma/read transaction, import CommonJS theo quy ước; chưa cung cấp hành vi thành công giả.
- [x] T003 Tạo test harness injectable trong `tests/supplier-school.test.ts`, tách mock principal/repository/transaction và HTTP app theo mẫu hiện có; đăng ký file trong `package.json` script test:unit, không thêm framework hoặc suite runner.

**Checkpoint**: Có cấu trúc và nơi chạy unit/HTTP tests; T001–T003 hoàn tất trước foundation.

## Phase 2: Foundational — Phân quyền, hợp đồng dữ liệu và tích hợp router

**Purpose**: Prerequisite chung của mọi story. T004–T007 là một wave độc lập sau Phase 1; T008–T010 chờ các thành phần chúng kiểm chứng.

- [x] T004 [P] Thêm resource `supplier-school` vào RESOURCE_PERMISSIONS/listScopes và helper `supplierSchoolReadScope` trong `src/utils/resource-access.ts`: chỉ INGREDIENT_SUPPLIER_ADMIN thuộc SUPPLIER có supplierId, không có membership trường/ATTP; yêu cầu OR supplier_relationship.view/manage hiệu lực và trả trusted scope `{ supplierId }`; giữ nguyên scope của resource cũ và không SYSTEM bypass.
- [x] T005 [P] Thêm duy nhất default grant existing supplier_relationship.view cho INGREDIENT_SUPPLIER_ADMIN trong `src/constants/permission-catalog.ts`; không thêm permission, grant staff/manage, không đổi `src/utils/authorization-bootstrap.ts` hoặc tự thực thi bootstrap.
- [x] T006 [P] Khai báo strict schemas cho page/limit, params schoolId/contractId/documentId, empty query và disposition inline/attachment mặc định inline trong `src/modules/supplier-school/supplier-school.validation.ts`; tái sử dụng paginationSchema/requestUuidSchema/parseRequest; khai báo Request DTO bằng z.infer với type-only imports trong `src/modules/supplier-school/supplier-school.request.dto.ts`, chỉ service dùng DTO.
- [x] T007 [P] Khai báo các Response DTO school list/detail, relationship summary/detail, contract list/detail, document metadata, pagination và binary output riêng trong `src/modules/supplier-school/supplier-school.response.dto.ts` theo allowlist của `specs/supplier-linked-schools/contracts/supplier-schools-api.md`; phân biệt timestamp/date-only/null và Uint8Array không serialize JSON.
- [x] T008 Sau T004–T005, bổ sung kiểm chứng scope admin-only, OR permissions, membership không hợp lệ, default grant mới và bootstrap bảo toàn role hiện hữu trong `tests/authorization.test.ts`; cập nhật vòng Object.entries(listScopes) để supplier-school thuộc nhóm không cho SYSTEM bypass, giữ assertion của các resource khác và inactive flags/denials hiện có.
- [x] T009 Sau T006–T007, bổ sung kiểm chứng input chung trong `tests/supplier-school.test.ts`: UUID chuẩn hóa, defaults1/20, max100/offset2147483647, số không hợp lệ/overflow/mảng/object, unknown query kể cả supplierId/orgId, empty query và disposition; kiểm tra lỗi400 tổng hợp field paths tiếng Việt không chứa raw input.
- [x] T010 Sau T004 và bộ khung T002, hoàn thiện auth/scope guard của factory trong `src/modules/supplier-school/supplier-school.routes.ts` và mount /supplier-schools trong `src/routes/index.ts` với authHandler dùng chung; kiểm tra guard trước validation và service vẫn tự kiểm tra scope khi gọi trực tiếp; giữ các router school-supplier/supplier-onboarding nguyên hành vi.

**Checkpoint**: Foundation hoàn tất; auth/schema/DTO đã ổn định để các story viết test trước triển khai. Không thay schema hoặc dữ liệu đang dùng.

## Phase 3: User Story 1 — Xem danh sách trường đã liên kết (Priority: P1) — MVP

**Goal**: GET /api/supplier-schools trả mỗi trường đúng một mục với quan hệ đại diện và phân trang ổn định trong supplier scope.

**Independent Test**: Dùng hai supplier có trường riêng/chung, trường chưa liên kết và nhiều đợt liên kết; chỉ gọi endpoint danh sách, đối chiếu tập trường, trạng thái và các trang mà không cần endpoint detail/hợp đồng.

### Tests for User Story 1

- [x] T011 [P] [US1] Viết unit/HTTP tests danh sách trong `tests/supplier-school.test.ts`: trả đồng thời id UUID và code mã trường (code chưa có thì null, không thay bằng UUID), role/quyền, default/giới hạn trang, safe fields/null/date, private/no-store, danh sách rỗng, hasNext, lỗi DB503 đã sanitize, service dùng trusted scope/cùng read transaction; chạy để xác nhận fail vì hành vi danh sách chưa có.
- [x] T012 [P] [US1] Thêm fixture và regression PostgreSQL/HTTP trong `tests/supplier-onboarding.integration.test.ts` cho trường riêng/chung/chưa liên kết/DRAFT-only, nhiều UNLINKED và ACTIVE/SUSPENDED, trường INACTIVE, tie linkedAt/id và trường hợp quan hệ hiện tại cũ hơn lịch sử bất thường; duyệt nhiều trang để chứng minh chọn đại diện trước LIMIT, không trùng/mất; fixtures chỉ ở database disposable của suite.

### Implementation for User Story 1

- [x] T013 [US1] Triển khai query danh sách trong `src/modules/supplier-school/supplier-school.repository.ts` bằng tagged tx.$queryRaw với CTE DISTINCT ON school_id lọc trusted supplierId, ưu tiên ACTIVE/SUSPENDED rồi linked_at DESC/id ASC; outer join schools và ORDER BY đại diện linked_at DESC/school_id ASC trước OFFSET/LIMIT limit+1; select cột tường minh, không queryRawUnsafe hoặc distinct/sort toàn bộ trong bộ nhớ.
- [x] T014 [US1] Triển khai service danh sách trong `src/modules/supplier-school/supplier-school.service.ts`: supplierSchoolReadScope, withReadTransaction, limit+1→items/hasNext và mapping từng trường theo DTO, timestamp ISO/null; không dựng Prisma where/select/include hoặc trả persistence record trực tiếp.
- [x] T015 [US1] Triển khai controller danh sách trong `src/modules/supplier-school/supplier-school.controller.ts` và GET / trong `src/modules/supplier-school/supplier-school.routes.ts`: validate query, gọi service, sendSuccess với message trong contract, đặt private/no-store; controller không import DTO, lỗi chuyển qua asyncHandler.
- [x] T016 [US1] Chạy unit/HTTP danh sách và regression PostgreSQL mới trong `tests/supplier-school.test.ts`, `tests/supplier-onboarding.integration.test.ts` bằng runner theo `specs/supplier-linked-schools/quickstart.md`; ghi lệnh/kết quả hoặc prerequisite bị chặn vào quickstart, đối chiếu SC-001/SC-005 trước khi chuyển story.

**Checkpoint**: MVP danh sách có thể kiểm chứng riêng. Khi chưa được phép dùng instance disposable, không thực thi ghi fixture hoặc báo test PostgreSQL đã đạt.

## Phase 4: User Story 2 — Xem chi tiết trường và quan hệ hợp tác (Priority: P1)

**Goal**: GET /api/supplier-schools/:schoolId trả hồ sơ và quan hệ đại diện đúng cặp, bao gồm trường INACTIVE/liên kết lịch sử.

**Independent Test**: Truy cập trực tiếp schoolId đã biết mà không gọi danh sách; kiểm tra hồ sơ/null/trạng thái và404 đồng nhất cho trường ngoài scope hoặc không tồn tại.

### Tests for User Story 2

- [x] T017 [P] [US2] Viết unit/HTTP tests detail trong `tests/supplier-school.test.ts`: profile allowlist, nullable, relationship mốc/lý do, trường hợp không có hợp đồng vẫn200, direct service scope, empty query, cùng404 ngoài scope/không tồn tại,503 DB và private/no-store; xác nhận fail trước khi triển khai detail.
- [x] T018 [P] [US2] Thêm regression real PostgreSQL/HTTP detail trong `tests/supplier-onboarding.integration.test.ts`: đại diện giống list khi relink/tie, trường INACTIVE, SUSPENDED/UNLINKED, trường chung nhưng chỉ hiện quan hệ của supplier hiện tại, direct schoolId khác supplier404; không gọi list như prerequisite của detail.

### Implementation for User Story 2

- [x] T019 [US2] Mở rộng query đại diện trong `src/modules/supplier-school/supplier-school.repository.ts` cho detail, lọc schoolId và trusted supplierId trước chọn đại diện; tái sử dụng cùng quy tắc US1 và select hồ sơ/mốc/lý do đúng allowlist, không thêm filter trường ACTIVE hoặc join tài khoản/nhật ký nội bộ.
- [x] T020 [US2] Triển khai service detail trong `src/modules/supplier-school/supplier-school.service.ts` dùng scope và withReadTransaction, mapping SchoolDetail/null/timestamp tường minh; trả HttpError404 chung nếu không có parent, giữ404 qua read transaction và không bao parent check trong helper catch-all readListPage.
- [x] T021 [US2] Thêm controller detail và GET /:schoolId vào `src/modules/supplier-school/supplier-school.controller.ts`, `src/modules/supplier-school/supplier-school.routes.ts`; validate params/empty query, private/no-store, sendSuccess theo message contract, không nhúng danh sách hợp đồng.
- [x] T022 [US2] Chạy checks detail cùng regression danh sách trong `tests/supplier-school.test.ts` và `tests/supplier-onboarding.integration.test.ts`; ghi kết quả vào `specs/supplier-linked-schools/quickstart.md`, xác minh SC-002/SC-003 và trường chưa có hợp đồng vẫn xem độc lập.

**Checkpoint**: US1 và US2 đều có thể được gọi độc lập; lịch sử liên kết không làm phát sinh thao tác khôi phục liên kết hay quyền đặt hàng.

## Phase 5: User Story 3 — Xem hợp đồng và tệp trường đã tải lên (Priority: P1)

**Goal**: Ba GET nested cho danh sách/chi tiết hợp đồng và nội dung tệp, giới hạn đúng schoolId+supplierId+contractId+documentId.

**Independent Test**: Với schoolId/contractId đã biết, gọi trực tiếp list/detail/tệp bằng phiên supplier admin; đối chiếu ACTIVE/CLOSED/DRAFT, lịch sử và bytes gốc mà không cần gọi endpoint danh sách hoặc detail trường trước đó.

### Tests for User Story 3

- [x] T023 [P] [US3] Viết unit/HTTP tests ba endpoint trong `tests/supplier-school.test.ts`: parent404 khác contracts rỗng200, paging/sort/null/date-only, metadata không content/sha256, nested scope; binary inline/attachment cùng bytes, filename Unicode/control chars được encode, MIME/length/nosniff/CSP/no-store, thiếu bản ghi404, bytes rỗng/MIME sai/lỗi đọc503 trước success headers; xác nhận fail trước khi triển khai.
- [x] T024 [P] [US3] Thêm regression PostgreSQL/HTTP trong `tests/supplier-onboarding.integration.test.ts`: hai supplier dùng chung trường nhưng hợp đồng riêng, ACTIVE hiện tại/tương lai/hết hạn và CLOSED nhiều đợt, legacy relationshipId null, DRAFT/COMPLIANCE404, nhiều SIGNED_CONTRACT/APPENDIX PDF/PNG/JPEG, nguyên liệu INACTIVE vẫn hiện; so bytes mở/tải với upload, kiểm tra tie/sort/đủ các trang và tráo schoolId/contractId/documentId cả giữa supplier lẫn giữa trường cùng supplier.

### Implementation for User Story 3

- [x] T025 [US3] Triển khai repository parent existence và list/detail hợp đồng trong `src/modules/supplier-school/supplier-school.repository.ts`: bắt buộc trường có quan hệ bất kỳ với trusted supplierId, lọc schoolId+supplierId+ACTIVE/CLOSED, createdAt DESC/id ASC, skip/take limit+1; không lọc thời hạn/trường/quan hệ ACTIVE hoặc buộc relationshipId hiện tại; select nguyên liệu id/name sắp id ASC và đầy đủ metadata SIGNED_CONTRACT/APPENDIX sắp createdAt ASC/id ASC, không chọn content/sha256/snapshot/uploader/certification.
- [x] T026 [US3] Triển khai services list/detail hợp đồng trong `src/modules/supplier-school/supplier-school.service.ts` dùng trusted scope, parent check và dữ liệu cùng tx RepeatableRead; phân trang độc lập, giữ404 và map ContractDTO từng trường gồm YYYY-MM-DD/timestamp/null/ingredients/documents; không trả createdAt nội bộ hoặc tính eligibility/đặt hàng.
- [x] T027 [US3] Thêm controllers và hai GET /:schoolId/contracts, /:schoolId/contracts/:contractId trong `src/modules/supplier-school/supplier-school.controller.ts`, `src/modules/supplier-school/supplier-school.routes.ts`; strict params/query, sendSuccess, private/no-store, message và envelope theo contract.
- [x] T028 [US3] Triển khai document-content query trong `src/modules/supplier-school/supplier-school.repository.ts`: đủ schoolId+trusted supplierId+contractId+documentId, contract ACTIVE/CLOSED, kind SIGNED_CONTRACT/APPENDIX và parent cặp có quan hệ; chỉ endpoint này select content; không xét membership hiện tại của uploader và không dựa vào request trước.
- [x] T029 [US3] Triển khai service nội dung tệp trong `src/modules/supplier-school/supplier-school.service.ts`: kiểm tra scope/parent/tệp cùng read tx,404 chung cho thiếu/ngoài scope/nháp/COMPLIANCE; kiểm tra bytes không rỗng và MIME PDF/PNG/JPEG hợp lệ, map binary DTO allowlist,503 tiếng Việt đã sanitize khi nội dung không đọc được; không ảnh hưởng đọc metadata độc lập.
- [x] T030 [US3] Triển khai GET /:schoolId/contracts/:contractId/documents/:documentId và controller binary trong `src/modules/supplier-school/supplier-school.routes.ts`, `src/modules/supplier-school/supplier-school.controller.ts`: validate disposition default inline, chờ service thành công trước headers, Content-Type/Content-Length theo bytes, Content-Disposition an toàn UTF-8 RFC5987, nosniff/CSP sandbox/private-no-store; trả bytes nguyên gốc, lỗi vẫn JSON qua handler.
- [x] T031 [US3] Chạy tests hợp đồng/tệp và regression US1/US2 trong `tests/supplier-school.test.ts`, `tests/supplier-onboarding.integration.test.ts`; ghi chứng cứ SC-002–SC-005 vào `specs/supplier-linked-schools/quickstart.md`, xác nhận mỗi direct request tự authorize và không cần parent endpoint đã được gọi.

**Checkpoint**: Đủ năm GET theo contract, tất cả endpoint chỉ đọc dữ liệu; metadata và nội dung tệp có đường đọc độc lập.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Hoàn tất kiểm chứng quyền động, tương thích và tài liệu; không thêm phạm vi nghiệp vụ.

- [x] T032 Bổ sung real-login regression trong `tests/authorization.integration.test.ts` cho default view grant của admin mới, admin chỉ manage vẫn đọc được, staff/SYSTEM có permission vẫn403, inactive permission/current-org denial đúng OR; cùng phiên sau khóa account/đổi role/đổi supplier/mất cả hai quyền phải dùng trạng thái hiện tại cho cả JSON và binary, không auth cache.
- [x] T033 Bổ sung kiểm chứng không ghi dữ liệu và tương thích API trường trong `tests/supplier-onboarding.integration.test.ts`: so trạng thái/nội dung/timestamps các SchoolSupplierRelationship/SupplierContract/SupplierContractDocument trước/sau các GET mới; xác minh API hợp đồng/tệp và thao tác quản lý phía SCHOOL vẫn giữ scope/vòng đời hiện có.
- [x] T034 [P] Cập nhật ownership và mapping năm endpoint mới trong `src/modules/README.md`, chỉ rõ module supplier-school và ranh giới với school-supplier/supplier-onboarding.
- [x] T035 [P] Cập nhật `docs/AUTHORIZATION.md` với resource supplier-school, admin-only + OR view/manage, trusted scope/historical visibility, nested contract/document checks và binary headers; ghi rõ fresh default grant khác quyền role hiện hữu, không SYSTEM bypass.
- [x] T036 Rà soát và hoàn thiện hướng dẫn rollout/nghiệm thu trong `specs/supplier-linked-schools/quickstart.md`: role cũ cần operator cấp quyền theo quy trình hiện có, PUT replace-all giữ grants, điều kiện inactive permission, không tự bootstrap/seed/remote writes; ghi SC-006 chưa đo cùng cách nghiệm thu 90% trong 1 phút khi có giao diện, không coi frontend là task backend.
- [x] T037 Review tổng thể `src/modules/supplier-school/supplier-school.service.ts`, `src/modules/supplier-school/supplier-school.repository.ts`, `src/modules/supplier-school/supplier-school.controller.ts` và DTO files theo AGENTS.md: query chỉ ở repository, scope mọi WHERE, cùng tx cho parent/data, mapping allowlist/no record spread, không bytes trong metadata, không lock/cache/write; sửa sai lệch trong phạm vi spec và đối chiếu `specs/supplier-linked-schools/contracts/supplier-schools-api.md`.
- [x] T038 Chạy `npm run validate` và `npm run test:unit` theo `package.json`; giải quyết lỗi do tính năng, xác nhận `tests/supplier-school.test.ts` thực sự được thực thi và không skip; ghi lệnh/kết quả thực vào `specs/supplier-linked-schools/quickstart.md`.
- [x] T039 Khi instance local và phạm vi ghi test disposable đã được chọn/cho phép, chạy `npm run test:local:authorization` theo `tests/helpers/run-local-tests.ts` và `specs/supplier-linked-schools/quickstart.md`; cả authorization và supplier-onboarding child phải chạy, chứng minh SQL DISTINCT ON bằng PostgreSQL thật, cleanup đúng manifest; ghi kết quả hoặc blocker cụ thể, không đổi runner/CI hoặc chạm database thành viên/Azure.
- [x] T040 Kiểm tra format/link/diff của `specs/supplier-linked-schools/spec.md`, `specs/supplier-linked-schools/plan.md`, `specs/supplier-linked-schools/tasks.md` và artifacts liên quan; chạy spec gate theo `contribute.md` mục 8.5 trên diff thực chứa thay đổi tính năng, ghi kết quả vào `specs/supplier-linked-schools/quickstart.md`; chỉ tick tasks có bằng chứng hoàn thành, không báo gate PASS từ HEAD chưa chứa thay đổi hoặc tự commit/push để bỏ qua điều kiện.

**Checkpoint**: Backend hoàn thành khi code/checks tương ứng đạt, blocker được ghi đúng và SC-006 được phân biệt với nghiệm thu backend; không tự đánh dấu tiêu chí giao diện đã đạt.

## Dependencies & Execution Order

### Phase Dependencies

```text
Phase 1: T001 → T002 → T003
  ↓
Phase 2 wave A: T004 ∥ T005 ∥ T006 ∥ T007
Phase 2 wave B: T008, T009, T010 sau prerequisites tương ứng
  ↓
US1: (T011 ∥ T012) → T013 → T014 → T015 → T016
  ↓
US2: (T017 ∥ T018) → T019 → T020 → T021 → T022
  ↓
US3: (T023 ∥ T024) → T025 → T026 → T027 → T028 → T029 → T030 → T031
  ↓
Polish: T032 → T033 → (T034 ∥ T035) → T036 → T037 → T038 → T039 → T040
```

- Foundation là gate chung trước mọi story; mỗi wave chỉ bắt đầu khi các task mà nó dùng đã hoàn tất.
- T008 dùng T004/T005; T009 dùng T006/T007; T010 dùng T002/T004. Không chạy T008 cùng T005 khi test đang phụ thuộc catalog chưa ổn định.
- US2 dùng helper chọn đại diện của US1; US3 dùng parent-read của US2. Đây là phụ thuộc thành phần khi triển khai, không phải yêu cầu client gọi các endpoint theo thứ tự.
- US1/US2/US3 đều P1; thực hiện lần lượt vì cùng sửa repository/service/controller/routes/DTO và hai file tests.
- T032 nối sau mọi endpoint, T033 nối sau các regression nghiệp vụ; không sửa cùng file tests ở hai nhánh đồng thời.
- Nếu một check thất bại, sửa và chạy lại check liên quan trước checkpoint; không lặp toàn bộ suite đã pass khi không có thay đổi mới.

### Parallel Opportunities và quyền sở hữu file

| Wave          | Tasks có nhãn [P]      | File độc lập                                                              |
| ------------- | ---------------------- | ------------------------------------------------------------------------- |
| Foundation A  | T004, T005, T006, T007 | resource-access; permission-catalog; validation+request DTO; response DTO |
| US1 tests     | T011, T012             | supplier-school.test; supplier-onboarding.integration                     |
| US2 tests     | T017, T018             | supplier-school.test; supplier-onboarding.integration                     |
| US3 tests     | T023, T024             | supplier-school.test; supplier-onboarding.integration                     |
| Documentation | T034, T035             | modules README; AUTHORIZATION                                             |

Có 12 task [P], không có nghĩa tất cả chạy cùng lúc. Nếu dùng nhiều agent trong implement, giữ tối đa 3 subagents theo yêu cầu phiên trước; một owner/file, agent chính tích hợp/review/kiểm chứng. T006 sở hữu đồng thời validation và request DTO vì chúng phụ thuộc trực tiếp; không tách hai người sửa chéo schema đang thay đổi.

## Parallel Example: User Story 1

Sau Phase 2 hoàn tất:

```text
Owner A — T011: tests/supplier-school.test.ts, unit/HTTP list contract.
Owner B — T012: tests/supplier-onboarding.integration.test.ts, PostgreSQL fixtures/list assertions.
Tích hợp hai nhánh test → thực hiện T013–T016 tuần tự.
```

## Parallel Example: User Story 2

Sau checkpoint US1 và file ownership đã được bàn giao:

```text
Owner A — T017: tests/supplier-school.test.ts, direct-detail contract.
Owner B — T018: tests/supplier-onboarding.integration.test.ts, real-scope/history detail.
Tích hợp hai nhánh test → thực hiện T019–T022 tuần tự.
```

## Parallel Example: User Story 3

Sau checkpoint US2:

```text
Owner A — T023: tests/supplier-school.test.ts, JSON/binary contract and failure cases.
Owner B — T024: tests/supplier-onboarding.integration.test.ts, pair/legacy/bytes fixtures.
Tích hợp hai nhánh test → thực hiện T025–T031 tuần tự.
```

Các ví dụ là phương án phân công, không tự khởi chạy agent hoặc cấp quyền ghi database. Nhánh viết test chỉ được sửa file thuộc ownership đã giao.

## Requirement Coverage

| Requirement | Implementation tasks                              | Verification tasks                                                |
| ----------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| FR-001      | T004–T005, T010                                   | T008, T011, T017, T023, T032                                      |
| FR-002      | T004, T013–T015, T019–T021, T025–T030             | T011–T012, T017–T018, T023–T024, T032                             |
| FR-003      | T013–T015                                         | T011–T012, T016                                                   |
| FR-004      | T013, T019                                        | T012, T016, T018, T022                                            |
| FR-005      | T006, T013–T015                                   | T009, T011–T012, T016                                             |
| FR-006      | T007, T013–T015                                   | T011–T012, T016                                                   |
| FR-007      | T007, T019–T021                                   | T017–T018, T022                                                   |
| FR-008      | T025–T027                                         | T023–T024, T031                                                   |
| FR-009      | T006, T025–T027                                   | T009, T023–T024, T031                                             |
| FR-010      | T007, T025–T027                                   | T023–T024, T031                                                   |
| FR-011      | T007, T025–T030                                   | T023–T024, T031                                                   |
| FR-012      | T025–T030                                         | T023–T024, T031–T032                                              |
| FR-013      | T006, T014–T015, T020–T021, T026–T030             | T009, T011, T017, T023, T032                                      |
| FR-014      | T007, T013–T015, T019–T021, T025–T030             | T011, T017, T023, T037                                            |
| FR-015      | T010, T013–T015, T019–T021, T025–T030             | T033, T037                                                        |
| FR-016      | T014–T015, T020–T021, T026–T030                   | T011, T017, T023–T024, T031                                       |
| SC-001      | T013–T015                                         | T012, T016, T039                                                  |
| SC-002      | T019–T021, T025–T030                              | T018, T022, T024, T031, T039                                      |
| SC-003      | T004, T025–T030                                   | T008, T018, T024, T032, T039                                      |
| SC-004      | T028–T030                                         | T023–T024, T031, T039                                             |
| SC-005      | T013–T014, T025–T026                              | T012, T016, T024, T031, T039                                      |
| SC-006      | Không triển khai frontend trong tính năng backend | T036 ghi quy trình và trạng thái chưa đo; nghiệm thu sản phẩm sau |

## Implementation Strategy

### MVP First — US1

Hoàn thành T001–T016 để có danh sách trường hữu ích độc lập và kiểm chứng được scope/đại diện/phân trang. Checkpoint MVP dùng để demo hoặc review; đây không phải hoàn thành toàn bộ yêu cầu xem chi tiết và hợp đồng.

### Incremental Delivery

Sau MVP, thêm US2 rồi US3, giữ regression story trước luôn chạy. Hoàn tất Phase 6 trước khi báo backend hoàn thành; không triển khai/deploy, commit/push hoặc sửa quyền môi trường đang dùng chỉ vì task list có hướng dẫn rollout.

### Verification và nghiệm thu

Tests trong từng story viết trước triển khai; mock không thay thế PostgreSQL cho truy vấn đại diện. Unit chạy không cần hạ tầng; test thật chỉ dùng môi trường disposable được cho phép. Báo actual pass/fail/blocked theo quickstart; SC-006 giữ riêng cho luồng người dùng hoàn chỉnh.

## Notes

- Tổng 40 task: Setup 3, Foundation 7, US1=6, US2=6, US3=9, Polish 9; tất cả ban đầu chưa hoàn thành.
- Không đổi schema/index/migration/client sinh tự động; không tạo dữ liệu mẫu hoặc sửa grants của role hiện hữu tự động.
- Kết quả tạo tasks không phải kết quả triển khai hoặc thực thi các lệnh test.
- Hook before_tasks/after_tasks không được cấu hình tại thời điểm tạo tài liệu.
