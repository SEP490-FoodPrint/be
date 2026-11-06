---
description: "Đầu việc triển khai mã registrationID cho hồ sơ đăng ký FoodPrint"
---

# Tasks: Mã hồ sơ đăng ký dễ đọc

**Input**: Bộ thiết kế tại `specs/001-add-registration-id/`.

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contract](contracts/registration-id.md), [quickstart.md](quickstart.md) và [hiến chương](../../.specify/memory/constitution.md).

**Tests**: Có kiểm thử vì spec yêu cầu nghiệm thu định dạng, vòng đời, dữ liệu cũ, phân quyền và 100 lượt nộp đồng thời tại SC-001–SC-005. Dùng Node test runner và harness hiện có; không thêm framework.

**Organization**: Nhóm theo user story. Task dùng chung nằm ở Setup/Foundational. Migration đầy đủ, gồm backfill, phải có ngay ở phần nền tảng để không tạo bản schema trung gian gây lỗi với dữ liệu cũ; US3 tập trung chứng minh hành vi nâng cấp đó.

## Format: `[ID] [P?] [Story] Description`

- Mọi dòng công việc có checkbox, ID tuần tự và đường dẫn file cụ thể.
- `[P]`: có thể làm song song với task khác trong cùng đợt khi tiền điều kiện đã hoàn tất, trên các file khác nhau.
- `[US1]`, `[US2]`, `[US3]`, `[US4]`: liên kết với các user story trong spec; US4 là yêu cầu tìm kiếm bổ sung.
- Checkbox chỉ được đánh dấu khi công việc và kiểm chứng tương ứng thực sự hoàn thành.

## Path Conventions

Đường dẫn tính từ repository root: `src/`, `prisma/`, `tests/`, `.github/`, `database/` và `specs/001-add-registration-id/`. File mới được nêu rõ; không hand-edit/commit Prisma Client hoặc dist.

## Phase 1: Setup — Chuẩn bị môi trường và giới hạn kiểm thử

**Purpose**: Chuẩn bị công cụ và xác định điều kiện chạy test mà không thay dữ liệu hiện hữu.

- [x] T001 Kiểm tra Node/npm theo `.nvmrc` và `package.json`; chỉ chạy `npm ci` khi cần khôi phục dependencies từ `package-lock.json`, không cập nhật dependency/lockfile ngoài phạm vi tính năng.
- [x] T002 Đối chiếu điều kiện disposable PostgreSQL và storage stub trong `tests/migrations.test.ts`, `tests/authorization.integration.test.ts`, `src/utils/migration-target.ts` với `specs/001-add-registration-id/quickstart.md`; ghi nhận prerequisite có/thiếu, không đọc/in credential và không chạy ghi DB nếu chưa có môi trường được phép.

## Phase 2: Foundational — Thành phần dùng chung

**Purpose**: Hoàn thiện persistence, định dạng, hợp đồng và repository trước khi tích hợp các user story.

