# Tasks: Quản lí nhân viên nhà cung cấp nguyên liệu

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [staff contract](contracts/supplier-staff-api.md), [login contract](contracts/auth-login.md), [quickstart.md](quickstart.md).
**Created**: 2026-11-16. **Updated**: 2026-11-17.
**Revision**: Cập nhật từ 60 task chưa bắt đầu theo plan ngày 2026-11-17: mọi vai trò chỉ đăng nhập bằng email + mật khẩu, không lookup/fallback username hoặc ambiguity; giữ username theo supplier và email unique toàn hệ thống. ID được đánh lại; không kế thừa kết luận analyze cũ hoặc đánh dấu implementation đã hoàn tất.
**Tests**: Các task kiểm thử phục vụ acceptance/Independent Test và SC-001–SC-005 và SC-007 của spec, migration/auth design cùng quality gate repository. Viết regression trước implementation liên quan; nếu có thể chạy, ghi nhận fail đúng hành vi thiếu, không coi missing import/setup failure là bằng chứng nghiệp vụ. Không áp đặt TDD ngoài các regression cần thiết hoặc thêm framework.
**Organization**: Setup → nền tảng → năm story P1 → polish. Mỗi story dùng fixture độc lập; migration/auth chung được đặt trong nền tảng vì phục vụ danh tính và phiên của mọi vai trò xuyên suốt; acceptance SC-007 toàn hệ thống thuộc US3 theo spec.

## Format: `[ID] [P?] [Story] Description`

- Tất cả task có checkbox, ID tuần tự và đường dẫn file. [US1]–[US5] chỉ nằm trong phase story tương ứng.
- [P] chỉ có nghĩa có thể làm song song với task ở file khác sau khi đủ prerequisite, không bỏ qua dependency hoặc cho phép hai story cùng sửa file chung.
- Checkbox phản ánh công việc đã triển khai và kiểm chứng; bằng chứng thực tế tại quickstart.md. SC-006 chờ nghiệm thu qua ứng dụng; không tính backend tests là nghiệm thu UX.

## Path Conventions

Source mới có bảy file dưới src/modules/supplier-staff; auth thay tại src/modules/auth/session.validation.ts, session.repository.ts và session.service.ts, duplicate precheck trường tại user.repository.ts. DTO chỉ được services tiêu thụ, query/SQL nằm repository hoặc hạ tầng chung. Các đường dẫn task tính từ repository root.

Migration dự kiến: `prisma/migrations/20261120000200_supplier_staff_username_scope/migration.sql`, sau migration mới nhất đang có `20261120000100_dish_meal_classification`. Trước khi tạo phải rà lại lịch sử; nếu số đã bị dùng hoặc không còn là bản sau cùng, chọn version sau migration mới nhất và cập nhật đồng bộ đường dẫn trong tasks, không ghi đè hoặc chèn trước lịch sử đã áp.

Việc liệt kê migration không tự cho phép chạy DDL/deploy. Chỉ viết schema/migration khi tác vụ triển khai cho phép thay đổi cấu trúc; integration chỉ chạy khi tác vụ cho phép ghi vào disposable local của instance đã chọn. Không áp lên member/Azure, db push/reset/import/seed/bootstrap hoặc xóa volume để chuẩn bị tests. Thiếu prerequisite phải ghi blocked và giữ task kiểm chứng chưa hoàn tất.

## Phase 1: Setup — Nhánh và bộ khung

**Purpose**: Chuẩn bị môi trường hiện có, không khởi tạo project/framework mới.

- [x] T001 Kiểm tra working tree, tạo hoặc chuyển sang nhánh `feat/supplier-staff-management` từ `dev` mà không làm mất thay đổi đang có; cập nhật metadata nhánh/giai đoạn trong `specs/supplier-staff-management/spec.md` và `specs/supplier-staff-management/plan.md`, giữ `.specify/feature.json` ngoài commit.

- [x] T002 Tạo bộ khung CommonJS TypeScript cho `src/modules/supplier-staff/supplier-staff.routes.ts`, `supplier-staff.controller.ts`, `supplier-staff.validation.ts`, `supplier-staff.request.dto.ts`, `supplier-staff.response.dto.ts`, `supplier-staff.service.ts`, `supplier-staff.repository.ts`; dùng factory tiêm repository/transaction/auth để kiểm thử, chưa công khai endpoint chưa triển khai.

- [x] T003 Tạo harness fixture principal, repository/transaction doubles và HTTP helper trong `tests/supplier-staff-management.test.ts` theo pattern test module hiện có; đăng ký file vào script `test:unit` trong `package.json`, không thêm dependency/framework.

**Checkpoint**: Nhánh đúng feature và harness DI sẵn sàng; .specify/feature.json chỉ local, không commit.

## Phase 2: Foundational — Scope, transaction, migration và auth

**Purpose**: Phần dùng chung phải hoàn tất trước story; kiểm chứng DB có thể ghi blocked nếu chưa đủ phép/hạ tầng, nhưng không được coi migration đã hoạt động chỉ vì typecheck pass.

### Scope và hợp đồng chung

- [x] T004 [P] Thêm `SupplierStaffManagementScope`, helper kiểm role `INGREDIENT_SUPPLIER_ADMIN`, org/membership hợp lệ, quyền `supplier_staff.manage` và resource/list scope `supplier-staff` trong `src/utils/resource-access.ts`; giữ `listScopes.user` cũ, cập nhật matrix/ngoại lệ SYSTEM trong `tests/authorization.test.ts` để chứng minh không có bypass. ACTIVE được bảo đảm qua principal loader hiện hành, không tự thêm claim có tính quyết định quyền.

- [x] T005 [P] Định nghĩa toàn bộ Zod schemas query/params/create/status/empty body theo contract trong `src/modules/supplier-staff/supplier-staff.validation.ts`, dùng strictObject/safeParse và helper chung; export Request DTO z.infer trong `src/modules/supplier-staff/supplier-staff.request.dto.ts`. Giữ password nguyên văn, thu nhiều lỗi cùng field paths, không trả raw values; validator login chung được cập nhật riêng tại T013 theo FR-009, không đổi policy tạo mật khẩu.

