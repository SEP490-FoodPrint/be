# Implementation Plan: Quản lí nhân viên nhà cung cấp nguyên liệu

**Branch**: `feat/supplier-staff-management` (tạo từ `dev`) | **Created**: 2026-11-16 | **Updated**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Spec mới nhất: username nhân viên duy nhất trong supplier, email duy nhất toàn hệ thống; tất cả vai trò SYSTEM/SCHOOL/SUPPLIER/AUTHORITY chỉ đăng nhập bằng email + mật khẩu, không lookup/fallback username hoặc chọn tổ chức.

**Trạng thái tài liệu**: Plan và artifacts Phase 0/1 đã cập nhật theo quyết định email-only toàn hệ thống ngày 2026-11-17. 64 task ban đầu cùng4 task sửa CI đã triển khai email-only mọi vai trò, normalization/recheck, SC-007 và runner onboarding. Kết quả local/runtime nằm trong quickstart.md; SC-006 chờ nghiệm thu qua ứng dụng, chưa deploy member/Azure.

## Summary

Giữ đủ năm nghiệp vụ và bảy API trong module supplier-staff: danh sách, chi tiết, tạo, khóa/mở khóa, xem/bật/tắt quyền. Mọi thao tác yêu cầu INGREDIENT_SUPPLIER_ADMIN + supplier_staff.manage, chỉ target staff trong supplier tin cậy.

Bổ sung migration mới để bỏ uniqueness username toàn cục, giữ hai ràng buộc dữ liệu username non-staff và (supplier, username) như đã chốt; email vẫn unique toàn cục. Thay tra cứu OR username/email bằng một unique-email lookup cho tất cả vai trò; bỏ take:2/ambiguity và mọi ngoại lệ username-login. Giữ các field/DTO username phục vụ quản lí, không thêm model, role/permission, seed, dependency, JWT claim hoặc endpoint đăng nhập riêng.

Plan cũ kết luận không cần migration và không cần sửa auth không còn áp dụng. Backend và SQL versioned đã triển khai theo thiết kế; migration chỉ được kiểm chứng trên disposable local, không áp lên database vận hành.

## Technical Context

**Language/Version**: TypeScript strict 6.0.3, Node.js 24.22.1 theo .nvmrc, CommonJS/Node16; relative imports extensionless.

**Primary Dependencies**: Express 4.21.x, Prisma Client/CLI 7.10.1 + adapter-pg, PostgreSQL, Zod 4.6.7, bcryptjs 3.x; giữ lock/dependency hiện có.

**Storage**: User/Supplier/Role/Permission/RolePermission/UserPermissionDenial có sẵn; thay constraint username bằng hai partial indexes trong migration mới, giữ email Citext. Redis chỉ phiên/rate limit, không cache quyền hoặc dữ liệu feature.

**Testing**: Node test runner qua tsx, unit/HTTP DI; migration fresh/upgrade/catalog, authorization và lifecycle trên disposable local thuộc instance đã chọn và được phép ghi. Mở rộng nhóm migrations/authorization/lifecycle có sẵn, không framework hoặc container PostgreSQL mới.

**Target Platform**: Backend Node.js trên Linux, PostgreSQL local để phát triển/test, Azure deployment theo workflow đã duyệt.

**Project Type**: Web service REST, không xây UI.

**Performance Goals**: List mặc định 20/tối đa 100, query limit+1, không count/load toàn bộ staff. Login dùng một unique email lookup và một password comparison hoặc dummy comparison; không quét các account trùng username. SC-006 là nghiệm thu qua ứng dụng, không phải SLA API đã đo.

**Constraints**: Migration mới bất biến sau apply, không sửa baseline/manifest/checksum cũ, không trigger/function/backfill hoặc tự đổi dữ liệu. Source phải đúng phân lớp/DTO; mọi write recheck trong cùng Serializable tx. Không đổi cookie/JWT/refresh/recovery contract, không SYSTEM bypass, không xóa Redis wildcard.

