# Quickstart: Kiểm chứng quản lí nhân viên nhà cung cấp

**Updated**: 2026-11-17, sau quyết định mọi vai trò chỉ đăng nhập bằng email + mật khẩu. Username scoped supplier và email unique toàn cục giữ như spec. Backend đã triển khai và kiểm chứng local theo 64 tasks. Nhật ký bên dưới phân biệt kết quả thật, deployment chưa thực hiện và SC-006 chờ nghiệm thu qua ứng dụng.

## Điều kiện

- Node.js 24.22.1 theo .nvmrc, npm 11; npm ci khi thiếu dependency. Không thêm framework, hand-edit/commit generated Prisma hoặc dist.
- Nhánh feat/supplier-staff-management đã tạo từ dev trước code; .specify/feature.json chỉ local. Bộ tài liệu đã analyze trước implementation; thay đổi yêu cầu tiếp theo phải đồng bộ spec/plan/tasks rồi analyze lại.
- Unit tests không cần hạ tầng. Migration/authorization/lifecycle cần instance PostgreSQL local được chọn trong .env.test.local và tác vụ cho phép tạo/ghi/dọn database disposable của chính lần chạy; Redis local dùng prefix test riêng. Credential không tự là quyền ghi, không dùng Azure/control/member DB làm DB test.
- Feature cần migration supplier_staff_username_scope mới: sau khi implementation được phép tạo migration, thêm version nối sau migration mới nhất, không sửa baseline/checksum cũ. Test wrapper replay migration chỉ vào disposable DB được phép. Không tự apply lên database member/Azure, db push, reset, introspection, bootstrap, seed hoặc đổi dữ liệu vận hành để thử.
- Dùng ba nhóm local migrations/authorization/lifecycle có sẵn, mở rộng nhóm authorization để chạy cả supplier-onboarding suite trong child process riêng tuần tự. Suite này phải đăng ký đúng tên DB sau CREATE thành công vào manifest invocation trước khi đưa vào runner; không chạy script standalone ngoài cleanup policy. Không container/group mới, xóa volume/flush Redis hoặc dọn theo prefix.

## Kiểm tra không cần hạ tầng

Sau khi code/migration/schema và tests đã được viết:

```bash
npm run prisma:validate
npm run validate
npm run test:unit
```

validate đã gồm typecheck/build/generate; không lặp lại các bộ đã pass nếu không có thay đổi/failure mới. Khi cần chạy riêng trước quality gate đầy đủ:

```bash
node --import tsx --test tests/supplier-staff-management.test.ts tests/auth-session.test.ts tests/password.test.ts
```

Kỳ vọng: generated types không còn unique selector username; các lookup trong tests/code dùng id/email hoặc scoped findFirst hợp lệ. Unit/HTTP kiểm scope/projection/validation/status/denial/tx; auth tests chứng minh mọi role email-only, unique-email lookup và email/hash recheck sau User lock; status/onboarding/quyền/phiên không đổi. Không coi mock tests là bằng chứng migration hoặc race thật.

## Kiểm chứng migration, DB và phiên thật

Chỉ khi instance local và tác vụ đã cho phép các ghi disposable:

```bash
npm run test:local:check
docker compose up -d --no-recreate --wait redis
npm run redis:check
npm run test:local:migrations
npm run test:local:authorization
npm run test:local:lifecycle
```

Runner dùng local đã chọn, ghi nhận CREATE thành công rồi chỉ cleanup tên của invocation đó. Fixture và migration replay chỉ vào database disposable; không reset control/member DB hoặc chạy migration deploy lên môi trường vận hành. Nếu thiếu điều kiện, ghi blocked prerequisite, không đổi sang instance khác hoặc báo pass.

## Ma trận nghiệm thu