- [x] T006 [P] Định nghĩa các Response DTO list/item/detail/permissions riêng trong `src/modules/supplier-staff/supplier-staff.response.dto.ts`, dùng allowlist của contract, phone/description nullable, timestamp string và pagination page/limit/hasNext; không gắn DTO vào Prisma hoặc trả hash/secret.

- [x] T007 Sau T004, xây các operation truy cập chung và internal types tại `src/modules/supplier-staff/supplier-staff.repository.ts`: scoped staff lookup/metadata, actor loader, staff role lookup, khóa Supplier → User ID tăng dần → Role ID tăng dần. Tái sử dụng protocol lockParents phù hợp; target User lock/read phải có supplier + staff role/type filter, không khóa target ngoài phạm vi và không import DTO.

- [x] T008 Sau T005–T007, tạo factory service, mapping allowlist và wrapper write chung tại `src/modules/supplier-staff/supplier-staff.service.ts`: scope từ principal, một authorizationTransaction Serializable, cùng tx cho mọi read/lock/write, recheck actor ACTIVE/permission/role/membership sau khóa và so sánh metadata/scope ban đầu. Không dựng Prisma query hoặc mở nested transaction; lỗi hạ tầng/retry hết theo helper chung trả 503, không tự chặn theo intakeState.

### Regression và thay đổi danh tính dùng chung

- [x] T009 [P] Viết fresh/replay và upgrade regression trong `tests/migrations.test.ts` cho migration `prisma/migrations/20261120000200_supplier_staff_username_scope/migration.sql`: hai supplier trùng staff username được, staff/admin cùng supplier trùng bị chặn, non-staff trùng nhau bị chặn, email Citext unique toàn cục ở mọi status; kiểm catalog/predicates, dữ liệu ID/hash/role/status/timestamps/history/denial giữ nguyên và rollback DDL khi lỗi. Dùng harness disposable hiện có, không sửa baseline expectation để che thay đổi.

- [x] T010 [P] Viết regression validation/repository/service trong `tests/auth-session.test.ts` theo FR-009/SC-007: từng mã role trong `src/constants/roles.ts` login đúng bằng email; username không khớp email nào/unknown email/password sai cùng 401 với dummy bcrypt khi không có candidate. Kiểm trim/lowercase email, password nguyên văn 1–72 byte, non-email nonempty 401 và missing/empty/oversize/extra field 400. Fixture email A = username B với password khác nhau chỉ chọn A; password chỉ đúng với B phải 401. Bỏ positive username-login/OR/take:2/ambiguity tests cũ; mocks phân biệt unique-email lookup, locked reread và full identity query. Email/hash đổi trước User lock phải bị từ chối; role/membership/status đổi phải được nạp hiện hành, giữ onboarding/cookie/CSRF/refresh.

- [x] T011 [P] Bổ sung regression `tests/password.test.ts` cho hai staff trùng username/email khác và email A trùng username B: request/verify/reset theo email chỉ đổi password/thu hồi phiên đúng User.id, không tác động B. Giữ recovery email unique/userId/fingerprint, không thêm supplier selector, đổi contract hoặc gửi email thật.

- [x] T012 Khi được phép viết thay đổi cấu trúc trong tác vụ triển khai, cập nhật `prisma/schema.prisma` và tạo `prisma/migrations/20261120000200_supplier_staff_username_scope/migration.sql`: trong một transaction có timeout, tạo uq_users_non_staff_username trên username khi role_code khác INGREDIENT_SUPPLIER_STAFF và uq_users_supplier_username trên (supplier_id, username) khi supplier_id IS NOT NULL trước khi DROP CONSTRAINT users_username_key. Map partialIndexes/predicates đúng PostgreSQL, giữ email/admin/officer unique, FK/CHECK khác; không backfill/rename account, sửa applied migration/manifest, hoặc tự áp lên DB. Phụ thuộc regression T009 đã xác định.

- [x] T013 Sau regression T010, cập nhật `src/modules/auth/session.validation.ts`: giữ strict identifier/password, requiredText(320) rồi lowercase identifier đã trim; password nguyên văn 1–72 byte. Không thêm email-format validator hoặc field email/username/org/role; username/non-email nonempty đi qua email lookup rồi 401 nếu không khớp, lỗi cấu trúc/missing/empty/oversize/extra field vẫn 400. Giữ Request DTO suy từ schema hiện có, không đổi policy tạo/reset mật khẩu.

- [x] T014 Sau T010 và T013, thay findCandidates bằng findByEmail trong `src/modules/auth/session.repository.ts`: findUnique theo email Citext, chỉ select id/passwordHash, trả candidate hoặc null; bỏ OR username, role filter, take:2 và multiple-candidate logic. lockPassword khóa User theo real id, rồi findFirst cùng id + email trong tx để so email bằng Citext tại DB và đọc lại hash; không dùng username partial key cho unique operations hoặc đưa query vào service.

- [x] T015 Sau T014, cập nhật `src/modules/auth/session.service.ts` dùng candidate/null từ findByEmail cho mọi role; giữ một password comparison hoặc dummy khi không có candidate, 401 chung “Email hoặc mật khẩu không đúng”. Sau User lock, truyền cùng id/email normalized để repository đọc lại và từ chối nếu email không còn khớp hoặc hash đổi; không so email bằng JS thay Citext. Chỉ cấp phiên sau loadSessionUser/current role/membership/status: ACTIVE theo policy hiện hành, UNVERIFIED admin đã verify chỉ onboarding, staff UNVERIFIED/LOCKED/INACTIVE/DEACTIVATED bị chặn. Không OR/fallback username/chọn theo password, không thêm verification cho staff ACTIVE; giữ JWT/cookie/CSRF/refresh/logout/envelopes và không dựng Prisma query trong service.

- [x] T016 Điều chỉnh riêng `findUserByEmailOrUsername` trong `src/modules/user/user.repository.ts` thành email toàn cục OR username của non-staff; giữ input/output, role assignment, default password và HTTP contract trường. Signup tiếp tục dùng index non-staff cùng P2002→409 hiện hành, không mở rộng refactor signup hoặc thêm query vào service.