**Scale/Scope**: Giữ năm luồng quản lí staff/bảy API và bổ sung email-only login cho mọi vai trò, gồm tài khoản đang dùng username. Migration/schema và duplicate prechecks hỗ trợ FR-008; auth validation/lookup/service, fixture/client documentation hỗ trợ FR-009/SC-007. Không sửa hồ sơ/role, xóa staff, admin reset password, search nâng cao hoặc nới username uniqueness ngoài quyết định hiện hành.

## Constitution Check

Đối chiếu cả trước nghiên cứu và sau thiết kế; không có ngoại lệ cần miễn trừ.

| Nguyên tắc                        | Trước Phase 0                                                   | Sau Phase 1                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I — Phân lớp                      | PASS: giữ module chuẩn và DTO tách biệt                         | PASS: service không query, repository không DTO; auth lookup và school duplicate predicate sửa tại repository, không thêm truy vấn vào service cũ      |
| II — Phân quyền/cô lập            | PASS: staff scope từ principal, auth toàn hệ thống đã được chốt | PASS: scope/WHERE/recheck không đổi; login chỉ email mọi role, tổ chức/quyền lấy từ DB theo userId, không lookup username hoặc dùng org do client chọn |
| III — An toàn DB                  | PASS: chỉ lập thiết kế migration                                | PASS: migration mới, chỉ thay username constraint; email/admin/officer/FK/CHECK và migration đã apply giữ nguyên, không chạy DB tại bước plan          |
| IV — Transaction/cache/rate limit | PASS: dùng hạ tầng chung                                        | PASS: Supplier → User → Role locks, cùng Serializable tx, touchUser/touchRole, không cache hoặc flush                                                  |
| V — HTTP/output                   | PASS: giữ envelopes/allowlist và tên trường login               | PASS: body vẫn identifier/password nhưng identifier chỉ có nghĩa email; thông báo credential rõ email, status/onboarding/cookie/CSRF/refresh không đổi |
| VI — Spec-driven                  | PASS: quyết định toàn hệ thống đã ghi vào spec                  | PASS thiết kế: không còn điểm chưa rõ; đã analyze global email-only/SC-007 trước code; nhánh đúng từ dev, kết quả runtime tại quickstart               |

Đây là kiểm tra thiết kế, không phải kết quả CI/spec gate hoặc cho phép deploy. Không thay hiến chương để hợp thức hóa ngoại lệ. Partial index mới là thay đổi cấu trúc có chủ đích theo yêu cầu username scoped, không sửa predicate của các index đã có khác.

## Project Structure

### Documentation (this feature)

```text
specs/supplier-staff-management/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/supplier-staff-api.md
├── contracts/auth-login.md
└── tasks.md (68 task gồm4 task sửa CI)
```

### Source Code (repository root)

```text
src/modules/supplier-staff/
  supplier-staff.routes.ts
  supplier-staff.controller.ts
  supplier-staff.validation.ts
  supplier-staff.request.dto.ts
  supplier-staff.response.dto.ts
  supplier-staff.service.ts
  supplier-staff.repository.ts
src/modules/auth/session.validation.ts
src/modules/auth/session.repository.ts
src/modules/auth/session.service.ts
src/modules/user/user.repository.ts
src/routes/index.ts
src/utils/resource-access.ts
src/modules/README.md
prisma/schema.prisma
prisma/migrations/ (một migration mới supplier_staff_username_scope)
database/SCHEMA_BASELINE.md
docs/AUTHORIZATION.md
docs/AUTH_SESSIONS.md
tests/supplier-staff-management.test.ts
tests/auth-session.test.ts
tests/password.test.ts
tests/authorization.test.ts
tests/authorization.integration.test.ts
tests/account-lifecycle.integration.test.ts
tests/supplier-onboarding.integration.test.ts
tests/helpers/run-local-tests.ts
tests/local-test-database.test.ts
tests/migrations.test.ts
package.json
```