Fixture disposable gồm supplier A/B với admin và staff mọi AccountStatus; non-staff SCHOOL/SYSTEM/AUTHORITY; grants active/inactive và scoped denials. Mọi helper/positive login fixture dùng email, gồm SYSTEM/SCHOOL/SUPPLIER/AUTHORITY; username-login chuyển thành negative tests cho mọi role. Username coverage vẫn giữ ở create/uniqueness/DTO. Ma trận SC-007 phải xét từng mã role trong ROLES, không chỉ một tài khoản đại diện orgType.

| Bước | Thao tác                                                             | Kết quả phải chứng minh                                                                                                                                                            |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Migration fresh + upgrade có sẵn account/history                     | Hai partial indexes đúng predicates, global username constraint bỏ; email/admin/officer unique, role FK/CHECK giữ nguyên; IDs/hash/role/status/timestamps/history không đổi        |
| 2    | Ghi trực tiếp qua harness sau migration                              | Username staff khác supplier trùng được; cùng supplier staff/staff hoặc staff/admin trùng bị DB chặn; hai non-staff trùng bị chặn; mọi role/org trùng email bị chặn kể cả inactive |
| 3    | Admin A GET list/detail                                              | Chỉ staff A, mọi status, pagination/hasNext/thứ tự đúng, UUID B/admin/không tồn tại cùng 404; không secret                                                                         |
| 4    | POST create hợp lệ rồi email login                                   | 201, ACTIVE đúng role/supplier, không registration/denial; login email đúng userId/supplier dù username trùng staff B                                                              |
| 5    | Hai supplier cùng tạo username, email khác chưa dùng                 | Cả hai thành công, hai account riêng; status/permission của A không tác động B                                                                                                     |
| 6    | Hai create cùng supplier/cùng username; same-supplier admin username | Một success cho race, còn lại 409; tên admin cùng supplier cũng 409; không account một phần                                                                                        |
| 7    | Hai supplier cùng tạo email, gồm khác hoa/thường                     | Tối đa một success, còn lại 409; email của inactive/role khác vẫn giữ chỗ, không tiết lộ tổ chức ngoài scope                                                                       |
| 8    | Từng role dùng username duy nhất/trùng không khớp email nào          | 401 chung, không cấp phiên và không fallback username ở bất kỳ role nào                                                                                                            |
| 9    | Email mỗi role có mixed-case/khoảng trắng ngoài, password đúng       | Đúng chủ email/role/org, password giữ nguyên văn; quyền và status theo policy hiện có                                                                                              |
| 10   | Email A trùng username B, fixture password A/B khác nhau             | Chỉ A được xét: password A thành công, password chỉ đúng với B nhận 401; không chọn B hoặc lỗi nhiều account vì username                                                           |
| 11   | Email/hash thay đổi giữa lookup và User lock                         | Recheck id + email tại DB và hash từ chối thông tin cũ, không cấp phiên từ email/hash đã đổi                                                                                       |
| 12   | Staff có phiên sống, admin khóa rồi mở lại                           | Login/refresh/nghiệp vụ sau khóa bị chặn; login email mới sau unlock được; denial/history không đổi, same-state không đổi updatedAt                                                |
| 13   | PATCH từ UNVERIFIED/INACTIVE/DEACTIVATED                             | 409; không kích hoạt lại qua unlock                                                                                                                                                |
| 14   | GET permissions, PUT/DELETE lặp và dùng phiên staff cũ               | enabled đúng grants/denial, request kế tiếp phản ánh quyền, không duplicate denial/touchUser thừa hoặc ảnh hưởng staff khác                                                        |
| 15   | Quyền ngoài role/inactive/không có; target LOCKED/ngoài supplier     | 400/403/404 theo contract, không nâng quyền hoặc lộ dữ liệu                                                                                                                        |
| 16   | Actor bị revoke bằng denial hoặc role grants lúc write               | Request dùng quyền cũ bị từ chối/retry; không write trái phép                                                                                                                      |
| 17   | Create/unlock vs cascade DEACTIVATED, cả hai thứ tự barrier          | Không còn staff ACTIVE sau cascade; rollback khi lỗi, không partial write                                                                                                          |
| 18   | Recovery email A khi B trùng username                                | Chỉ mật khẩu/phiên user A bị tác động theo auth policy; B không đổi                                                                                                                |
| 19   | Signup/school CRUD/generic permission và auth mọi role hồi quy       | Giữ create/DTO/role/default password/uniqueness; mọi role dùng email login, đúng status/onboarding/session, không còn positive username-login                                      |
| 20   | Supplier intake tạm dừng, actor vẫn ACTIVE/đủ quyền                  | Quản lí staff vẫn dùng được; không tự gỡ intake hoặc đổi công việc                                                                                                                 |