- [x] T017 Sau T012–T016, audit source/tests dùng unique username và đổi sang id/email hoặc scoped findFirst tại `tests/authorization.integration.test.ts`. Chuyển toàn bộ positive login helper/body của mọi role trong file này và `tests/account-lifecycle.integration.test.ts`, `tests/supplier-onboarding.integration.test.ts` sang email, gồm passwordLogin, lifecycle status matrix và onboarding manager/warehouse/health/admin. Giữ tests username ở create/DTO/uniqueness; username-login chỉ còn negative khi không khớp email nào. Không biến status/onboarding 403 thành 401 do fixture sai; không hand-edit generated client. Ghi fixture changes tại `specs/supplier-staff-management/quickstart.md`.

- [x] T018 [P] Sau T010–T011, thêm kiểm thử không cần DB cho thay đổi runner tại `tests/local-test-database.test.ts`: nhóm authorization dispatch authorization.integration và supplier-onboarding.integration bằng hai child process tuần tự cùng env/manifest, truyền lỗi/signal và cleanup chỉ DB được ghi nhận sau CREATE thành công/đúng owner. Kiểm failed CREATE không được đăng ký và DB control/member/unrecorded không bị cleanup; tái dùng helper hoặc seam DI tối thiểu, không chạy PostgreSQL thật trong unit test.

- [x] T019 Sau T018 và T017, mở rộng nhóm authorization hiện có trong `tests/helpers/run-local-tests.ts` để chạy `tests/authorization.integration.test.ts` và `tests/supplier-onboarding.integration.test.ts` tuần tự ở child process riêng, dùng cùng selected instance/env/manifest, giữ fail/signal propagation. Tại supplier-onboarding suite, gọi recordLocalTestDatabase từ `tests/helpers/local-test-database.ts` ngay sau CREATE DATABASE thành công và bảo đảm đóng kết nối/cleanup khi fail; giữ wrapper cleanup theo exact manifest/owner, không quét prefix, thêm group/container hoặc reset control/member. Không refactor toàn harness hoặc chạy DB ở task viết code này.

- [x] T020 Sau T011–T017 và T019, chạy prisma:validate/prisma:generate/typecheck theo `package.json` và regression không cần hạ tầng tại `tests/auth-session.test.ts`, `tests/password.test.ts`, `tests/authorization.test.ts`, `tests/local-test-database.test.ts`; ghi kết quả vào `specs/supplier-staff-management/quickstart.md`. Kiểm generated types không còn unique username, normalization và locked reread đúng, runner dispatch/failure cleanup pass. Không chạy DDL hoặc xác nhận DB migration từ typecheck; migration regression T009 được thực thi tại T061 khi đủ điều kiện.

**Checkpoint**: Uniqueness dữ liệu username, unique-email login/recheck mọi role và local runner integration đã sẵn; các lớp staff dùng scope/DTO/transaction chung. Chỉ coi migration verified khi T009 đã pass trong database disposable, không suy ra từ generated types.

## Phase 3: User Story 1 — Xem danh sách (Priority: P1) — MVP

**Goal**: Admin xem đúng staff supplier hiện tại, gồm mọi status và phân trang an toàn.
**Independent Test**: Fixture hai supplier có admin/staff ở nhiều status; kiểm đúng supplier, không admin, pagination rỗng/overflow/limit 100, thứ tự ổn định và role/permission denied. Không cần API create để chuẩn bị fixture.

### Tests for User Story 1

- [x] T021 [P] [US1] Viết unit/HTTP acceptance cho GET list trong `tests/supplier-staff-management.test.ts`: default 1/20, limit 100, limit+1/hasNext, mọi status, thứ tự createdAt desc/id asc, rỗng/vượt trang, query lạ/overflow, role/permission và DTO không lộ bí mật; stub chỉ các operation list cần dùng.

- [x] T022 [P] [US1] Thêm fixture hai supplier và kiểm tenant isolation/loại trừ admin, SYSTEM/staff dù có permission, actor thiếu quyền cho GET list vào `tests/authorization.integration.test.ts`; dùng harness disposable hiện có và chỉ chạy khi được phép ghi local.

### Implementation for User Story 1

- [x] T023 [US1] Cài operation list trong `src/modules/supplier-staff/supplier-staff.repository.ts`, áp trusted supplier + staff role/type vào WHERE, select allowlist, order createdAt desc/id asc, skip/take limit+1; không count hoặc load toàn bộ dữ liệu.

- [x] T024 [US1] Cài getAll trong `src/modules/supplier-staff/supplier-staff.service.ts`: gọi scope tại resource-access, truyền normalized pagination, cắt limit/map DTO và hasNext; lỗi đọc theo error helper, không cache hoặc dựng query tại service.

- [x] T025 [US1] Cài controller/route GET `/api/supplier-staff` trong `src/modules/supplier-staff/supplier-staff.controller.ts` và `supplier-staff.routes.ts`, đăng ký tại `src/routes/index.ts`; dùng authenticate, validator, requirePrincipal và sendSuccess; không import DTO vào controller.

- [x] T026 [US1] Chạy các acceptance US1 trong `tests/supplier-staff-management.test.ts` và integration T022 nếu đủ điều kiện; ghi kết quả thực tế/prerequisite bị chặn vào `specs/supplier-staff-management/quickstart.md`, xác nhận list chạy độc lập với bốn story còn lại.

**Checkpoint**: GET list là MVP độc lập; các endpoint write chưa hoàn tất không được công khai.

## Phase 4: User Story 2 — Xem chi tiết (Priority: P1)

**Goal**: Xác định đúng nhân viên, xem thông tin mọi AccountStatus không lộ dữ liệu.
**Independent Test**: Detail staff ACTIVE/LOCKED/INACTIVE/UNVERIFIED/DEACTIVATED có sẵn; target admin/ngoài supplier/không tồn tại cùng 404, UUID sai 400. Không cần create/status/permissions.

### Tests for User Story 2

- [x] T027 [P] [US2] Viết unit/HTTP cho detail, timestamp ISO/phone null, safe projection, mọi AccountStatus, UUID sai 400 và 404 đồng nhất cho target không hợp lệ trong `tests/supplier-staff-management.test.ts`.