**Structure Decision**: Module mới chịu trách nhiệm API staff; session service/repository hiện có sở hữu login. School repository chỉ sửa predicate kiểm trùng username để thống nhất namespace, giữ contract/validation/password policy trường. Signup dựa non-staff unique và P2002 hiện có, không refactor rộng hoặc thêm queries vào signup service. Audit tests/helpers login và unique-input usages sau generate; sửa theo id/email thay vì username unique.

## Phase 0 — Research

Hoàn tất tại [research.md](research.md) R1–R8 theo quyết định mới. users_username_key là UNIQUE constraint baseline cần thay bằng migration versioned. Session query chỉ dùng unique email, password recovery đã email-based nên không đổi interface. Rà toàn bộ role, auth mocks/helpers và suite supplier-onboarding; không chạy runtime/DB trong bước nghiên cứu.

## Phase 1 — Design

### 1. Mô hình định danh và migration

- Giữ User.id là danh tính, unique email toàn cục không phân biệt hoa/thường. Username varchar giữ cách so sánh case-sensitive hiện hành.
- Bỏ @@unique([username]) toàn cục. Thêm uq_users_non_staff_username trên username, predicate role_code khác INGREDIENT_SUPPLIER_STAFF; thêm uq_users_supplier_username trên (supplier_id, username), predicate supplier_id IS NOT NULL. Index supplier gồm cả admin/staff ở mọi status, không chỉ ACTIVE.
- Staff cùng supplier không được trùng staff/admin cùng supplier; staff khác supplier hoặc non-staff ngoài supplier có thể cùng username. Username non-staff vẫn unique với nhau, gồm account chưa có tổ chức. Đây là ràng buộc dữ liệu đã chốt, độc lập với login chỉ bằng email; không nới uniqueness vì username không còn là credential.
- Migration mới có transaction và timeout, tạo hai index mới trước khi drop users_username_key, không rename/backfill/xóa User. Prisma partialIndexes phản ánh đúng map/predicate chuẩn hóa. Không dùng username hoặc partial composite làm unique selector; dùng id/email hoặc findFirst có scope.
- Upgrade giữ nguyên IDs, username/email, hash, role/membership, status/timestamp, history và denials. Catalog tests kiểm email unique, composite FK/CHECK và admin/officer partial indexes không đổi. Không sửa baseline manifest hay SQL applied.
- School duplicate check chuyển thành email toàn cục OR username của non-staff. Staff create check là email toàn cục OR (trusted supplier + username), bắt cả admin cùng supplier; DB constraints là chốt cuối khi có race. Giữ các status không ACTIVE vẫn chiếm tên/email.

### 2. Scope, layers và reads

Thêm SupplierStaffManagementScope và resource supplier-staff tại resource-access, chỉ admin SUPPLIER hợp lệ + supplier_staff.manage; không làm hẹp listScopes.user cũ. ACTIVE qua principal loader; metadata từ request không xác lập quyền.

Controller gọi strict validators, requirePrincipal, service và sendSuccess, không DTO. Zod strictObject/safeParse là nguồn Request DTO z.infer, lỗi nhiều trường bằng tiếng Việt không raw values. Repository có internal input types, không DTO; service dùng Request/Response DTO và map allowlist, không where/select/include/SQL.

List page/limit default 1/20 max 100, createdAt desc/id asc, limit+1, hasNext không total. Detail đọc mọi status, không gọi principalFromIdentity cho target LOCKED. Target id/supplier/staff role/type phải nằm trong repository WHERE. Permission detail chỉ target ACTIVE và đọc target/grants/flags/denials trong cùng RepeatableRead read transaction/snapshot qua hạ tầng sẵn có. Không cache.

### 3. Write và cạnh tranh