- [x] T003 [P] Thêm `tests/registration-id.test.ts` kiểm tra mã cho bigint 1, 9, 10, 99999, 100000, giá trị vượt Number.MAX_SAFE_INTEGER, độ dài 12 ở dải 1–99999 và việc từ chối số không dương; kiểm thử formatter dưới dạng hành vi đầu ra.
- [x] T004 Thêm formatter scalar trong `src/utils/registration-id.ts` theo T003: nhận bigint dương, nối FP-REG- với phần số đủ tối thiểu 5 chữ số, không ép Number, không cắt số và không chứa mapping DTO.
- [x] T005 [P] Thêm registrationNumber BigInt mapped registration_number, default autoincrement và unique vào `prisma/schema.prisma`; viết migration mới `prisma/migrations/20261106000100_registration_number/migration.sql` với BEGIN/COMMIT, khóa bảng, cột nullable chưa default, backfill row_number theo submitted_at/id, sequence bigint CACHE 1 NO CYCLE có ownership, default, NOT NULL, CHECK dương và khởi tạo khác nhau cho bảng rỗng/không rỗng; chỉ cập nhật cột mới, giữ UUID/FK/timestamps và migration cũ.
- [x] T006 Sau T005, chạy prisma:validate và prisma:generate theo `package.json`, đối chiếu kiểu/schema trong `prisma/schema.prisma`; không kết nối DB hoặc deploy migration, không chỉnh tay/commit client sinh tự động.
- [x] T007 [P] Thêm typed validation error và helper tổng hợp issue tiếng Việt/field path trong `src/utils/request-validation.ts`; thêm nhánh xử lý đúng kiểu lỗi này qua sendError ở `src/middlewares/error.middleware.ts`, giữ envelope và hành vi lỗi cũ, không trả raw input.
- [x] T008 Sau T007, chuyển parsing onboarding/submission/review params và bodies sang Zod strictObject + safeParse trong `src/modules/auth/onboarding.validation.ts` và `src/modules/auth/onboarding-submission.ts`; tạo các Request DTO tương ứng bằng z.infer/type-only schema imports ở `src/modules/auth/auth.request.dto.ts`; giữ JSON phẳng, multipart profile, normalization/null/default/limits/ngày/retainedDocuments và không nhận discriminator từ client.
- [x] T009 Sau T008, chuyển login/profile input sang Zod schemas trong `src/modules/auth/session.validation.ts` và `src/modules/auth/profile.validation.ts`, thêm z.infer Request DTO vào `src/modules/auth/auth.request.dto.ts`; giữ password nguyên văn với giới hạn byte, identifier trim và toàn bộ semantics PATCH me hiện tại.
- [x] T010 [P] Tạo `src/modules/auth/auth.response.dto.ts` định nghĩa allowlist cho own/submission/review decision, metadata tài liệu và SessionUser public; registrationID là string, ngày là ISO/null, giữ fields/envelopes hiện có và không chứa bigint/số nội bộ; không gộp Request/Response DTO.
- [x] T011 [P] Sau T006, tạo `src/modules/auth/onboarding.repository.ts` với operation-specific methods cho đọc/khóa applicant, hồ sơ, create/update, organization/certification, cập nhật user, outbox và ownership tài liệu; chuyển select/persistence types/truy vấn về repository, nhận shared client hoặc cùng tx và trusted scope, không import DTO hoặc tự mở transaction.
- [x] T012 [P] Sau T006, tạo `src/modules/auth/session.repository.ts` và `src/modules/auth/profile.repository.ts` cho các truy vấn login/password recheck/row lock và profile update đang nằm trong service; nhận shared client/tx, dùng input nội bộ, không import DTO, không thay chính sách session/quyền.

**Checkpoint**: Có formatter, schema/migration đầy đủ, validation/DTO và repository dùng chung. Chưa coi ứng dụng đã tích hợp xong khi các service/controller còn chưa chuyển sang hợp đồng mới. Mọi kiểm chứng PostgreSQL vẫn dùng môi trường disposable được phép.

## Phase 3: User Story 1 — Nhận diện đơn bằng mã dễ đọc (Priority: P1)

**Goal**: Cung cấp mã duy nhất, đúng định dạng và nhất quán ở danh sách, chi tiết và các response có hồ sơ.

**Independent Test**: Trên database disposable sạch, nộp hồ sơ SCHOOL/SUPPLIER, kiểm tra mã bắt đầu FP-REG-00001 và tăng phần số, danh sách/chi tiết/own/session summary trùng mã, giữ UUID và quyền. Kiểm tra 100 người nộp độc lập đồng thời không tạo hồ sơ thành công thiếu/trùng mã.

### Tests for User Story 1

Viết kiểm thử trước phần tích hợp. Với hành vi mới chưa xây, xác nhận thất bại ở assertion hành vi; không tạo lỗi giả hoặc coi lỗi import/setup là bằng chứng chức năng.

