# Quickstart validation: role permission management

Hướng dẫn kiểm chứng tính năng đã triển khai theo [plan.md](plan.md). Kết quả chạy thực tế được ghi ở cuối tài liệu. Chi tiết request/response ở [contract](contracts/role-permission-api.md), dữ liệu và bất biến ở [data-model.md](data-model.md).

## Điều kiện

- Node/npm theo .nvmrc/package.json, dependencies cài bằng npm ci, Prisma client sinh từ schema hiện hữu.
- File .env local không commit; giữ config JWT/session/Redis hiện hành; không thêm package hoặc config mới cho tính năng.
- Integration chỉ chạy khi tác vụ tiếp theo có cho phép ghi vào các database disposable trên PostgreSQL local đã được người dùng chọn; .env.test.local/credentials không thay cho cho phép. Không dùng Azure/member DB cho fixture.
- Runner test:local hiện có có thể tạo control DB nếu chưa tồn tại; chỉ dùng khi cho phép đã bao gồm phần này. Không tạo PostgreSQL container mới, reset DB hoặc xóa volumes.
- Kiểm thử HTTP thủ công bên dưới chỉ trên API nối DB fixture cô lập đã được cho phép. Có System Admin ACTIVE và các guards role.view, permission.view, permission.create, role_permission.manage; có hai tài khoản cùng role ở hai tổ chức và một denial riêng.
- Redis local cần sẵn cho session/rate limiter. Nếu cần khởi động service, dùng đúng lệnh dự án:

```bash
docker compose up -d --no-recreate --wait redis
npm run redis:check
```

Không chạy bootstrap để “sửa” thiếu quyền trong môi trường thật. Tính năng dùng guards hiện hữu; fixture test chuẩn bị quyền trong database disposable.

## Quality và unit tests

Chạy từ root repository sau implement:

```bash
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
```

Unit file đã đăng ký trong test:unit: tests/permission-management.test.ts. Có thể chạy riêng:

```bash
node --import tsx --test tests/permission-management.test.ts
```

Kỳ vọng: typecheck/build/lint/format đạt; test bao phủ strict validation, guard/scope, DTO allowlist, pagination, delta grants, deny SYSTEM_ADMIN writes và bounded retry. Không coi unit PASS là bằng chứng PostgreSQL concurrency.

## PostgreSQL integration trên instance đã được cho phép

Sau khi thiết lập local instance theo chính sách dự án và có cho phép test writes:

```bash
npm run test:local:check
npm run test:local:authorization
```

Mở rộng authorization.integration.test.ts thay vì tự tạo runner khác. Test runner tạo database riêng và chỉ cleanup exact names ghi nhận sau CREATE thành công trong invocation; không reset control/member DB hoặc quét/drop theo prefix. Nếu refactor ảnh hưởng protocol locks với lifecycle, chạy thêm:

```bash
npm run test:local:lifecycle
```

Kỳ vọng: guards/live identity, tenant isolation, global state/grants/denials, rollback và barrier races đạt. Ghi thực tế pass/fail/skipped và prerequisites bị chặn vào kết quả implement; không ghi trước số test hoặc suy kết quả từ bản kế hoạch.

## Walkthrough HTTP trong môi trường fixture

Dùng một phiên System Admin hợp lệ theo [AUTH_SESSIONS.md](../../docs/AUTH_SESSIONS.md). Ví dụ dùng cookie jar đã được login bằng tài khoản fixture; không ghi token/mật khẩu vào tài liệu hoặc commit. Thiết lập các biến trong shell theo API fixture của người chạy:

```bash
export FOODPRINT_TEST_API_BASE='http://localhost:3000/api'
export FOODPRINT_TEST_COOKIE_JAR='/tmp/foodprint-role-permission.cookies'
```

Cookie jar phải tồn tại từ bước login; server port có thể khác theo config. Mọi write phải có X-CSRF-Protection: 1, và Origin nếu gửi phải đúng CLIENT_URL. Bearer auth cũng phải tuân CSRF.

1. Duyệt vai trò và quyền; dùng page/limit và hasNext để đi hết danh mục:

```bash
curl -fsS -b "$FOODPRINT_TEST_COOKIE_JAR" "$FOODPRINT_TEST_API_BASE/roles?page=1&limit=20"
curl -fsS -b "$FOODPRINT_TEST_COOKIE_JAR" "$FOODPRINT_TEST_API_BASE/permissions?page=1&limit=20"
```

Xác nhận SYSTEM_ADMIN editable=false; quyền inactive vẫn hiển thị. /api/auth/roles vẫn đọc được theo contract cũ.

2. Trong DB fixture, thêm một code chưa có; lần lặp lại phải nhận 409, không tạo grant:

```bash
curl -sS -i -b "$FOODPRINT_TEST_COOKIE_JAR" \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -X POST "$FOODPRINT_TEST_API_BASE/permissions" \
  --data '{"code":"permission_demo.check","name":"Quyền kiểm thử","module":"permission_demo","action":"check","description":null}'
```

Lấy id từ data.id của lần 201 và gán vào FOODPRINT_TEST_PERMISSION_ID. Chọn role fixture có thể sửa từ danh sách, gán FOODPRINT_TEST_ROLE_ID; không dùng UUID ví dụ trong contract.

3. Sửa metadata, xem lại danh mục và role. Thử body rỗng/code/isActive trong endpoint metadata phải 400:

```bash
curl -sS -i -b "$FOODPRINT_TEST_COOKIE_JAR" \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -X PATCH "$FOODPRINT_TEST_API_BASE/permissions/$FOODPRINT_TEST_PERMISSION_ID" \
  --data '{"name":"Tên kiểm thử đã sửa","description":null}'
```

4. Lấy bộ quyền role, chuẩn bị file JSON trong /tmp với permissionIds là toàn bộ tập muốn giữ cộng quyền fixture vừa tạo. PUT là thay thế toàn bộ, không phải thêm một phần. Ví dụ FOODPRINT_TEST_ROLE_BODY trỏ tới file đó:

```bash
curl -fsS -b "$FOODPRINT_TEST_COOKIE_JAR" \
  "$FOODPRINT_TEST_API_BASE/roles/$FOODPRINT_TEST_ROLE_ID/permissions"
curl -sS -i -b "$FOODPRINT_TEST_COOKIE_JAR" \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -X PUT "$FOODPRINT_TEST_API_BASE/roles/$FOODPRINT_TEST_ROLE_ID/permissions" \
  --data-binary "@$FOODPRINT_TEST_ROLE_BODY"
```

5. Tạm ngừng rồi kích hoạt quyền fixture bằng cùng endpoint (đổi false thành true ở lần sau):

```bash
curl -sS -i -b "$FOODPRINT_TEST_COOKIE_JAR" \
  -H 'Content-Type: application/json' -H 'X-CSRF-Protection: 1' \
  -X PATCH "$FOODPRINT_TEST_API_BASE/permissions/$FOODPRINT_TEST_PERMISSION_ID/state" \
  --data '{"isActive":false}'
```

Giữ grant inactive hiện có qua PUT phải thành công; gán mới inactive cho role khác phải 400; thu hồi inactive hợp lệ, kích hoạt lại không tạo lại grant đã xóa. Quyền demo không gắn chức năng nghiệp vụ nên chỉ kiểm cấu hình; kiểm hiệu lực trên nghiệp vụ thật dùng fixture đã gán menu.view trong integration.

## Ma trận kết quả cần ghi nhận

| Tình huống                                                    | Kết quả kỳ vọng                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Hai tổ chức cùng role, cấp/thu hồi menu.view                  | Request tiếp theo dùng cùng phiên phản ánh đúng thay đổi; dữ liệu vẫn đúng tổ chức      |
| Global false/true, nhiều role gồm System Admin                | Hiệu lực đổi đúng, grants/denials trước và sau bằng nhau                                |
| Denial riêng rồi role thu hồi/cấp lại hoặc global off/on      | Tài khoản vẫn bị hạn chế; không xóa denial                                              |
| Inactive đã gán / inactive mới / inactive đã thu hồi          | Giữ hoặc thu hồi được / gán mới 400 / bật lại không tái gán                             |
| SYSTEM_ADMIN target PUT, kể cả cùng tập/rỗng                  | 403; grant snapshots bất biến                                                           |
| Authority hoặc admin tổ chức được gán guard quản trị toàn cục | Các API catalog/role mới vẫn 403                                                        |
| Thiếu guard, locked actor, role/org đổi trước điểm chấp nhận  | Không có write; 403 hoặc retry đọc trạng thái mới rồi 403                               |
| Hai PUT cạnh tranh                                            | Kết quả nguyên bộ của một lần lưu, không chắp vá                                        |
| Gán mới cạnh tranh global off                                 | Theo thứ tự khóa: grant trước off được giữ inactive; off trước thì new grant bị từ chối |
| Unique create cạnh tranh / lỗi sau bước ghi đầu               | Một code duy nhất, loser 409 / rollback toàn bộ                                         |
| Actor query hoặc COMMIT serialization conflict                | Bounded retry cả transaction; business 403 không retry                                  |
| Tự tắt role_permission.manage                                 | Request hiện tại có thể 200, các request sau 403; fixture phục hồi chỉ trong DB test    |
| Sai query/body/UUID/nhiều fields                              | 400 với error.fields paths, không raw values/SQL/secrets                                |
| GET user permissions/PUT-DELETE denial cũ                     | Envelope/ownership/ACTIVE target và authority restrictions không đổi                    |