Bổ sung SC-007 với ACTIVE hợp lệ, UNVERIFIED admin đã/chưa xác minh, staff UNVERIFIED và LOCKED/INACTIVE/DEACTIVATED. Credential đúng phải đến đúng bước status (ví dụ 403 khi bị khóa), không vô tình đổi mục đích test thành 401 vì gửi username. Credential sai/unknown email/chuỗi username nonempty đều cùng 401; missing/empty/oversize/extra field vẫn 400. Kiểm fake Prisma phân biệt lookup email, locked reread và full identity query.

Các test concurrency dùng barrier rõ thời điểm, không dựa vào sleep may rủi. Thử body thiếu/sai/trường lạ phải thu nhiều lỗi tiếng Việt không raw values, giữ strict login chỉ identifier/password. Kiểm rollback, retry giới hạn và lỗi hạ tầng 503 an toàn; không suy luận thành đã chạy từ việc có kịch bản.

## Chạy HTTP local riêng

Khi code đã có và dữ liệu local test được phép dùng, npm run dev khởi động app theo .env untracked. Mọi vai trò gửi email trong identifier đến /api/auth/login như [login contract](contracts/auth-login.md); không có đường username-login hoặc chọn tổ chức. Dùng cookie/CSRF như docs/AUTH_SESSIONS.md, không in token hoặc credential vào báo cáo.

Ví dụ GET chỉ đọc, cookie jar được chuẩn bị riêng sau login admin:

```bash
curl --silent --show-error --cookie /tmp/foodprint-supplier-admin.cookies 'http://localhost:3000/api/supplier-staff?page=1&limit=20'
```

Thay port theo cấu hình local. Staff mutation theo [staff contract](contracts/supplier-staff-api.md); schema/migration invariants theo [data model](data-model.md). Không chạy request write vào dữ liệu vận hành chỉ để nghiệm thu.

## Rollout và báo cáo

Rollout cần hướng dẫn/client mọi role chuyển sang email đã có, triển khai code chỉ lookup email trước hoặc cùng đợt kiểm soát với migration, rồi mới bật tạo tên trùng. Không mở fallback username; không tự đổi tên/email/password hoặc gộp account. Session còn sống tiếp tục gắn userId theo TTL/policy cũ. Không rollback về code yêu cầu global username sau khi đã có duplicates, không tự đổi tên/gộp/reset account. Đăng kí trạng thái migration/deploy thực tế trong SCHEMA_BASELINE.md; thay đổi này không tự cho phép áp lên Azure.

Sau cập nhật tasks, chạy npm run spec:check với base/head refs đúng contribute.md mục 8.5 trên feature branch. Ghi lệnh thực chạy/pass/fail/blocked; SC-001–SC-005 và SC-007 cần bằng chứng unit/integration/migration tương ứng. SC-007 phải có bảng role → email success/username negative/status/onboarding/cross-field collision; I1 chỉ được coi đã kiểm chứng khi test mới pass. SC-006 đo thao tác qua ứng dụng với quản trị viên, không coi backend tests là đã đạt tỉ lệ/thời gian.

### Tích hợp hồi quy supplier-onboarding