1. Xác lập original scope từ principal, bcrypt cost 12 trước transaction nếu create.
2. Một authorizationTransaction Serializable cho toàn request. Metadata xác định locks chưa phải kết luận phân quyền.
3. Khóa Supplier → User actor/target ID tăng dần → Role IDs tăng dần FOR SHARE; reuse protocol lockParents phù hợp. Repository khóa target có supplier/role ownership filter, không khóa ngoài scope.
4. Sau lock, nạp lại actor/quyền/membership và target cùng tx; so sánh scope/role metadata ban đầu. Thay role/membership không làm thao tác tự chuyển scope; từ chối hoặc retry toàn giao dịch.
5. Create kiểm staff role SUPPLIER, ghi roleId/roleCode đúng FK, User ACTIVE thuộc supplier, emailVerifiedAt null, không registration/grants/denials. Map unique username trong supplier hoặc email toàn cục thành lỗi 409 chung trước wrapper DB. Username trùng chỉ ở supplier khác không phải lỗi.
6. Status chỉ ACTIVE ↔ LOCKED; same-state không write/đổi updatedAt, status khác 409. Không đổi intakeState/công việc/denial/role/membership.
7. Toggle target ACTIVE + active role grant; scoped createMany skipDuplicates/deleteMany; touchUser cùng tx chỉ khi count > 0. Đọc lại permission state để map DTO, không sửa RolePermission.
8. Trả DTO sau commit, retry serialization theo helper hiện có tối đa ba lần rồi 503 an toàn; không nested tx/raw Prisma lỗi.

Cùng parent lock với lifecycle để create/unlock không sống sót sau cascade. Actor User/Role locks kết hợp touchUser/touchRole bảo vệ quyền vừa bị thu hồi. Hai supplier khác nhau không cần khóa chung vì username được phép trùng; email unique DB chặn race email giữa supplier. Integration barrier phải chứng minh, không thay bằng sleep hoặc unit giả lập.

### 4. Email-only login cho toàn hệ thống

Giữ POST /api/auth/login và strict identifier/password; mọi vai trò gửi email trong identifier, không orgId/role/mã/link. session.validation giữ requiredText(320), trim/lowercase, password nguyên văn 1–72 byte. Không thêm kiểm định dạng email làm đổi lỗi: thiếu/rỗng/quá dài/trường lạ 400; chuỗi username/non-email không rỗng hoặc email không có account đi qua lookup email và nhận 401 chung “Email hoặc mật khẩu không đúng”.

session.repository thay findCandidates bằng operation findByEmail qua findUnique email Citext, trả candidate hoặc null; xóa OR username, role-specific filter, take:2 và nhánh nhiều candidate. Service không dựng query; chỉ một candidate được so password, không có thì so dummy hash, không fallback username ở bất kỳ role nào. Email A trùng username B vẫn chỉ xét A; nếu password B không khớp password A thì phải 401, không thử sang B. Nếu chuỗi username cũng là email hợp lệ của account khác, nó được hiểu duy nhất theo nghĩa email.

Sau bước so password, khóa User theo id rồi repository đọc lại cùng id + email (so sánh Citext trong DB) trong transaction. Nếu email đã đổi, đọc lại không khớp hoặc hash đổi thì 401 trước cấp phiên; không dùng JS lowercase comparison để thay DB matching. loadSessionUser vẫn nạp role/membership/status hiện tại: ACTIVE theo quyền hiện hành, UNVERIFIED admin chỉ onboarding khi đã xác minh email, LOCKED/INACTIVE/DEACTIVATED không được login/refresh. Role đổi giữa lookup và lock vẫn được kiểm theo trạng thái/quyền hiện hành, không còn nhánh chọn email-policy theo role.

Giữ JWT sub/sid, cookie/CSRF/refresh/logout, permission loading và recovery email unique/userId/fingerprint. Không thêm email verification cho staff ACTIVE, không tự tạo registration hoặc quét/revoke toàn bộ Redis. Supplier intake tạm dừng không tự cấm quản lí staff. Username ở create/DTO và quy tắc dữ liệu giữ nguyên, chỉ bỏ vai trò credential.

Rà toàn bộ positive login fixtures/mock của các role tại auth-session, authorization.integration, account-lifecycle.integration và supplier-onboarding.integration. Mocks phân biệt email lookup, locked reread và full identity query; username tests chỉ giữ ở tạo/hiển thị/uniqueness hoặc làm negative login. Tránh đổi mục đích test status/onboarding thành kiểm credential-sai.