Races cần barrier để ép cả hai thứ tự chấp nhận, không dùng sleep ngẫu nhiên. Với self-disable, ưu tiên fixture/test tự động để có recovery cô lập. Các script/lệnh ở đây không cho phép sửa dữ liệu vận hành.

## Tiêu chí hoàn tất kiểm chứng

Đối chiếu SC-001–006 trong spec, lưu bằng chứng thực tế. SC-005 cần walkthrough bằng client/UI quản trị có đủ dữ liệu; không suy trải nghiệm người dùng từ tests. Chưa có migration để deploy và không có bước bootstrap/seed/startup tự cấp quyền trong kế hoạch này.

## Kết quả triển khai và kiểm chứng — 2026-11-17

Đã triển khai trên `feat/role-permission-management`. Đã sửa I1: US2 phụ thuộc T016–T017 và checkpoint US1; chạy lại phân tích spec/plan/tasks không còn findings, 16/16 FR có task. Checklist yêu cầu 16/16 PASS. Complaint vẫn tạm dừng trên nhánh riêng.

### Hành vi đã triển khai

- GET /api/roles mới, trả editable và phân trang; GET /api/auth/roles giữ nguyên.
- POST /api/permissions giữ guard permission.create, active mặc định, không auto-grant; unique code 409 kể cả inactive.
- PATCH metadata chỉ nhận name/description; PATCH state chỉ nhận isActive boolean; cả hai dùng role_permission.manage, System Admin + SYSTEM.
- PUT grants dùng chênh lệch, giữ inactive đã có/assignedAt, không thêm mới inactive, không xóa denial; SYSTEM_ADMIN grant writes luôn403.
- Controller/validation/service/repository tách đúng trách nhiệm, hai DTO riêng; shared Serializable transaction/recheck, giữ raw serialization/COMMIT conflict cho bounded retry.
- Global state áp dụng cả System Admin, không bypass tự mở lại khi tự tắt guard. Các API user permission/denial giữ semantics và tenant scope hiện hành.

### Bằng chứng thực tế

| Nhóm                | Lệnh/kịch bản thực tế                                                               | Kết quả                                                              |
| ------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Schema              | npm run prisma:validate                                                             | PASS; schema không đổi                                               |
| Quality             | npm run validate                                                                    | PASS: lint, format:check, typecheck, build; build sinh Prisma Client |
| Unit module         | node --import tsx --test tests/permission-management.test.ts                        | 21/21 PASS                                                           |
| Unit toàn repo      | npm run test:unit                                                                   | 739/739 PASS, 0 skipped                                              |
| Local target        | npm run test:local:check                                                            | PASS: PostgreSQL 127.0.0.1:5433, version 18.6                        |
| Authorization       | npm run test:local:authorization, child authorization.integration.test.ts           | 63/63 PASS                                                           |
| Supplier onboarding | Cùng runner authorization, child supplier-onboarding.integration.test.ts            | 16/16 PASS                                                           |
| Lifecycle           | npm run test:local:lifecycle                                                        | 29/29 PASS                                                           |
| Spec gate           | evaluateSpecGate trên toàn bộ thay đổi tracked/untracked của working tree, base dev | PASS; không phải GitHub CI/commit HEAD                               |

Các lỗi cần sửa đã được tái hiện bằng unit tests trước code tương ứng: gom lỗi validation, GET roles chưa có, giữ inactive grants, phân loại unique constraint và PATCH metadata/state chưa có. Không tuyên bố đã chạy DB tests trước implementation khi lúc đó chưa có cho phép test writes.

Integration dùng instance local đã chọn và database disposable qua runner hiện hữu. Lần authorization cuối ghi nhận/dọn đúng 4 database của invocation; lifecycle ghi nhận2, suite tự dọn1 và runner dọn1 còn lại. Không reset/control/member DB, không container mới, không Azure. Migration của suite chỉ replay vào database mới do invocation tạo; không có migration/schema/seed thay đổi của tính năng.

### Races và bất biến đã kiểm chứng trên PostgreSQL