- [x] T028 [P] [US2] Thêm integration GET detail của staff ACTIVE/LOCKED/INACTIVE/UNVERIFIED/DEACTIVATED, đối chiếu target admin/khác supplier/không tồn tại không lộ dữ liệu trong `tests/authorization.integration.test.ts`.

### Implementation for User Story 2

- [x] T029 [US2] Hoàn thiện findStaff detail projection trong `src/modules/supplier-staff/supplier-staff.repository.ts` với id + supplier + staff role/type, bao gồm createdAt/updatedAt và không tự lọc ACTIVE; không dùng principalFromIdentity cho target.

- [x] T030 [US2] Cài getDetail trong `src/modules/supplier-staff/supplier-staff.service.ts`, kiểm actor scope, trả cùng HttpError 404 `Không tìm thấy tài khoản nhân viên` khi target không đúng phạm vi, map detail allowlist và serialize thời gian.

- [x] T031 [US2] Thêm GET `/:userId` với strict params/empty query và response 200 vào `src/modules/supplier-staff/supplier-staff.controller.ts` và `src/modules/supplier-staff/supplier-staff.routes.ts`, giữ auth và envelope chung.

- [x] T032 [US2] Chạy kiểm chứng US2 trong `tests/supplier-staff-management.test.ts` và T028 khi đủ điều kiện, ghi kết quả vào `specs/supplier-staff-management/quickstart.md`; xác nhận vẫn xem được detail khi target LOCKED mà không phải mở khóa.

**Checkpoint**: Xem được cả staff LOCKED, timestamp ISO và safe projection; không cần mở khóa để xem detail.

## Phase 5: User Story 3 — Tạo tài khoản và email login (Priority: P1)

**Goal**: Tạo staff ACTIVE đúng supplier, username scoped/global email unique; email-only login đúng chủ email cho mọi vai trò theo FR-009/SC-007.
**Independent Test**: Hai admin ở hai supplier tạo staff cùng username/email khác đều thành công, email login trả đúng user/supplier. Trùng username cùng supplier hoặc trùng email bất kỳ đâu phải từ chối; username mọi role không login được nếu không khớp email nào. Email A = username B chỉ xác thực A; giữ policy status/onboarding. Dùng fixture mọi role độc lập, không cần US4/US5.

### Tests for User Story 3

- [x] T033 [P] [US3] Viết unit/HTTP create trong `tests/supplier-staff-management.test.ts`: strict fields/multiple issues, password Unicode policy không trim, username case-sensitive/email chuẩn hóa, phone nullable, hash không lộ; username duplicate check cùng supplier gồm admin/mọi status, email toàn hệ thống. Kiểm không dùng role/org/status từ client, cùng tx/actor recheck, unique 409 trước DB wrapper, rollback và role config sai 503 an toàn.

- [x] T034 [P] [US3] Thêm integration POST create → email login tại `tests/authorization.integration.test.ts`: hai supplier cùng username/email khác đều success và đúng userId/supplierId, username staff không khớp email nào không cấp phiên; race cùng supplier/username tối đa một success, staff trùng admin cùng supplier 409, email cross-supplier/role kể cả khác hoa/thường hoặc inactive tối đa một success. Giữ signup/school non-staff username uniqueness ở create, không registration/denial mới; login của non-staff cũng chỉ dùng email.

- [x] T035 [US3] Sau T034 (cùng file), thêm ma trận SC-007 theo T010 trong `tests/authorization.integration.test.ts` cho từng mã `ROLES` của `src/constants/roles.ts`, không chỉ đại diện orgType: email normalized/password đúng → đúng userId/role/org, username không khớp email nào và credential sai/unknown → 401 không phiên. Dùng school username được phép chứa email để dựng email A = username B với passwords khác nhau; chỉ password A mở A, password chỉ đúng B → 401, username A = email B chỉ xét B. Kiểm ACTIVE theo policy hiện hành; UNVERIFIED school/supplier admin đã/chưa verify, staff UNVERIFIED và LOCKED/INACTIVE/DEACTIVATED không bị kích hoạt; đúng credential đến đúng bước status/onboarding (403 hoặc onboarding-only như cũ). Giữ assertions quyền/session/cookie/CSRF/refresh; fixture không cần API create của story khác.

- [x] T036 [P] [US3] Thêm barrier regression create staff đối đầu vô hiệu hóa admin/supplier theo cả hai thứ tự trong `tests/account-lifecycle.integration.test.ts`: create đi trước bị cascade, cascade đi trước làm create bị từ chối/retry; không có staff ACTIVE còn lại sau cascade.

### Implementation for User Story 3

- [x] T037 [US3] Cài readStaffRole, duplicate check và createStaff trong `src/modules/supplier-staff/supplier-staff.repository.ts`: email unique toàn cục OR username trong trusted supplier, nhánh username bắt cả admin cùng supplier. Xác minh role type SUPPLIER, composite roleId/roleCode, status ACTIVE, emailVerifiedAt null, không registration/grant/denial. Dùng constraints của T012 chặn race; map đúng lỗi trùng username trong supplier hoặc email thành 409 chung trước wrapper, không từ chối vì username chỉ trùng ở supplier khác.

- [x] T038 [US3] Cài create trong `src/modules/supplier-staff/supplier-staff.service.ts`: bcrypt cost 12 trước transaction, wrapper T008 recheck/lock, role SUPPLIER hợp lệ và internal create input allowlist; không Prisma query/nested tx/default password/email gửi tự động. Trả detail DTO sau commit, staff dùng email login qua cơ chế T014–T015 nền tảng. Không tạo hoặc trả session trong API create.

- [x] T039 [US3] Thêm POST `/api/supplier-staff` trong `src/modules/supplier-staff/supplier-staff.controller.ts` và `supplier-staff.routes.ts` với create validator, auth/CSRF hiện hành và sendSuccess status 201; response không có password hoặc token.

- [x] T040 [US3] Chạy acceptance create US3 trong `tests/supplier-staff-management.test.ts`; bổ sung targeted recovery email A với staff B trùng username và email A trùng username B vào `tests/authorization.integration.test.ts`, chứng minh chỉ đổi đúng password/phiên A. Kiểm integration create/auth/cascade và ma trận T035 khi được phép; ghi kết quả SC-002/SC-007, role matrix hoặc blocked prerequisite vào `specs/supplier-staff-management/quickstart.md`. Không coi mock tests là bằng chứng migration/concurrency thật.