Suite supplier-onboarding dùng CREATE DATABASE riêng và chưa đăng ký manifest; để kiểm hồi quy bằng cùng instance/policy, đưa file vào nhóm authorization hiện có trong tests/helpers/run-local-tests.ts, chạy từng file ở child process riêng tuần tự. Sau CREATE thành công mới gọi recordLocalTestDatabase với tên chính xác; wrapper cleanup theo manifest/owner cũ, không scan prefix hoặc xóa DB không ghi nhận. Bổ sung kiểm group dispatch/cleanup vào tests/local-test-database.test.ts nếu đổi runner; không chạy standalone suite ngoài policy hoặc thêm group/container mới.

I1 được giải quyết bằng quy tắc chọn danh tính mới: không còn OR giữa email và username, không giữ ngoại lệ ambiguity 401 cho cross-field collision. Cần unit/integration chứng minh trước khi kết luận implementation đã khắc phục.

### 5. Verification, rollout và tài liệu

- Unit/HTTP feature: scope/role/permission, pagination, safe projections, strict/multiple validation, status/no-op, denial/idempotency, fault injection và tx propagation. Thêm file mới vào test:unit.
- Auth unit: email-only cho từng role; normalize email, unknown email/username 401, dummy bcrypt, email A trùng username B chỉ chọn A; fixture dùng password khác nhau để chứng minh password chỉ đúng với B không mở A. Lookup email/hash đổi giữa candidate read/User lock bị recheck. Không giữ positive username-login, take:2 hoặc ambiguity-401 test cũ; giữ username tests ở create/DTO/uniqueness.
- Migration tests: fresh/replay và upgrade có dữ liệu, đúng predicates/constraints, không sửa tài khoản/hash/history; cross-supplier shared username pass, same-supplier staff/admin collision fail, non-staff duplicates fail, global email duplicates fail ở mọi status. Audit test findUnique username đổi sang id/email, verify schema/client không drift.
- Authorization integration: kiểm SC-007 theo từng role với email login/username negative, cross-field collision và status/onboarding; create hai supplier cùng username/email khác cùng thành công và email login đúng từng principal; trong supplier duplicate username một success; cross-supplier duplicate email một success; same-supplier admin collision 409. Role/denial revocation race, old session locks, targeted email recovery, generic/school/signup regressions.
- Integration mọi role: sửa positive login helper/body trong authorization, lifecycle và supplier-onboarding suites sang email; giữ đúng expected 403 do status/onboarding thay vì 401 do username lookup. Chạy local groups migrations/authorization/lifecycle khi tác vụ cho phép ghi, không container/group mới; tích hợp supplier-onboarding vào nhóm authorization như mục 4.
- Rollout: cập nhật tài liệu/client hướng dẫn tất cả vai trò dùng email đã có, triển khai code email-only trước hoặc cùng đợt kiểm soát với migration rồi mới cho tạo username trùng. Không fallback username tạm thời; không tự đổi username/email/password hoặc tổ chức, không revoke toàn bộ phiên. Khi đã có duplicates, không rollback code cũ hoặc tự gộp/đổi tên account. Áp migration vận hành vẫn cần đúng authorization/workflow.
- Docs: AUTHORIZATION, AUTH_SESSIONS, modules/README và SCHEMA_BASELINE ghi thay đổi mục tiêu và trạng thái kiểm chứng/deploy thực tế. Hợp đồng [staff](contracts/supplier-staff-api.md), [login](contracts/auth-login.md), [data model](data-model.md), [quickstart](quickstart.md).

### 6. Trình tự triển khai theo tasks

Bộ 64 tasks tại [tasks.md](tasks.md) đã cập nhật global email-only: T010/T013–T015 triển khai regression, normalization, unique-email lookup và email/hash recheck; T017–T020 cập nhật fixtures mọi role, runner onboarding và unit verification; T035/T040 kiểm SC-007/I1 bằng integration. Migration/username rules giữ nguyên; checkbox và kết quả kiểm chứng thực tế được theo dõi tại tasks/quickstart.