- [x] T013 [P] [US1] Bổ sung fixture registrationNumber và assertion contract/safe projection ở `tests/modules.test.ts`: list có registrationID, không lộ số nội bộ/field nhạy cảm, JSON hợp lệ, giữ pagination/orderBy UUID và 403 thiếu quyền.
- [x] T014 [P] [US1] Bổ sung fixture summary khác null trong `tests/auth-session.test.ts`; kiểm tra login/refresh/GET me/PATCH me trả cùng registrationID, ngày ISO và không có bigint; giữ summary null, ACTIVE/UNVERIFIED và semantics cookie/session.
- [x] T015 [P] [US1] Thêm regression trong `tests/registration-review.test.ts` chứng minh thêm số bigint không gây lỗi JSON hoặc đổi hash của hồ sơ không đổi nội dung, nhưng thay liên hệ/profile/tài liệu vẫn đổi reviewVersion; giữ email hiện có.
- [x] T016 [P] [US1] Tạo `tests/registration-id.integration.test.ts` dùng assertLocalMigrationTarget, database con ngẫu nhiên và storage stub; kiểm tra cấp số chung cho hai loại, 100 người nộp độc lập đồng thời, rollback sau insert không tái dùng số, mốc 99999→100000 và không báo thành công thiếu mã; không dùng Azure/database thành viên hoặc thay rate-limit runtime.

### Implementation for User Story 1

- [x] T017 [US1] Thêm registrationNumber vào `src/modules/registration/registration.select.ts`, registrationID vào `src/modules/registration/registration.response.dto.ts` và explicit mapping qua formatter ở `src/modules/registration/registration.service.ts`; giữ quyền, scope, projection, envelope, pagination và thứ tự trong `src/modules/registration/registration.repository.ts`.
- [x] T018 [US1] Chuyển `src/modules/auth/onboarding.service.ts` dùng repository và auth DTO của Phase 2; map allowlist cho own/submit/detail/approve/reject, ngày và tài liệu, xuất registrationID; cập nhật `src/modules/auth/onboarding.controller.ts` validate rồi truyền input chuẩn hóa, không import DTO; giữ transaction/authorization/upload/cleanup và không để query hoặc Prisma where/select/include trong service.
- [x] T019 [US1] Sửa `src/modules/auth/registration-review.ts` để hash projection tường minh của đúng các trường cũ, loại registrationNumber khỏi canonical JSON; thống nhất persistence projection/types với `src/modules/auth/onboarding.repository.ts` và sửa import ở `src/modules/auth/onboarding.service.ts`, giữ reviewVersion trước/sau backfill khi nội dung không đổi.
- [x] T020 [US1] Thêm số vào summary nội bộ ở `src/utils/session-identity.ts` và `src/types/session-user.ts`; trong `src/modules/auth/session.service.ts` dùng session repository, nhận Request DTO login và tạo mapper public SessionUser trong service; cập nhật `src/modules/auth/session.controller.ts` gọi mapper qua service cho login/refresh/me, giữ currentUser nội bộ cho middleware và không trả bigint/JWT secrets.
- [x] T021 [US1] Chuyển `src/modules/auth/profile.service.ts` dùng profile repository và Request DTO, tái sử dụng mapper public từ session service để PATCH me trả summary registrationID; đối chiếu `src/modules/auth/profile.controller.ts` giữ validation, response và transaction recheck hiện tại.
- [x] T022 [US1] Chạy các test T003/T013–T016 theo lệnh targeted trong `specs/001-add-registration-id/quickstart.md` bằng tsx, kiểm tra response trên HTTP và concurrency trên PostgreSQL disposable được phép; ghi kết quả thật hoặc prerequisite bị chặn, không dùng mock để kết luận uniqueness.

**Checkpoint**: MVP backend có thể minh họa trên database test: mã ngắn xuất hiện đúng ở mọi response chứa hồ sơ, UUID và quyền giữ nguyên. Đây chưa phải gate triển khai thật; còn phải nghiệm thu lifecycle và upgrade dữ liệu cũ.

## Phase 4: User Story 2 — Giữ mã trong vòng đời hồ sơ (Priority: P2)

**Goal**: Mã được cấp một lần cho một hồ sơ, không đổi qua chỉnh sửa/từ chối/gửi lại/phê duyệt; người dùng không tự gán mã.

**Independent Test**: Nộp → chỉnh sửa PENDING → từ chối → gửi lại → phê duyệt; đối chiếu cùng UUID/mã trên mọi response và không phát sinh số mới ở nhánh update. Thử tự gán mã tại JSON/multipart/nested fields và nhận 400 trước cloud upload/ghi.

### Tests for User Story 2