**Checkpoint**: Staff username có thể trùng cross-supplier với email riêng; mọi role chỉ login bằng email, cross-field collision chỉ xét chủ email; recovery đúng User.id. Cần migration/integration thật trước khi xác nhận đầy đủ tính đúng đắn.

## Phase 6: User Story 4 — Khóa/mở khóa (Priority: P1)

**Goal**: Thu hồi/khôi phục truy cập riêng cho staff, giữ history/denial, không kích hoạt DEACTIVATED.
**Independent Test**: Staff fixture có email/denial/phiên sẵn; sau khóa login email/refresh/nghiệp vụ bị chặn, mở khóa login email mới được; nhân viên cùng username ở supplier khác không đổi.

### Tests for User Story 4

- [x] T041 [P] [US4] Viết unit/HTTP status matrix ACTIVE ↔ LOCKED, same-state no-op không đổi updatedAt, trạng thái UNVERIFIED/INACTIVE/DEACTIVATED 409, body status khác/unknown field 400, ownership 404, actor recheck và bảo toàn denial/công việc tại `tests/supplier-staff-management.test.ts`.

- [x] T042 [P] [US4] Thêm integration vào `tests/authorization.integration.test.ts`: giữ phiên staff trước khóa, kiểm email login/refresh/nghiệp vụ tiếp theo bị chặn; unlock cho email login mới và denial còn nguyên. Hai staff khác supplier trùng username không ảnh hưởng nhau; supplier intake tạm dừng không tự cấm admin quản lí nhân viên.

- [x] T043 [P] [US4] Thêm barrier regression unlock staff đối đầu cascade DEACTIVATED theo hai thứ tự, rollback/lỗi và trạng thái cuối không có ACTIVE survivor trong `tests/account-lifecycle.integration.test.ts`; dùng fixture độc lập, không phụ thuộc API create của US3.

### Implementation for User Story 4

- [x] T044 [US4] Cài setStatus trong `src/modules/supplier-staff/supplier-staff.repository.ts`, cập nhật bằng real id và ownership filter cùng trạng thái cũ trong tx chung, trả projection detail; không cập nhật intakeState/role/denial/công việc hoặc bản ghi ngoài supplier.

- [x] T045 [US4] Cài changeStatus trong `src/modules/supplier-staff/supplier-staff.service.ts` qua wrapper T008, đọc lại target sau khóa, chỉ ACTIVE/LOCKED, trạng thái khác 409; same-state trả DTO không gọi write; giữ auth/session hiện có, không quét/revoke toàn bộ Redis.

- [x] T046 [US4] Thêm PATCH `/:userId/status` trong `src/modules/supplier-staff/supplier-staff.controller.ts` và `supplier-staff.routes.ts`, validate params/query/body strict và trả detail DTO/envelope 200 kể cả no-op.

- [x] T047 [US4] Chạy kiểm chứng US4 qua `tests/supplier-staff-management.test.ts` và hai suite integration đã mở rộng khi đủ điều kiện; ghi bằng chứng phiên cũ, denial và concurrency/blocked prerequisites vào `specs/supplier-staff-management/quickstart.md`.

**Checkpoint**: Khóa tác động đúng userId; unlock không khôi phục DEACTIVATED hoặc xóa thiết lập tắt quyền. Không quét/revoke toàn bộ Redis.

## Phase 7: User Story 5 — Quản lí quyền riêng (Priority: P1)

**Goal**: Xem/bật/tắt quyền từng staff trong trần role; có hiệu lực ở request tiếp theo.
**Independent Test**: Hai staff ACTIVE, gồm trường hợp khác supplier trùng username, có email login riêng; tắt/bật một quyền của người thứ nhất không đổi người thứ hai, không cấp quyền ngoài role. Target không ACTIVE bị từ chối.

### Tests for User Story 5

- [x] T048 [P] [US5] Viết unit/HTTP cho ba endpoint permissions trong `tests/supplier-staff-management.test.ts`: grants active/inactive, enabled từ scoped denial, role rỗng, sort code, ngoài role/inactive/không tồn tại 400, target ngoài scope 404 rồi target không ACTIVE 403, PUT/DELETE idempotent, touchUser chỉ khi đổi denial, empty/unknown body, cùng tx và không ảnh hưởng staff khác.

- [x] T049 [P] [US5] Thêm integration quyền từ phiên cũ, hai staff độc lập, denial còn khi gỡ/cấp lại grant, actor bị thu hồi supplier_staff.manage bằng denial hoặc thay role grants lúc đang mutation, target grants/status đổi đồng thời và PUT/DELETE cạnh tranh vào `tests/authorization.integration.test.ts`; dùng barrier, kiểm recheck/retry và không nâng quyền.

### Implementation for User Story 5

- [x] T050 [US5] Cài readPermissionState/findActiveRoleGrant trong `src/modules/supplier-staff/supplier-staff.repository.ts`, đọc target/grants/permission flags/denials đúng supplier trong cùng snapshot read hoặc write tx, sort permission code tăng dần; giữ cả grant inactive, không đưa grant đã bị gỡ thành quyền ngoài role.

- [x] T051 [US5] Cài disablePermission/enablePermission tại `src/modules/supplier-staff/supplier-staff.repository.ts` với đúng user/permission/supplier: createMany skipDuplicates hoặc deleteMany; dùng role locks theo protocol chung và gọi permissionConcurrencyRepository.touchUser trong cùng tx chỉ khi count > 0. Không cập nhật RolePermission, không xóa denial của người/tổ chức khác.

- [x] T052 [US5] Cài getPermissions trong `src/modules/supplier-staff/supplier-staff.service.ts`: scope/target staff trước, target ACTIVE sau, read snapshot đồng nhất, enabled = grant active trừ denial đúng supplier, map StaffPermissions DTO allowlist; không cache hoặc trả persistence record.