Trước khi chạy nhóm authorization cập nhật, kiểm tests/helpers/run-local-tests.ts liệt kê hai suite authorization và supplier-onboarding ở các child process riêng tuần tự; cả hai nhận cùng cấu hình instance/manifest invocation. Suite supplier-onboarding ghi recordLocalTestDatabase chỉ sau CREATE thành công, giữ đóng kết nối và cleanup của wrapper kể cả test fail. Kiểm dispatch/failure propagation theo tests/local-test-database.test.ts khi đổi runner. Không đưa database vận hành/control/member vào manifest hoặc quét tên để dọn.

Nhóm local authorization đã tích hợp hai suite bằng child processes riêng tuần tự. Kết quả thực chạy của cả hai suite nằm trong nhật ký bên dưới; không suy kết quả từ suite chưa được dispatch.

## Nhật ký triển khai và kiểm chứng

- Nhánh `feat/supplier-staff-management` tạo từ `dev`; checklist 16/16 đạt trước code. T001–T017: scope, Zod/DTO, shared transaction wrapper, migration draft và auth email-only đã viết; migration chưa apply lên database vận hành.
- PostgreSQL local đã chọn `127.0.0.1:5433` phiên bản 18.6; `npm run test:local:check` và `npm run redis:check` đạt. Không tạo PostgreSQL container mới.
- T010 baseline: 11 pass / 17 fail đúng policy cũ (username còn login, không normalize, collision ambiguity, email đổi trước lock chưa bị chặn). Sau T013–T015: `node --import tsx --test tests/auth-session.test.ts tests/password.test.ts tests/authorization.test.ts` đạt 77/77, không skipped. Bao phủ 11 mã role, email/hash recheck, trạng thái/onboarding và recovery isolation.
- `npm run prisma:validate` và `npm run prisma:generate` đạt; generation không apply schema. Positive login fixtures của authorization/lifecycle/supplier-onboarding đã chuyển email; school/signup uniqueness dữ liệu vẫn giữ.

- T018–T020: runner authorization đã chạy hai child processes riêng tuần tự; CREATE chỉ ghi manifest sau thành công, cleanup theo tên/owner. Unit runner 7/7 đạt; typecheck sau tích hợp đạt.
- `npm run test:local:migrations` đạt 23/23 trên disposable local, không skipped; runner kiểm/dọn đúng 14 database đã ghi nhận (7 do runner dọn, các DB còn lại harness đã dọn). Fresh/upgrade/catalog/collision/preservation và fault-before-COMMIT rollback đều đạt; không apply trên member/Azure.

- US1: repository/service/controller/router GET /api/supplier-staff đã tích hợp; unit/HTTP 8/8 đạt. Integration tenant-isolation tests đã viết; thực thi DB gom tại T061 trên trạng thái cuối để tránh lặp full suite mỗi story. Ở mốc US1, T026 chờ bằng chứng DB cuối; kết quả hoàn tất nằm trong bảng kiểm chứng cuối.

- US2/US3: detail và create đã tích hợp; unit/HTTP tổng 25/25 đạt. Integration đã có matrix email-only 11 role, collision, status/onboarding, targeted recovery, concurrent scoped/global uniqueness và create/cascade hai thứ tự. Ở mốc US3, T032/T040 chờ kiểm chứng DB; nay đã đạt theo bảng kết quả cuối.

- US4: PATCH status đã tích hợp; unit/HTTP tổng 34/34 đạt. Đã viết barrier create/unlock vs cascade cho cả hai thứ tự và fault-after-status rollback; nhóm lifecycle đang được kiểm trên disposable local. Same-state không ghi/timestamp không đổi; denial/work không bị sửa.

## Kết quả kiểm chứng cuối