- [x] T023 [P] [US2] Mở rộng `tests/onboarding.test.ts` cho edit/reject/resubmit/approve giữ mã và không insert/cấp số khi update; kiểm tra JSON root, multipart wrapper/profile, certifications[] và retainedDocuments[] có registrationID/registrationNumber bị từ chối trước upload/write, nhiều issue có field path và không lộ raw values; giữ normalization và cleanup khi thất bại.
- [x] T024 [P] [US2] Mở rộng `tests/authorization.integration.test.ts` kiểm chứng mã xuyên vòng đời, view/approve/reject độc lập, own/foreign scope, recheck actor/target và concurrent review; giữ một quyết định/outbox nguyên tử, UUID document links và email_outbox.registration_id.
- [x] T025 [P] [US2] Bổ sung regression trong `tests/auth-session.test.ts` cho cập nhật liên hệ giữ registrationID, không cấp số khi login/refresh/me/PATCH me và không tạo hồ sơ nếu summary null; đối chiếu stale reviewVersion sau thay đổi liên hệ bằng fixture hiện có.

### Implementation for User Story 2

- [x] T026 [US2] Hoàn thiện allowlist input tạo/cập nhật tại `src/modules/auth/onboarding.repository.ts`: create luôn bỏ qua registrationNumber để dùng default, update không ghi cột số/mã, không nhận DTO/raw Prisma args từ controller; áp trusted ownership scope vào WHERE và giữ tất cả phương thức ghi trong tx do service truyền vào.
- [x] T027 [US2] Hoàn thiện orchestration trong `src/modules/auth/onboarding.service.ts` theo test vòng đời: hai transaction trước/sau upload, snapshot expectedUpdatedAt, reload actor/target và thứ tự khóa applicant→hồ sơ, retry hiện có; các nhánh update/review giữ mã, tổ chức/user/outbox cùng tx và response chỉ trả sau commit; giữ bù upload mới và cleanup sau commit.
- [x] T028 [US2] Hoàn thiện tích hợp strict validation và error.fields trong `src/modules/auth/onboarding.validation.ts`, `src/modules/auth/onboarding.controller.ts`, `src/utils/request-validation.ts` và `src/middlewares/error.middleware.ts` để các trường tự gán mã ở mọi độ sâu đều 400 với đường dẫn rõ ràng; giữ UUID params và 401/403/404/409/error.code hiện có, không thêm endpoint.
- [x] T029 [US2] Chạy targeted lifecycle/validation/session tests và authorization integration theo `specs/001-add-registration-id/quickstart.md`; đối chiếu T023–T028 với FR-004/FR-006/FR-011 và ghi kết quả, không đánh dấu hoàn tất các kiểm chứng DB chưa chạy.

**Checkpoint**: Cùng hồ sơ giữ nguyên mã qua mọi chuyển trạng thái hợp lệ; tự gán mã bị chặn, scope và atomicity không bị thay đổi.

## Phase 5: User Story 3 — Đánh số hồ sơ đã tồn tại (Priority: P2)

**Goal**: Hồ sơ cũ có mã đầy đủ theo thứ tự được xác định và hồ sơ mới nối tiếp, không đổi dữ liệu cũ.

**Independent Test**: Dựng database riêng đến trước migration mới, thêm đủ hai loại/ba trạng thái và submitted_at trùng, snapshot toàn bộ cột cũ rồi upgrade. Kiểm tra mã từ 1 theo submitted_at/id, mọi cột cũ giữ nguyên, mã tiếp theo lớn hơn max; kiểm tra riêng database rỗng.

### Tests for User Story 3

- [x] T030 [US3] Thêm fixture/test upgrade trong `tests/migrations.test.ts`: database disposable riêng chỉ replay lịch sử trước migration mới, hồ sơ SCHOOL/SUPPLIER đủ ba trạng thái và timestamp trùng; snapshot mọi cột cũ ở dạng giữ chính xác timestamps/JSON, rồi assert thứ tự số và dữ liệu không đổi sau khi áp migration mới một lần.
- [x] T031 [US3] Thêm kiểm tra catalog/constraints và full replay rỗng trong `tests/migrations.test.ts`: NOT NULL/unique/CHECK dương, sequence ownership/default/CACHE 1/NO CYCLE, số đầu 1 và số sau backfill max+1; giữ test FK/partial indexes, migration history/checksum và Prisma drift hiện có.
- [x] T032 [P] [US3] Bổ sung vào `tests/registration-id.integration.test.ts` trường hợp writer bỏ qua cột mới như backend cũ, insert sau upgrade vẫn được default cấp số, đọc danh sách/chi tiết thấy mã của hồ sơ cũ và không đánh số lại khi đọc hoặc đổi trạng thái; dùng database riêng cho từng kịch bản cần trạng thái sequence xác định.