- [x] T053 [US5] Cài togglePermission trong `src/modules/supplier-staff/supplier-staff.service.ts` qua wrapper T008, khóa actor/target và các role liên quan trước recheck, target ACTIVE, grant active thuộc role; không hợp lệ trả 400/403 theo contract, đọc lại permission state trong cùng tx và trả DTO sau commit. Không gọi permission service cũ mở giao dịch khác, không xóa denial khi grants thay đổi.

- [x] T054 [US5] Thêm GET `/:userId/permissions`, PUT và DELETE `/:userId/permission-denials/:permissionId` trong `src/modules/supplier-staff/supplier-staff.controller.ts` và `supplier-staff.routes.ts`; validate strict params/query/empty body, dùng principal và response 200 đúng message/DTO của contract.

- [x] T055 [US5] Chạy acceptance US5 ở `tests/supplier-staff-management.test.ts` và integration T049 khi đủ điều kiện, ghi kết quả vào `specs/supplier-staff-management/quickstart.md`; xác nhận quyền ngoài role luôn bị từ chối và lần truy cập kế tiếp phản ánh thay đổi mà không cần login lại.

**Checkpoint**: Đủ bảy endpoint, target staff-only và quyền không vượt role; mọi thao tác nhắm userId/supplier, không dùng username đơn lẻ làm danh tính.

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Đồng bộ docs, quality, migration/auth/lifecycle evidence và rollout hướng dẫn; không tự deploy.

- [x] T056 [P] Cập nhật matrix bảy staff APIs và username/email uniqueness trong `docs/AUTHORIZATION.md`; cập nhật `docs/AUTH_SESSIONS.md` cho email-only của mọi role, body identifier/password, trim/lowercase, 400/401 semantics, unique-email lookup/recheck email/hash và bỏ hướng dẫn username/ambiguity login. Hướng dẫn mọi client dùng email đã có, giữ cookie/CSRF/refresh/recovery và phân biệt staff routes với generic permission contract.

- [x] T057 [P] Cập nhật ownership, routes và phân lớp module staff trong `src/modules/README.md`; ghi auth vẫn thuộc auth module, school chỉ điều chỉnh duplicate predicate và giữ contract cũ, không chuyển quyền sở hữu generic user/permission/lifecycle.

- [x] T058 [P] Ghi migration mới supplier_staff_username_scope, indexes thay thế và trạng thái review/test/deploy thực tế trong `database/SCHEMA_BASELINE.md`; không sửa baseline fingerprint/checksum cũ, không ghi đã apply khi chưa chạy, không tuyên bố có seed hoặc backfill.

- [x] T059 Rà kiến trúc/output tại `src/modules/supplier-staff/`, `src/modules/auth/session.validation.ts`, `src/modules/auth/session.repository.ts`, `src/modules/auth/session.service.ts`, `src/modules/user/user.repository.ts`: đúng DTO/layer, mọi business write cùng tx/ownership, auth chỉ unique email mọi role, normalize input và email/hash recheck sau lock; không còn fallback username hoặc logic ambiguity. Rà `tests/helpers/run-local-tests.ts` và `tests/supplier-onboarding.integration.test.ts` đúng sequential dispatch/manifest cleanup. Sửa vấn đề trong phạm vi, không refactor/reformat toàn repo hoặc thay migration applied.

- [x] T060 Chạy `npm run prisma:validate`, `npm run validate`, `npm run test:unit` theo `package.json`; validate đã gồm typecheck/build/generate. Sửa lỗi feature trong source/tests đã nêu và ghi pass/fail thực tế tại `specs/supplier-staff-management/quickstart.md`; không lặp bộ đã pass sau thay đổi cuối nếu không có thay đổi/failure mới.

- [x] T061 Sau T019 và T060, khi tác vụ đã cho phép ghi disposable trên instance local đã chọn, chạy các nhóm test:local:migrations, test:local:authorization, test:local:lifecycle theo `specs/supplier-staff-management/quickstart.md`. Bao phủ `tests/migrations.test.ts`, `tests/authorization.integration.test.ts`, `tests/supplier-onboarding.integration.test.ts`, `tests/account-lifecycle.integration.test.ts` sau thay đổi cuối: migration preservation/rollback/race, SC-007 từng role/cross-field collision/status/onboarding, create/school/signup/generic permissions và session/recovery. Xác nhận cả hai suite authorization/onboarding thực sự được dispatch tuần tự và cleanup đúng invocation manifest/owner, không scan prefix. Tái dùng kết quả đã đủ sau lần sửa cuối; thiếu phép/hạ tầng ghi blocked và giữ task mở, không đổi DB/reset/flush hoặc báo suite chưa chạy là pass.

- [x] T062 Chạy npm run spec:check theo base/head refs tại `contribute.md` mục 8.5 và `.github/scripts/spec-gate.mjs` trên feature branch có đủ spec/plan/tasks; đối chiếu FR-001–FR-019 và SC-001–SC-007 với task/bằng chứng trong `specs/supplier-staff-management/tasks.md`, không thêm bypass hoặc coi chạy trên dev là PR gate đã pass.

- [x] T063 Hoàn thiện rollout trong `specs/supplier-staff-management/quickstart.md`: code chỉ lookup email cho mọi vai trò trước hoặc cùng đợt kiểm soát với migration, kiểm nghiệm rồi mới cho tạo username trùng; client/tài khoản đang login username chuyển sang email đã có, không fallback tạm thời. Session userId giữ policy/TTL hiện hành; không quét/revoke toàn bộ Redis hoặc tự đổi tên/email/password/gộp account. Ghi không rollback code cũ sau khi có duplicates; task hướng dẫn không tự deploy/apply.

- [x] T064 Tổng hợp kết quả thật/blocked prerequisite tại `specs/supplier-staff-management/quickstart.md`, cập nhật checkbox thực sự hoàn thành trong `specs/supplier-staff-management/tasks.md`. SC-001–SC-005 cần evidence unit/integration/migration; SC-007 cần bảng từng mã role → email success/username negative/status/onboarding/cross-field collision và bằng chứng email/hash recheck, I1 chỉ verified khi test mới pass. SC-006 ghi trạng thái nghiệm thu qua ứng dụng với quản trị viên, không suy từ backend pass hoặc tự xây UI. Không báo hoàn tất feature khi test DB bắt buộc vẫn bị chặn.