| Nhóm                | Lệnh/kịch bản                                                        | Kết quả                              |
| ------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| Schema              | npm run prisma:validate; npm run prisma:generate                     | PASS, không deploy                   |
| Quality             | npm run validate                                                     | PASS: lint, format, typecheck, build |
| Unit toàn repo      | npm run test:unit                                                    | 684/684 PASS, 0 skipped              |
| Module staff        | node --import tsx --test tests/supplier-staff-management.test.ts     | 45/45 PASS                           |
| Migration           | npm run test:local:migrations                                        | 23/23 PASS                           |
| Authorization       | npm run test:local:authorization, child authorization.integration    | 55/55 PASS                           |
| Supplier onboarding | Cùng nhóm authorization, child supplier-onboarding.integration riêng | 8/8 PASS                             |
| Lifecycle           | npm run test:local:lifecycle                                         | 29/29 PASS                           |

Lần authorization đầu phát hiện fixture supplier dùng PAUSED không hợp lệ theo CHECK hiện có và hai test cũ giả định tổng denial toàn DB bằng0. Đã sửa fixture dùng PAUSED_FOR_FOOD_SAFETY_INSPECTION và so số denial với baseline trước thao tác; không nới DB rule hoặc thay hành vi phân quyền. Nhóm chạy lại đạt55/55+8/8, cleanup đúng4 database đã ghi nhận. Lint phát hiện một Promise.reject fixture dùng object; đã dùng Error có metadata tương ứng, giữ kiểm chứng mapping unique.

| Role                             | Email normalized đúng chủ | Username không khớp email | Trạng thái/onboarding                                               | Collision                |
| -------------------------------- | ------------------------- | ------------------------- | ------------------------------------------------------------------- | ------------------------ |
| SYSTEM_ADMIN                     | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Cơ chế chung (1)         |
| SCHOOL_ADMINISTRATION            | PASS                      | 401 PASS                  | UNVERIFIED chưa verify403; đã verify onboarding-only                | Cơ chế chung (1)         |
| SCHOOL_MANAGEMENT_BOARD          | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Cơ chế chung (1)         |
| SCHOOL_NUTRITION_OFFICER         | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Fixture chủ username (1) |
| SCHOOL_KITCHEN_STAFF             | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Cơ chế chung (1)         |
| HOMEROOM_TEACHER                 | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Cơ chế chung (1)         |
| PARENTS_COMMITTEE                | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Cơ chế chung (1)         |
| INGREDIENT_MANAGEMENT_DEPARTMENT | PASS                      | 401 PASS                  | ACTIVE, quyền DB                                                    | Cơ chế chung (1)         |
| INGREDIENT_SUPPLIER_ADMIN        | PASS                      | 401 PASS                  | UNVERIFIED chưa verify403; đã verify onboarding-only                | Cơ chế chung (1)         |
| INGREDIENT_SUPPLIER_STAFF        | PASS                      | 401 PASS                  | UNVERIFIED/LOCKED/INACTIVE/DEACTIVATED403; ACTIVE không thêm verify | Fixture chủ email (1)    |
| COMMUNE_FOOD_SAFETY_OFFICER      | PASS                      | 401 PASS                  | ACTIVE và lifecycle DB                                              | Cơ chế chung (1)         |

(1) Lookup email và email/hash recheck không có nhánh role. Fixture collision cụ thể dùng email supplier staff A = username school staff B, mật khẩu khác nhau: chỉ A được xét, password chỉ đúng B trả401. Đã kiểm cả unit và PostgreSQL integration, cùng recovery không ảnh hưởng B/người trùng username khác supplier. Bảng không tuyên bố đã tạo một cặp collision riêng cho từng role. I1 được kiểm chứng bằng các test mới pass.

SC-001–SC-005 và SC-007 đã có bằng chứng backend ở các nhóm trên. **SC-006 chưa nghiệm thu**: tác vụ backend không xây UI hoặc tuyển quản trị viên để đo tỷ lệ/thời gian; không suy kết quả này từ684 unit tests. Chưa commit/push/deploy lên database thành viên hoặc Azure; migration chỉ replay vào database disposable của tác vụ. Toàn bộ cleanup theo exact invocation manifest, không quét prefix/flush Redis/reset dữ liệu vận hành.