### Implementation and Validation for User Story 3

- [x] T033 [US3] Đối chiếu `prisma/migrations/20261106000100_registration_number/migration.sql` và `prisma/schema.prisma` với T030–T032: khóa xuyên suốt backfill/khởi tạo sequence, không default sớm, chỉ update cột mới, xử lý empty/nonempty đúng và không tạo trigger/function; nếu test chỉ ra lỗi thì sửa migration mới chưa phát hành, không sửa lịch sử đã triển khai.
- [x] T034 [US3] Ghi thay đổi cấu trúc và cách rollout/rollback ở `database/SCHEMA_BASELINE.md`: migration mới, thứ tự triển khai, khoảng khóa, quyền sequence nếu runtime khác owner, giữ dữ liệu/mã khi rollback app; ghi trạng thái chưa triển khai cho đến khi có bằng chứng, không tự deploy hoặc bootstrap.
- [x] T035 [US3] Chạy test:migrations và suite registration-id trên database disposable được phép, kiểm tra Prisma drift và snapshot dữ liệu cũ; ghi số lượng hồ sơ, thứ tự mã, empty/nonempty và bằng chứng pass/fail/prerequisite trong `specs/001-add-registration-id/quickstart.md`, không thử trên database thành viên/Azure.

**Checkpoint**: Nghiệm thu được upgrade với dữ liệu cũ và database rỗng; mọi hồ sơ cũ có mã duy nhất, dữ liệu cũ giữ nguyên và dãy số tiếp tục đúng.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Tích hợp quality gate, đối chiếu yêu cầu và bàn giao.

- [x] T036 Đăng ký `tests/registration-id.test.ts` vào test:unit và thêm script test:registration-id trong `package.json`; thêm bước chạy integration tương ứng vào job PostgreSQL disposable trong `.github/workflows/ci.yml`, giữ quality jobs tách Azure credentials và không đổi policy rate-limit/cache.
- [x] T037 [P] Đồng bộ hướng dẫn chạy và hợp đồng thực tế tại `specs/001-add-registration-id/quickstart.md`, `specs/001-add-registration-id/contracts/registration-id.md`, `specs/001-add-registration-id/plan.md` và `src/modules/README.md`; ghi rõ frontend chỉ đổi phần hiển thị sau backend, vẫn dùng UUID cho thao tác, không bổ sung tìm kiếm/filter/sort/email ngoài spec.
- [x] T038 Sau T036, chạy prisma:validate, prisma:generate, npm run validate và npm run test:unit theo `package.json`; sửa lỗi thuộc thay đổi này, kiểm tra controller/validator/repository không import DTO và service không còn query/spread persistence trong phạm vi bị tác động; ghi kết quả trong `specs/001-add-registration-id/quickstart.md`.
- [x] T039 Sau T038, chạy test:migrations, test:registration-id, test:authorization và test:supplier-onboarding theo `package.json` trên disposable local được phép; kiểm tra hàm spec gate trong `.github/scripts/spec-gate.mjs` trên branch/file/spec của working tree, và chạy CLI base/head theo `docs/SPEC_KIT_GUIDE.md` khi có commit SHA, không tự push/merge/deploy; ghi đúng các kiểm chứng bị chặn.
- [x] T040 Đối chiếu FR-001–FR-012 và SC-001–SC-005 trong `specs/001-add-registration-id/spec.md` với kết quả kiểm thử ở `specs/001-add-registration-id/quickstart.md`, hoàn thiện trạng thái từng task trong `specs/001-add-registration-id/tasks.md` và ghi bàn giao rollout; không đánh dấu nghiệm thu thành công nếu còn kiểm chứng bắt buộc chưa thực hiện.

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup T001–T002
      |
      v
Foundational T003–T012
      |
      v
US1 T013–T022 — MVP backend trên DB test
      |
      +----------------------+
      v                      v