**Checkpoint**: Chỉ xác nhận implementation đã kiểm chứng đầy đủ khi các quality/integration bắt buộc có kết quả thật; task bị chặn không được đánh dấu xong. SC-006 là nghiệm thu sản phẩm riêng và phải báo đúng trạng thái.

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup: T001 → T002 → T003
Foundation A: T004 / T005 / T006 độc lập sau Setup
              T004 → T007
              T005 + T006 + T007 → T008
Foundation B: T009 / T010 / T011 độc lập sau Foundation A
              T009 → T012
              T010 → T013 → T014 → T015
              T012 → T016
              T012 + T015 + T016 → T017
              T010 + T011 → T018
              T017 + T018 → T019
              T011–T019 → T020
Foundation complete → US1 / US2 / US3 / US4 / US5
T021–T055 hoàn tất → Polish T056–T064
```

T012 chỉ tạo schema/SQL khi tác vụ triển khai cho phép, không tự apply trên DB vận hành. T020 phải pass để hoàn tất nền tảng code/type/unit; kiểm DB của T009 được chạy tại T061 khi đủ phép/hạ tầng. T018–T019 tích hợp suite onboarding và cleanup trước khi dùng kết quả nhóm authorization làm bằng chứng. Thiếu điều kiện DB không chặn việc viết code/unit nhưng giữ các task kiểm chứng DB mở; không tuyên bố runtime migration hoặc feature đã được nghiệm thu đầy đủ.

### User Story Dependencies

| Story | Prerequisite                                               | Thứ tự trong story                                  | Kiểm chứng độc lập                                                 |
| ----- | ---------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| US1   | T001–T020                                                  | T021/T022 → T023 → T024 → T025 → T026               | Hai supplier/list, không cần API create                            |
| US2   | Foundation; mount T025 hoặc bước mount tương đương một lần | T027/T028 → T029 → T030 → T031 → T032               | Staff mọi status, không chờ US3/US4/US5                            |
| US3   | Foundation và mount                                        | T033/T034/T036; T034 → T035; T033–T036 → T037–T040  | Create/email login; fixture mọi role cho SC-007, không cần US4/US5 |
| US4   | Foundation và mount                                        | T041/T042/T043 → T044 → T045 → T046 → T047          | Staff/denial/phiên có sẵn, không chờ API create/permissions        |
| US5   | Foundation và mount                                        | T048/T049 → T050 → T051 → T052 → T053 → T054 → T055 | Fixture grants/staff, không gọi API của story khác để chuẩn bị     |

Tất cả story P1; mặc định triển khai US1 → US2 → US3 → US4 → US5 vì dùng chung service/repository/controller/routes và file tests. T025 sở hữu mount router tại src/routes/index.ts; nếu làm story khác trước, mount một lần ở lát đó. SC-007 được kiểm unit ở foundation T010–T015 và kiểm integration ở US3 T035/T040 theo vị trí acceptance trong spec; không thêm user story thứ sáu. Không đòi API của story khác để tạo fixture.

### Within Each User Story

Viết regression/acceptance trước implementation liên quan, repository trước service, service trước endpoint; validation dùng schema nền tảng, không mở field/role/status ngoài contract. T034 và T035 cùng sửa authorization.integration.test.ts nên làm tuần tự, dù các task test khác file có thể song song. Chạy targeted unit/HTTP sau từng lát khi cần; tránh chạy lại cả integration suite ở mọi checkpoint. T061 kiểm trạng thái cuối và có thể tái dùng kết quả đủ mới, ghi rõ pass/fail/blocked, không lấy skipped làm pass.

Polish: T056/T057/T058 độc lập sau khi endpoints/schema/auth ổn định; T059 → T060 → T061 → T062, T064 tổng hợp cuối. T063 chỉ viết rollout; có thể làm cùng docs nếu không đồng thời sửa quickstart với task kiểm chứng. DB bị chặn vẫn có thể kiểm docs/spec gate, nhưng T061 và các task nghiệm thu DB còn mở.

### Parallel Opportunities

- T004/T005/T006 sửa scope, Request schemas/DTO và Response DTO ở các file khác nhau sau Setup.
- T009/T010/T011 sửa migrations.test.ts, auth-session.test.ts và password.test.ts sau Foundation A. T012 có thể song song T013–T015 sau regression tương ứng; T017 chờ cả migration types, auth và school precheck.
- T018 (local-test-database.test.ts) độc lập với T017 (authorization/lifecycle/onboarding fixtures) khi T010/T011 xong; T019 chờ cả hai, T020 kiểm nền tảng sau tích hợp.
- Các test [P] trong một story ở unit/authorization/lifecycle file riêng; không song song hai story cùng sửa file chung. T035 chờ T034 vì cùng file, không gắn [P].
- T056 (AUTHORIZATION/AUTH_SESSIONS), T057 (module README), T058 (SCHEMA_BASELINE) là ba task docs độc lập.
- [P] mô tả khả năng phân công khi đủ dependency; không tự cho phép spawn agent, chạy DB hoặc sửa file cùng lúc.

## Parallel Example: User Story 1

Sau Foundation, T021 viết unit/HTTP trong tests/supplier-staff-management.test.ts song song T022 trong tests/authorization.integration.test.ts; T023–T026 làm theo chuỗi. Fixture list có sẵn, không chờ create.

## Parallel Example: User Story 2

T027 (unit/HTTP) và T028 (authorization integration) ở hai file độc lập, sau khi các story khác đã ngừng sửa chúng; T029–T032 tuần tự. Mọi status dùng fixture trực tiếp.

## Parallel Example: User Story 3

T033/T034/T036 ở ba file unit/authorization/lifecycle có thể viết song song; T035 chỉ bắt đầu khi T034 xong vì cùng authorization.integration.test.ts. T037–T040 theo dependency. Migration và global email-only implementation đã có ở Foundation; SC-007 dùng fixture riêng cho mỗi mã role, không chờ status/permissions APIs.

## Parallel Example: User Story 4

T041/T042/T043 ở ba file độc lập; T044–T047 theo chuỗi. Fixture hai staff cùng username/khác supplier có email và phiên riêng, không phụ thuộc API create.

## Parallel Example: User Story 5

T048 (unit/HTTP) song song T049 (authorization integration); T050–T055 tuần tự, tránh xung đột file với story khác. Khi endpoint/schema/auth ổn định, T056/T057/T058 sửa docs ở các file riêng.

## Requirement Coverage

| Yêu cầu / kết quả                                          | Task chính                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| FR-001–002: actor/permission/trusted supplier              | T004, T007–T008, T021–T022, T027–T028, T049                                  |
| FR-003–004: list/pagination/safe projection                | T005–T006, T021–T026                                                         |
| FR-005: detail/mọi status/404                              | T027–T032                                                                    |
| FR-006–007: strict create/role/membership/ACTIVE           | T005–T008, T033, T037–T039                                                   |
| FR-008: scoped username/global email                       | T009, T012, T016–T017, T020, T033–T034, T037, T058, T061                     |
| FR-009: email-only mọi role/normalization/recheck/recovery | T010–T011, T013–T020, T034–T035, T038, T040, T056, T059–T061, T063–T064      |
| FR-010–012: status/phiên/giữ denial/history                | T041–T047                                                                    |
| FR-013–016: role grants/scoped denials                     | T048–T055                                                                    |
| FR-017–018: tx/recheck/rollback/race                       | T007–T010, T012, T014–T015, T033–T036, T041–T043, T048–T049, T051–T053, T061 |
| FR-019: envelope/lỗi/không secret                          | T005–T006, T010, T013, T021, T027, T033, T041, T048, T056, T059–T060         |
| SC-001: dữ liệu đúng supplier                              | T021–T022, T027–T028                                                         |
| SC-002: create/username scoped/email unique/login          | T009–T020, T033–T040, T061                                                   |
| SC-003: khóa chặn truy cập, unlock giữ denial              | T041–T047                                                                    |
| SC-004: quyền đúng người/đúng trần/request tiếp theo       | T048–T055                                                                    |
| SC-005: lỗi/thiếu quyền/concurrency không partial write    | T008–T010, T033–T036, T041–T043, T048–T049, T059–T061                        |
| SC-006: nghiệm thu tác vụ qua ứng dụng                     | T064 ghi trạng thái thật, không thay bằng backend pass                       |
| SC-007: từng role/email/username/collision/status          | T010, T013–T015, T017–T020, T035, T040, T056, T061, T063–T064                |
| I1: email A = username B chỉ xác thực chủ email            | T010–T011, T014–T015, T035, T040, T061, T064                                 |
| Governance/docs/rollout/quality                            | T001–T003, T056–T064                                                         |
| CI retry actor/COMMIT — FR-017–018, SC-002/SC-005          | T065–T068                                                                    |

## Implementation Strategy

### MVP First — User Story 1

Hoàn tất Setup/Foundation rồi US1 T021–T026 để bàn giao danh sách staff đúng supplier; kiểm US1 độc lập với fixture có sẵn. Đây là mốc tăng dần, vẫn cần bốn chức năng còn lại và SC-007 toàn hệ thống trước khi kết luận feature hoàn tất. Foundation chứa global email-only vì mọi phiên dùng chung auth; không coi migration đã verified trước khi kiểm disposable local được phép. Không tự deploy tại checkpoint MVP.

### Incremental Delivery

Sau MVP, lần lượt detail → create + SC-007/email login mọi role → status → permissions. Mỗi story kiểm với fixture độc lập; chạy quality gates trên trạng thái ổn định, tái dùng kết quả còn hợp lệ. Hướng dẫn mọi client dùng email trước hoặc cùng đợt kiểm soát với migration, rồi mới tạo username trùng; không tự apply member/Azure hoặc publish trong task docs/validation.

### Notes

- Bản này thay 60 task trước; chỉ đánh dấu task sau khi có implementation/bằng chứng tương ứng.
- Username vẫn là dữ liệu create/DTO, giữ scoped uniqueness đã chốt; email là credential duy nhất cho mọi role, không fallback username hoặc ambiguity policy.
- Chưa có hook before_tasks/after_tasks tại thời điểm sinh: không tồn tại .specify/extensions.yml.
- Đã analyze trước implementation; kết quả runtime và quality local được ghi tại quickstart.md. Spec gate không thay review nội dung hoặc nghiệm thu SC-006.

**Task totals**: 68; Setup 3, Foundational 17, US1 6, US2 6, US3 8, US4 7, US5 8, Polish 9, CI follow-up 4. **Parallel markers**: 22 task [P].

## CI follow-up — serialization tại actor lookup

- [x] T065 Viết regression ở `tests/supplier-staff-management.test.ts` cho lỗi serialization từ actor repository thật trước khóa và trong recheck: retry toàn transaction, hash chỉ một lần, tối đa ba attempts rồi503 an toàn; business403 không retry. Xác nhận test thất bại đúng vì lỗi bị đổi thành503 sớm.

- [x] T066 Sửa riêng actor lookup trong `src/modules/supplier-staff/supplier-staff.repository.ts` để query identitySelect bằng tx đang dùng rồi principalFromIdentity; bảo toàn lỗi query cho authorizationTransaction, giữ kiểm role/status/membership/permissions, không sửa global helper hoặc tăng retry limit.

- [x] T067 Thêm regression PostgreSQL serialization thật trong `tests/authorization.integration.test.ts`, kiểm tạo staff retry đúng một tài khoản/đúng supplier; chạy quality/build/unit cùng local authorization/lifecycle trên disposable đã chọn và ghi bằng chứng, giới hạn xác nhận CI tại `specs/supplier-staff-management/quickstart.md`.

- [x] T068 Bổ sung regression direct DriverAdapterError lúc commit, retry có nhường event loop và bounded backoff ở `tests/authorization.test.ts`; sửa `src/utils/authorization.ts` để nhận diện direct adapter serialization/deadlock và chờ20ms/40ms giữa các retries, tối đa ba attempts, không delay/retry business403. Bỏ toàn bộ diagnostic tạm, giữ regression PostgreSQL có barrier tại duplicate precheck trong `tests/authorization.integration.test.ts` để CI tái hiện race ổn định.