- T062: `npm run spec:check` thực tế trả PASSED cho `feat/supplier-staff-management` với base `dev` và head là snapshot tạm của working tree (gồm source/prisma/spec mới). Dùng Git index riêng trong /tmp; không di chuyển HEAD/branch hoặc staging index của người dùng. Đây là kiểm local cấu trúc, chưa phải CI trên PR đã push.
- Kiểm cuối sau sửa fixture: `npm run validate` PASS toàn bộ; module staff45/45PASS. Review T059 xác nhận controller không DTO, service không Prisma query, repository giữ scope/lock và mọi write recheck cùng transaction; không cache quyền, không fallback username, không generated output trong thay đổi theo dõi.
- T064 đã tổng hợp đủ bằng chứng backend và trạng thái SC-006 chưa nghiệm thu. Tất cả64 task đã được xử lý; không suy việc đóng task ghi báo cáo thành SC-006 đạt hoặc deployment vận hành đã hoàn tất.

## Sửa CI — serialization ở actor lookup và COMMIT

Triệu chứng: hai supplier tạo staff cùng username/email khác đồng thời, một request trả503 thay vì201. Đã tái hiện bằng barrier tại duplicate precheck để hai Serializable snapshots chồng nhau. Trace PostgreSQL xác nhận40001 ở COMMIT (canceled on identification as a pivot); Prisma trả DriverAdapterError trực tiếp, trong khi classifier chỉ nhận lỗi query/metadata nên không retry. Ngoài ra, actor lookup dùng loadPrincipal đổi lỗi query thànhHttpError503 quá sớm.

Bản sửa T065–T068: nhận diện direct adapter TransactionWriteConflict/SQLSTATE40001 hoặc40P01; giữ tối đa3 attempts, chờ20ms/40ms trước retry để nhường event loop. Actor repository đọc identitySelect cùng tx rồi principalFromIdentity để giữ đầy đủ kiểm tra status/role/membership/permissions và bảo toàn lỗi truy vấn. Business403 và adapter failures khác không retry; hết attempts vẫn503 an toàn. Không sửa schema/migration, số attempts, isolation level hoặc DB/transaction timeout.

| Kiểm chứng sau sửa       | Kết quả                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Regression trước sửa     | Actor serialization bị đổi503 sớm; direct adapter COMMIT conflict không retry; retry loop dùng hết3 attempts trước khi nhường event loop |
| Module staff             | 51/51PASS, gồm lỗi trước khóa và recheck, bounded retry/không retry403                                                                   |
| Toàn bộ unit             | npm run test:unit: 694/694PASS, không skipped                                                                                            |
| Authorization PostgreSQL | npm run test:local:authorization: 56/56PASS, gồm lỗi PostgreSQL thật lúc đọc actor và hai create dùng barrier                            |
| Supplier onboarding      | Child process riêng của nhóm authorization: 8/8PASS                                                                                      |
| Lifecycle                | npm run test:local:lifecycle: 29/29PASS                                                                                                  |
| Quality                  | npm run validate PASS (lint, format, typecheck, build)                                                                                   |

Tất cả diagnostic tạm đã bỏ; regression dùng mock timers/barrier và database disposable, không dựa vào sleep may rủi. Không tạo database container mới hoặc đổi dữ liệu vận hành. Đã xử lý68/68 tasks (64 ban đầu +4 sửaCI); SC-006 vẫn chờ nghiệm thu qua ứng dụng. Kết quả trên là local; chưa push hoặc chạy lại GitHub CI từ phiên này.

- Spec gate sau sửaCI: PASSED với working-tree snapshot, base merge-base(origin/dev, HEAD) theo contribute.md; local dev đang cũ nên không dùng làm base. Git HEAD/staging index giữ nguyên.