### 7. Requirement traceability

| Yêu cầu        | Thiết kế                                                         | Bằng chứng cần có                                                                                                                        |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–002     | Dedicated staff scope, trusted supplier                          | Role matrix, tenant isolation, actor recheck                                                                                             |
| FR-003–005     | Paginated list/detail allowlist                                  | Boundary/empty/status/404 và safe serialization                                                                                          |
| FR-006–007     | Strict create, bcrypt, trusted role/membership                   | Validation nhiều lỗi, ACTIVE đúng supplier/role                                                                                          |
| FR-008         | Partial usernames + global email + precheck namespaces           | Migration fresh/upgrade, same/different supplier races                                                                                   |
| FR-009, SC-007 | Unique-email lookup cho mọi vai trò, email/hash recheck sau lock | Mỗi role email login, username không fallback, email trùng username chọn đúng chủ email, statuses/onboarding/session/recovery giữ nguyên |
| FR-010–012     | ACTIVE ↔ LOCKED no-op + auth status                              | Old session/refresh/login và giữ denial/history                                                                                          |
| FR-013–016     | Active grants trừ scoped denials                                 | Idempotency, quyền role thay đổi, target ACTIVE                                                                                          |
| FR-017–018     | Shared Serializable/lock/MVCC                                    | Rollback, revocation/cascade barrier, unique race                                                                                        |
| FR-019         | Shared envelope/errors, safe DTO                                 | 400/401/403/404/409/503 đúng, không raw input/secret                                                                                     |

## Complexity Tracking

Không có vi phạm hiến chương cần ngoại lệ. Hai partial indexes giữ ràng buộc dữ liệu username đã chốt; email là credential duy nhất, không cần namespace username cho login. Tích hợp thêm suite hiện có vào nhóm local authorization chỉ phục vụ hồi quy global auth và cleanup đúng manifest. Không thêm model/mapper/framework/trigger; runtime/migration checks local đã chạy theo quickstart; PR CI và deploy vận hành chưa thực hiện.

## CI fix — bảo toàn lỗi transaction tại actor lookup

CI báo một trong hai create độc lập khác supplier trả503 thay vì201. Rà đường đi lỗi actor repository → loadPrincipal → databaseOperation cho thấy helper có thể đổi lỗi serialization thành HttpError503 trước authorizationTransaction, làm mất mã dùng nhận biết retry. Cần regression sử dụng actor repository thật, gồm lỗi trước khóa và lúc recheck; xác minh thêm bằng lỗi PostgreSQL serialization thật trong disposable integration.

Giới hạn bản sửa: supplier-staff.repository đọc identitySelect trong chính tx và dùng principalFromIdentity để giữ toàn bộ kiểm tra phân quyền, đồng thời để lỗi truy vấn tới runner. Giữ tối đa ba attempts và scope/role/uniqueness/response. Trace PostgreSQL xác nhận P2034/40001 ở createStaff bị retry liên tiếp quá nhanh cả ba lần khi giao dịch cạnh tranh chưa kịp kết thúc; bổ sung chờ có giới hạn 20ms rồi40ms trong authorizationTransaction trước retry, không chờ với lỗi business. Không tăng timeout hoặc số attempts. Kiểm thêm hai create đồng thời khác supplier, rollback/retry và business403; quality gate và các nhóm authorization/lifecycle chạy lại sau sửa. Không đổi schema/migration hoặc dữ liệu vận hành.

Trace pg.Client ghi nhận hai create cùng hoàn tất callback nhưng một COMMIT bị PostgreSQL40001 (pivot during commit attempt). Prisma adapter có thể trả DriverAdapterError trực tiếp với cause.kind=TransactionWriteConflict, không nằm trong meta như lỗi truy vấn; classifier hiện tại bỏ sót nên trả503 mà không retry. Mở rộng classifier chỉ cho direct adapter serialization/deadlock, giữ các lỗi adapter khác không retry. Regression phải gồm lỗi phát sinh sau callback/tại commit và barrier buộc hai snapshot create chồng nhau.