US2 T023–T029          US3 T030–T035
      |                      |
      +-----------+----------+
                  v
         Polish T036–T040
```

US2 và US3 có thể triển khai độc lập sau US1 vì dùng chung schema/formatter/contract đã hoàn tất; test mỗi story riêng. Trình tự mặc định cho một người là US1 → US2 → US3. US2/US3 đều cập nhật quickstart nên không sửa đồng thời file đó; chỉ song song phần source/test khác file và dùng database test riêng.

### Foundational Dependencies

- T003 → T004.
- T005 → T006 → T011/T012.
- T007 → T008 → T009; T008/T009 cùng sửa auth.request.dto.ts nên làm tuần tự.
- T010 độc lập với các nhánh trên.
- US1 bắt đầu khi tất cả T003–T012 hoàn tất; không bật backend mới trên DB thiếu migration.

### Within Each User Story

- US1: T013–T016 viết test độc lập; T017–T021 tích hợp sau nền tảng. T018/T019 cùng chạm onboarding service/repository nên tuần tự; T020 trước T021 vì profile dùng mapper session. T022 sau toàn bộ tích hợp US1.
- US2: T023–T025 viết test khác file; T026 → T027 → T028; T029 nghiệm thu sau các bước này.
- US3: T030 → T031 vì cùng file migrations.test.ts; T032 không phụ thuộc fixture của hai task đó. T033 sau các test, T034 ghi quy trình, T035 kiểm chứng và ghi kết quả.
- Polish: T036 trước full quality T038; T037 cập nhật docs trong đợt riêng không trùng việc ghi quickstart; T039 sau quality và sau mọi thay đổi source/migration; T040 chỉ sau các kết quả thực tế.

### Parallel Opportunities

- Đợt đầu nền tảng: T003, T005, T007, T010 khác file và chỉ phụ thuộc Setup.
- Sau generate: T011 và T012 có thể làm song song; repository không phụ thuộc Request/Response DTO.
- Sau helper: T008 có thể làm song song nhánh repository, nhưng T009 phải chờ T008.
- Không có yêu cầu spawn agent tự động; nhãn [P] chỉ mô tả cách phân công an toàn khi thực hiện.

## Parallel Example: User Story 1

Sau Foundational, có thể viết cùng lúc:

```text
T013: tests/modules.test.ts — danh sách và safe projection
T014: tests/auth-session.test.ts — nested summary
T015: tests/registration-review.test.ts — hash và bigint
T016: tests/registration-id.integration.test.ts — cấp số PostgreSQL
```

Không sửa đồng thời file integration giữa US1 và US3; hoàn tất US1 trước khi thêm T032.

## Parallel Example: User Story 2

Sau US1, có thể viết cùng lúc:

```text
T023: tests/onboarding.test.ts — lifecycle và strict input
T024: tests/authorization.integration.test.ts — quyền và atomicity
T025: tests/auth-session.test.ts — summary sau đổi liên hệ
```

Sau đó tích hợp tuần tự T026–T028 trước khi chạy T029.

## Parallel Example: User Story 3

Sau US1, có thể tách hai nhánh:

```text
T030 rồi T031: tests/migrations.test.ts — upgrade/cột cũ/catalog
T032: tests/registration-id.integration.test.ts — legacy writer/continuity
```

Dùng database riêng; không sửa chung migration trong lúc chạy cùng một scenario, không dùng lại schema có dữ liệu thực.

## Requirement Coverage

| Yêu cầu                | Task chính                            |
| ---------------------- | ------------------------------------- |
| FR-001, FR-002, FR-003 | T003–T006, T016–T018                  |
| FR-004                 | T007–T009, T023, T028                 |
| FR-005, FR-012         | T005, T016, T022, T026–T027           |
| FR-006                 | T023–T027, T029                       |
| FR-007                 | T010, T013–T014, T017–T021, T025      |
| FR-008, FR-009         | T005, T030–T035                       |
| FR-010                 | T005, T013, T015, T019, T024, T031    |
| FR-011                 | T013, T018, T024, T026–T029           |
| SC-001, SC-002         | T003–T004, T013–T014, T022, T030–T035 |
| SC-003                 | T016, T022, T039                      |
| SC-004                 | T023–T027, T030–T035                  |
| SC-005                 | T013, T024, T029, T039                |
| FR-013–FR-015, SC-006  | T041–T045                             |

## Implementation Strategy

### MVP First

Hoàn tất Setup + Foundational + US1 để có bản demo backend tạo mã và trả mã đúng ở danh sách/chi tiết/session trên disposable DB. Đây là mốc chức năng đầu tiên; frontend chưa được sửa trong kho mã này. Không triển khai thật trước khi US2, US3 và quality gate hoàn tất.

### Incremental Delivery

1. Dựng thành phần dùng chung, gồm migration hoàn chỉnh an toàn với hồ sơ cũ.
2. Tích hợp mã public và nghiệm thu US1.
3. Nghiệm thu tính bất biến/validation/quyền ở US2 và dữ liệu cũ ở US3.
4. Chạy quality gate và hoàn thiện bằng chứng, bàn giao migration → backend → frontend theo quy trình triển khai đã được phép.

## Notes

- Tính năng gốc có 40 task: Setup 2, Foundational 10, US1 10, US2 7, US3 6, Polish 5. Yêu cầu tìm kiếm bổ sung có 5 task T041–T045 ở Phase 7.
- Các task được cập nhật theo kết quả triển khai; chỉ đánh dấu hoàn tất khi có bằng chứng tương ứng.
- Việc có migration/test task không tự cấp phép chạy ghi vào DB hiện hữu. Thiếu môi trường không ngăn viết code/test độc lập, nhưng phải ghi blocker và không đánh dấu kiểm chứng DB đã hoàn tất.
- Không tự thêm requirements, seed/mock data ngoài database test, endpoint, schema reset, custom function/trigger hoặc cơ chế cache mới.

## Completion Evidence — Tính năng gốc

- Hoàn tất 40/40 task; kết quả cụ thể tại [quickstart.md](quickstart.md#8-kết-quả-thực-thi-tính-năng).
- Validate PASS; 172 unit/HTTP tests và 54 integration/migration tests PASS; spec gate working-tree preflight và diff whitespace PASS.
- PostgreSQL/Redis kiểm thử tạm tách khỏi cấu hình hiện tại; migration cho database đang dùng cần review/CD theo quy trình.

## Phase 7: User Story 4 — Tìm mã trong danh sách, giữ chi tiết UUID

**Yêu cầu xác nhận**: Danh sách tìm theo mã `registrationID`; API chi tiết vẫn dùng UUID. Áp dụng FR-013–FR-015 và SC-006. Phần dưới bổ sung sau 40 task gốc; không thay đổi bằng chứng hoàn tất trước đây.

- [x] T041 [US4] Cập nhật `specs/001-add-registration-id/spec.md`, `plan.md` và `contracts/registration-id.md` trước code, ghi rõ query search chính xác, normalization, lỗi và phạm vi; tạo nhánh `fix/001-registration-code-search` từ dev.
- [x] T042 [US4] Bổ sung kiểm thử validation, repository/service và HTTP trong `tests/modules.test.ts` cho tìm mã, bigint lớn, pagination, no match, quyền và detail UUID.
- [x] T043 [US4] Thêm search vào Zod strict trong `src/modules/registration/registration.validation.ts`; Request DTO tại `registration.request.dto.ts` tiếp tục suy ra từ schema, giữ phân trang và lỗi tiếng Việt.
- [x] T044 [US4] Thêm filter nội bộ và truy vấn registrationNumber bằng BigInt trong `src/modules/registration/registration.repository.ts`, kết hợp scope tin cậy và pagination, giữ mapping tại `registration.service.ts` và router/detail UUID.
- [x] T045 [US4] Cập nhật ví dụ tìm kiếm trong `docs/ONBOARDING.md` và `specs/001-add-registration-id/quickstart.md`; chạy `npm run validate`, `npm run test:unit`, spec gate preflight và `git diff --check`, ghi kết quả thực tế.

**Bằng chứng US4**: 7/7 kiểm thử registration PASS; `npm run validate` PASS; `npm run test:unit` 177/177 PASS; spec gate working-tree preflight PASS trên nhánh `fix/001-registration-code-search`; diff whitespace PASS. Test unit/HTTP dùng reader giả lập, không chạy PostgreSQL/Redis hoặc migration trong lần bổ sung này.