- Hai PUT cạnh tranh kết thúc bằng một bộ quyền đầy đủ; fault sau grant write rollback toàn bộ.
- Grant-vs-global-off ở cả hai thứ tự: off trước thì new inactive grant bị400; grant trước thì quan hệ được giữ inactive.
- Khóa actor, đổi actor sang role SCHOOL và tạm ngừng guard: commit trước điểm khóa làm write bị403; write giữ khóa trước thì hoàn tất, thao tác thu hồi chờ và request kế tiếp bị403.
- Hai state writes và metadata-vs-state cạnh tranh; metadata không ghi đè isActive; fault sau metadata write rollback toàn bộ.
- Tự tắt role_permission.manage: request hiện tại200, request sau403; phục hồi guard chỉ qua fixture trong DB thử.
- Global off/on giữ nguyên toàn bộ grants/denials; role replacement giữ assignedAt của grant còn lại và denial riêng ở nhiều tổ chức.
- Query/COMMIT serialization retry và lỗi hết attempts trả503 an toàn; không retry business403 hoặc nhầm unique constraint khác thành code duplicate.
- Hồi quy session, scope tổ chức, supplier-staff, intake/lifecycle và quyền phản hồi nhà cung cấp đều đạt qua suite hiện hữu.

### Tình trạng nghiệm thu

SC-001–004 và SC-006 có bằng chứng backend/unit/PostgreSQL như trên. Các HTTP integration đã walkthrough bốn luồng trên fixture với phiên hợp lệ. **SC-005 chưa nghiệm thu với người kiểm thử/client quản trị phù hợp**; không suy kết quả này từ unit tests hoặc tự xây UI ngoài phạm vi. T048 hoàn tất phần tổng hợp/báo cáo và ghi rõ giới hạn này.

48/48 task đã được thực hiện/ghi nhận theo tiêu chí trong tasks.md. Không deploy database vận hành, không bootstrap quyền mới, không push hoặc mở PR. Code và tài liệu hiện nằm trong working tree để review.

## Amendment — API tìm quyền theo tên

GET /api/permissions?search=xem&page=1&limit=20 tìm substring name không phân biệt hoa/thường, giữ dấu tiếng Việt. Search trim, tối đa 150 ký tự; bỏ qua/rỗng nghĩa là không lọc. Chỉ tìm name, không code/description; gồm active và inactive, lọc trước phân trang. %, _ và backslash là ký tự literal. Guard/envelope/pagination giữ nguyên; GET /api/roles không nhận search.

Có thể dùng --data-urlencode khi gọi curl với từ khóa có dấu/khoảng trắng. Các ca kiểm chứng mới kiểm name-only, hoa/thường tiếng Việt, trim/empty, ký tự literal, quá dài/array/object, quyền thiếu guard, inactive và hasNext trên tập đã lọc. Hai ca unit mới đã tái hiện search bị400 trước khi mở rộng API; kiểm response còn phát hiện và sửa search bị lan vào pagination do spread query.

Authorization sau bổ sung search đạt64/64 và child onboarding16/16 trên disposable local; runner dọn đúng 4 database của invocation. Unit module đạt23/23, unit toàn repo đạt741/741. Đã giữ search optional ở cả hợp đồng TypeScript; kết quả quality cuối của cả hai amendment ở mục dưới.

## Amendment — danh sách 5 quyền chưa bật

GET /api/permissions/inactive?page=1 chỉ trả Permission.isActive=false. Query chỉ nhận page, mặc định 1; tối đa 5 mục mỗi trang và pagination.limit=5, không nhận limit/search. Guard SYSTEM_ADMIN/SYSTEM + permission.view, DTO/envelope/no-store giữ như danh mục. Trang vượt cuối trả items=[] và hasNext=false. Unit/HTTP kiểm default5, page lỗi/overflow, limit override bị400, empty page và quyền; integration tạo 7 inactive và 1 active, đối chiếu toàn bộ các trang và không đổi cấu hình grants.

Kết quả cuối của cả hai amendment:

| Kiểm chứng                                             | Kết quả                                  |
| ------------------------------------------------------ | ---------------------------------------- |
| npm run validate                                       | PASS: lint, formatting, typecheck, build |
| Unit module permission                                 | 25/25 PASS                               |
| npm run test:unit                                      | 743/743 PASS, không skipped              |
| npm run test:local:authorization — authorization child | 65/65 PASS                               |
| Cùng runner — supplier onboarding child                | 16/16 PASS                               |
| Spec gate evaluator trên working tree                  | PASS; chưa phải GitHub CI                |

Đã hoàn thành T049–T056; tổng 56/56 task. Kiểm thử PostgreSQL xác nhận search tiếng Việt insensitive/name-only, literal %, _ và backslash, filter trước pagination, inactive có mặt trong catalog search; endpoint inactive duyệt hết 5 mục/trang không lẫn active/trùng/mất và trả đúng trang rỗng/hasNext. Runner dọn đúng 4 database disposable của invocation, không đổi schema hoặc dữ liệu vận hành. SC-005 nghiệm thu người dùng/client vẫn chờ như trước. Chưa commit/push.
