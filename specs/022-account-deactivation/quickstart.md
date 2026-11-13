# Quickstart validation: account lifecycle

Hướng dẫn kiểm chứng phần đã triển khai và các kiểm tra còn phải thực hiện. Đối chiếu [hợp đồng](contracts/account-lifecycle-api.md) và [dữ liệu](data-model.md); không xem các kỳ vọng dưới đây là kết quả kiểm thử thực tế.

## 1. Chuẩn bị

- Node 24.22.1, npm 11; dependencies theo lockfile. `.env` untracked, không đưa token/credential vào tài liệu hoặc log.
- Hoàn tất `$speckit-tasks` và implementation trước khi chạy kiểm chứng tính năng.
- Unit không cần DB/Redis. Test HTTP thật/auth runtime cần Redis local; giữ namespace cô lập, không flush hoặc xóa wildcard.
- Integration phải chọn `MIGRATION_TEST_DATABASE_URL` trỏ instance PostgreSQL local disposable có quyền tạo database tạm, pathname theo harness `foodprint_migration_test...`; không Azure, không DB thành viên.
- Preflight dữ liệu vận hành là chỉ đọc, chạy bằng script kiểm tra đã được triển khai. Không dùng quickstart như cho phép chạy migration, bootstrap hoặc tạo dữ liệu trên DB hiện có.

## 2. Kiểm tra không ghi database

Từ repository root, sau implementation:

```sh
npm run prisma:validate
npm run prisma:generate
npm run validate
npm run test:unit
```

Kỳ vọng: schema hợp lệ, generated client CJS/typecheck/build đúng, lint/format đạt; unit/HTTP injection cho lifecycle và guard đã đăng ký trong test:unit đều pass. Client/build output không commit.

Có thể chạy hai file unit mới trực tiếp để debug:

```sh
./node_modules/.bin/tsx --test tests/account-lifecycle.test.ts tests/intake-access.test.ts
```

## 3. Kiểm chứng DB disposable

Chỉ sau khi đã chọn và được phép dùng target local disposable. Không đặt URL thật trong command được chia sẻ. Harness tạo DB riêng và chỉ cleanup DB do chính lượt test tạo; migration suite từ chối schema có sẵn, không reset schema người dùng.

```sh
npm run test:migrations
npm run test:authorization
npm run test:account-lifecycle:integration
```

`test:account-lifecycle:integration` đã được đăng ký và được gọi trong job disposable PostgreSQL của CI. Test tự tạo dữ liệu cô lập và catalog trong DB test; không gọi auth:bootstrap trên DB vận hành.

Kỳ vọng migration: default ACTIVE không thay account/entity status; CHECK từ chối intakeState sai role/owner; partial unique không cho hai officer cùng xã kể cả inactive; hai admin unique cũ còn nguyên; recipient FK/receipt constraints hợp lệ; duplicate/orphan upgrade bị từ chối mà không xóa/gộp dữ liệu.

## 4. Ma trận nghiệm thu nghiệp vụ

Dùng tài khoản/phiên test do harness tạo, gồm System Admin có/thiếu user.manage, trường A/B, nhà cung cấp X/Y và cán bộ xã C/D. Không tạo mock data trên DB hiện có để chạy thủ công.

| Tình huống                                    | Thực hiện                                           | Kỳ vọng                                                                    |
| --------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Admin school/NCC đủ điều kiện                 | POST users/:id/deactivate                           | 200; toàn bộ tài khoản tổ chức DEACTIVATED; đối tác/đơn vị khác giữ nguyên |
| Có đơn IN_PROGRESS                            | Khóa từng admin                                     | 409; không account nào đổi                                                 |
| Chỉ DRAFT/SENT/ACCEPTED/COMPLETED/CANCELLED   | Khóa từng admin                                     | Không bị chặn bởi trạng thái đơn; Delivery không tạo điều kiện chặn riêng  |
| Cán bộ có yêu cầu OPEN/INVESTIGATING/RESOLVED | Khóa cán bộ                                         | 409 kể cả report PENDING/FAILED hoặc chưa nhận                             |
| Không có request hoặc tất cả CLOSED           | Khóa cán bộ                                         | Chỉ cán bộ đích DEACTIVATED                                                |
| School PAUSED                                 | Create mới/gửi DRAFT cũ                             | 409; không ghi item/snapshot hoặc chuyển SENT                              |
| Supplier PAUSED_FOR_FOOD_SAFETY_INSPECTION    | Accept SENT cũ/mới                                  | 409; acceptedAt không được điền                                            |
| Officer PAUSED                                | Receive report chưa nhận, kể cả tạo từ trước        | 409; receivedAt vẫn null                                                   |
| Công việc đã nhận                             | Accept/receive lặp và service tiếp tục việc đã nhận | Trả timestamp cũ hoặc cho xử lý theo quyền; pause không chặn               |
| Resume                                        | Admin đổi intake-state ACTIVE                       | Không tự gửi/nhận; thao tác chủ động sau đó được phép nếu đủ điều kiện     |
| Resume account DEACTIVATED                    | Gỡ pause rồi login/refresh/business                 | Account vẫn DEACTIVATED và truy cập bị từ chối                             |
| Khác tài khoản thành viên                     | Lặp create/accept bằng staff cùng org               | Giới hạn pause vẫn áp dụng                                                 |
| Officer xã D                                  | Tạm dừng/khóa officer C                             | D không thay đổi; không có nhóm admin/member cán bộ                        |
| Thiếu quyền/role sai/tamper ID                | Gọi mọi action                                      | 403 hoặc 404 theo contract; không lộ dữ liệu hoặc ghi                      |

HTTP examples dùng header/cookie do harness quản lý, không cần đưa token thật vào shell:

```text
PATCH /api/users/<school-admin-id>/intake-state
{"state":"PAUSED"}

PATCH /api/users/<supplier-admin-id>/intake-state
{"state":"PAUSED_FOR_FOOD_SAFETY_INSPECTION"}

PATCH /api/users/<officer-id>/intake-state
{"state":"PAUSED"}

POST /api/users/<target-id>/deactivate
{}

POST /api/supply-requests/<sent-order-id>/accept
{}

POST /api/food-safety-reports/<forwarding-id>/receive
{}
```

Kiểm tra GET users/:id/lifecycle để đối chiếu accountStatus và intakeState riêng biệt. Date trả ISO, body/params/query lạ bị 400; controller không trả User/Prisma record hay credential.

## 5. Cạnh tranh và rollback bắt buộc

Dùng barrier có thể điều khiển giữa hai transaction trong integration, không dùng sleep ngẫu nhiên làm bằng chứng:

1. Bật pause vs tạo/gửi/nhận đơn và nhận report. Nếu pause được tuần tự hóa trước, lệnh nhận mới bị chặn; nếu lệnh đã commit trước, nó là công việc đã nhận và được tiếp tục.
2. Khóa admin vs chuyển đơn sang IN_PROGRESS bằng trusted service adapter, do chưa có HTTP lifecycle đó. Không được kết thúc với admin DEACTIVATED cùng đơn mới IN_PROGRESS do writer bỏ qua guard.
3. Khóa cán bộ vs gán/forward report mới chưa CLOSED; legacy recipient null vẫn xét blocker theo mapping xã.
4. Cascade vs thêm/chuyển thành viên; admin đã khóa không còn thành viên ACTIVE bị bỏ sót. Test insertion/move dùng adapter tuân cùng giao thức parent lock.
5. Thu hồi permission của actor khi thao tác đang chạy: không ghi theo quyền cũ sau recheck/retry.
6. Giả lập lỗi sau khi đã ghi một phần trong transaction: rollback toàn bộ, không thông báo thành công.
7. Lặp deactivate/suspend/resume/accept/receive: không đổi timestamp giả, không đổi người nhận hoặc kích hoạt account.
8. Token/refresh có trước deactivation: lần gọi tiếp theo login/refresh/me/business bị từ chối qua kiểm tra DB, không đợi token hết hạn.

Các adapter chỉ kiểm chứng policy/transaction của writer chưa có API, không phải bằng chứng đã có production endpoint chuyển IN_PROGRESS, hoàn tất đơn hoặc đóng sự cố. Không thêm những endpoint ngoài phạm vi chỉ để làm test xanh.

## 6. Điều kiện rollout

- Script preflight chỉ đọc `src/scripts/check-account-lifecycle-data.ts` báo không có duplicate officer/xã, recipient nội bộ mơ hồ hoặc membership sai; nếu có thì dừng triển khai, không sửa tự động.
- receivedAt lịch sử chỉ được xác nhận từ bằng chứng operator duyệt; forwardedAt/SENT không phải bằng chứng nhận nghiệp vụ. Bản ghi thiếu bằng chứng vẫn null và sẽ chịu quy tắc chưa nhận khi pause.
- Reviewed migration và quyền food_safety_report.receive phải được triển khai theo quy trình được phép; không chạy deploy/seed/bootstrap tự động từ app startup hoặc từ bước plan.
- Cập nhật docs/AUTHORIZATION.md, src/modules/README.md và trạng thái migration trong SCHEMA_BASELINE.md theo kết quả thực tế. Chưa có kết quả triển khai DB thì không ghi đã deploy.

## 7. Kết quả kiểm tra của bước lập kế hoạch

Chỉ kiểm tra định dạng Markdown, link nội bộ và tính nhất quán của spec/plan/research/data-model/contracts/quickstart. Không chạy test backend, migration, bootstrap, DB hay Redis trong bước này vì chỉ tạo tài liệu thiết kế. Kết quả thực tế phải được ghi sau khi các kiểm tra được thực thi, không thay bằng kỳ vọng trong hướng dẫn này.

## Kết quả triển khai từng phần — 2026-11-12

- Đã tạo module khởi đầu chưa mount, helper kiểm thử, script preflight chỉ đọc và tệp migration mới. Chưa có endpoint nghiệp vụ.
- `npm run prisma:validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run build` và ESLint trên các file thay đổi: đạt. `tsx --test tests/account-lifecycle-data.test.ts`: 5/5 đạt khi chạy ngoài sandbox do socket IPC bị từ chối trong sandbox.
- Chưa chạy migration hoặc kiểm thử PostgreSQL. Không có kết quả thực tế chứng minh migration trên database disposable ở bước này. Các task integration còn để mở.

- `npm run validate`: đạt đầy đủ lint, format, typecheck, build; `npm run test:unit`: 279/279 đạt.
- Đã bổ sung test migration cho defaults, CHECK/FK, unique cán bộ và nâng cấp dữ liệu cũ; chưa chạy vì chưa có `MIGRATION_TEST_DATABASE_URL` được chọn cho instance PostgreSQL local disposable. T007 vẫn chưa đánh dấu hoàn thành.

## Tiếp tục triển khai — kiểm tra guard nền

- Đã bổ sung repository khóa và service kiểm tra quyền/phạm vi/tạm dừng cho tạo, gửi, nhận đơn và nhận yêu cầu; các operation xử lý đơn chưa có policy trả lỗi mặc định. Guard chưa được gắn vào endpoint thực tế.
- `npm run prisma:validate`, `npm run validate` và `npm run test:unit`: đạt; 290/290 kiểm thử đơn vị đạt, trong đó có kiểm tra thứ tự khóa, quyền bị thu hồi và giới hạn tạm dừng.
- Đã viết helper tạo database tạm, kiểm tra từ chối Azure và tên database không đúng bằng unit test. Chưa chạy helper, migration tests, rollback hoặc race trên PostgreSQL thật; T007/T011 và các task integration vẫn mở.

## Lưu ý bootstrap quyền nhận báo cáo

Bootstrap hiện bảo toàn grants của role non-System đã tồn tại: tạo permission `food_safety_report.receive` trong catalog không tự gán quyền đó cho role cán bộ cũ. Sau bootstrap được phép, System Admin phải chủ động cấp quyền mới cho role qua chức năng quản trị; role cán bộ được tạo mới nhận grant mặc định. Không tự chạy bootstrap hoặc tự bật permission inactive trong ứng dụng hay CD.

## Tiến độ triển khai tiếp theo

- Đã có các action quản trị vòng đời, tạo/gửi/nhận đơn và nhận yêu cầu kiểm tra; guard xử lý việc đã nhận, membership và chuyển tiếp/điều chuyển cán bộ cho các writer tương lai. Các guard tương lai chưa phải API production.
- Đã chạy 37/37 kiểm thử chọn lọc cho phiên và guard, gồm việc từ chối phiên của ba nhóm sau khi tài khoản bị vô hiệu hóa. Kiểm thử này dùng identity và session store giả lập, không chứng minh race hay rollback PostgreSQL.
- Sau lần sửa guard membership, `npm run prisma:validate` và `npm run validate` đạt; `npm run test:unit` đạt 329/329. `git diff --check` đạt. Hàm đánh giá Spec gate đạt khi dùng branch và nội dung artifact hiện tại; đây không phải chạy gate trên commit/PR đã tạo.
- Sau đó đã bổ sung test trực tiếp service login/refresh/currentUser sau deactivation; `tsx --test tests/auth-session.test.ts` đạt 19/19 và `npm run typecheck` đạt. Toàn bộ suite 329/329 ở trên chạy trước khi bổ sung test này.
- Chưa chạy migration hoặc integration PostgreSQL vì chưa có `MIGRATION_TEST_DATABASE_URL` local disposable được chọn và cho phép. Những task yêu cầu bằng chứng DB thật vẫn mở; chưa triển khai migration hoặc bootstrap lên database vận hành.

## Kiểm chứng tiếp tục — 2026-11-13

- Đã sửa lỗi khởi tạo kết nối bị lọt khỏi lớp chuẩn hóa: action lifecycle/accept/receive và luồng tạo/gửi đơn liên quan trả 503 khi khởi tạo client thất bại. Regression cho ba service kiểm tra lỗi không chứa chi tiết kết nối. Không thay retry/timeout transaction chung.
- Bổ sung ma trận quyền cho mọi action lifecycle và hai action tiếp nhận; kiểm tra gỡ pause không kích hoạt lại tài khoản, lỗi HTTP 401/404/409/503, kết quả deactivate qua HTTP và phạm vi cascade mọi trạng thái chưa DEACTIVATED. Ma trận query cho cả trường/NCC chỉ lọc IN_PROGRESS, không phụ thuộc trạng thái Delivery; đây là unit assertions, chưa phải kết quả PostgreSQL.
- `npm run prisma:validate` và `npm run validate` đạt; `npm run test:unit` đạt **341/341**. Sau khi chuyển regression bootstrap về `tests/authorization.test.ts`, hai suite authorization/reporting đạt **20/20**, không thêm hoặc bỏ test.
- Đã thêm tình huống rollback khi repository ném lỗi sau cascade vào suite integration. Tình huống này chưa chạy; không dùng nó để xác nhận atomicity.
- Phát hiện số 013 trùng với `013-cooking-batch-groups`. Bộ spec này chuyển sang `specs/016-account-deactivation` và nhánh `feat/016-account-deactivation`; giữ nguyên phạm vi nghiệp vụ. Kiểm tra prerequisite bằng `SPECIFY_FEATURE_DIRECTORY=specs/016-account-deactivation` đạt. Hàm Spec gate với toàn bộ thư mục spec và danh sách thay đổi thực tế đạt; chưa có commit hoặc PR để chạy gate CI. Kết quả gate trước đó dùng tập spec thu hẹp không phát hiện trùng số, nên không phải bằng chứng đủ.
- Hiện hoàn thành **44/61 task**. Các task còn mở gồm mở rộng integration/race, hoàn thiện kiểm thử bảo mật và nghiệm thu PostgreSQL. `MIGRATION_TEST_DATABASE_URL` chưa được cấu hình; chưa chạy migration, bootstrap hay thay đổi dữ liệu vận hành.
- Không có `.specify/extensions.yml`; không có hook trước/sau implementation phải chạy.

- Regression trực tiếp create/send đã đạt: factory dùng dependency injection kiểm tra cùng transaction và actor trường, không ghi khi guard tạm dừng từ chối; gửi lại SENT cùng contract không ghi hoặc gọi guard tiếp nhận mới. Sau thay đổi này, `npm run validate` đạt và `npm run test:unit` đạt **342/342**; `git diff --check` đạt.

## Hoàn thiện kiểm thử cán bộ, bảo mật và chuẩn bị integration

- Hoàn thành T036, T045 và T053: HTTP lifecycle cán bộ; strict body/query, ownership và permission của receive; pause/resume không tự nhận, receipt gọi lại giữ nguyên; notification FAILED và incident OPEN không đổi khi nhận. Kiểm tra lỗi 400/401/403/404/409/503 của ba controller, nhiều field issues tiếng Việt và không lộ raw values; response nhận đơn không lộ contractSnapshot. Guard forward/reassignment có kiểm thử mapping đổi dưới khóa, trạng thái cán bộ và quyền bị thu hồi.
- `npm run test:unit`: **347/347 đạt**. Sau sửa kiểu timestamp trong test, suite reporting đạt **9/9**. `npm run validate`: đạt lint, format, typecheck và build sau lần sửa cuối.
- Đã mở rộng `tests/account-lifecycle.integration.test.ts` cho cascade trường/NCC với mọi account status, admin-only, lặp không đổi timestamp, rollback sau cập nhật nhóm, mọi trạng thái incident/notification/receipt, legacy recipient và nhiều forwarding, cùng kiểm tra catalog index hỗ trợ blocker.
- Đã viết barrier cho IN_PROGRESS với deactivation, insert/transfer member với cascade, pause với create/send/accept, pause/deactivation cán bộ với receive/forward và chuyển xã với forward. Giao dịch đầu được giữ sau khi lấy khóa; giao dịch sau báo đã tới bước lấy parent lock trước khi giao dịch đầu được giải phóng. Hai thứ tự được kiểm tra. Diagnostic thời gian transaction gồm cả barrier test, không phải SLA sản phẩm.
- Đã viết kiểm thử identity từ PostgreSQL và session store cô lập cho phiên cũ của trường/NCC/cán bộ; PAUSED còn truy cập được, DEACTIVATED chặn login/refresh/me/business. Các writer chưa có API dùng trusted adapter trong cùng transaction, không phải endpoint production.
- T051 có kịch bản request đã qua kiểm tra ban đầu nhưng đang chờ mở transaction, sau đó permission/status/membership bị thay đổi; chưa dùng kịch bản này làm bằng chứng thu hồi quyền giữa một Serializable snapshot đang chạy.
- **Toàn bộ phần PostgreSQL trên chưa chạy**: chưa có `MIGRATION_TEST_DATABASE_URL` được chọn và cho phép. T007/T011/T015/T027/T029/T034/T035/T037/T046/T047/T050/T051/T059/T060 vẫn mở. Tiến độ hiện tại **47/61 task**; không suy ra migration, rollback hay race đã đạt từ typecheck/unit. Không chạy deploy, bootstrap hoặc ghi dữ liệu vận hành.
- Không có `.specify/extensions.yml`; không có hook sau implementation cần thực thi.

## Nghiệm thu cuối trên PostgreSQL 18 disposable

Phần dưới cập nhật các trạng thái chờ hạ tầng ở những lần triển khai trước. Đã được phép tạo container `foodprint-016-tests-b7c19e6a` từ image PostgreSQL 18 có sẵn, bind cổng loopback được Docker cấp riêng, dữ liệu trên tmpfs. Chỉ dùng database `foodprint_migration_test` trong container này làm target; không dùng URL/credential/database vận hành. Ba harness tạo database test riêng trên instance đó. Container đã được dừng và tự xóa bằng --rm sau kiểm chứng; dữ liệu còn lại của các suite cũng bị loại bỏ cùng tmpfs.

| Kiểm tra                                              | Kết quả thực tế                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run test:migrations`                             | 12/12 đạt: fresh, upgrade, constraints/index/FK, từ chối dữ liệu legacy mơ hồ và bảo toàn lịch sử |
| `npm run test:authorization` sau sửa permission       | 37/37 đạt: auth, tenant isolation và các luồng hiện có                                            |
| `npm run test:account-lifecycle:integration` lần cuối | 22/22 đạt, gồm các scenario lặp trong ma trận trạng thái và hai thứ tự race                       |
| `npm run test:unit` sau sửa permission                | 347/347 đạt                                                                                       |
| `npm run validate` sau sửa permission                 | Đạt lint, định dạng, typecheck và build/generate client                                           |
| Sau bổ sung cuối trong integration                    | Typecheck và ESLint file integration đạt; integration chạy lại 22/22 đạt                          |

Regression thật đã phát hiện nhận đơn theo snapshot grants/denials cũ trong transaction đang chạy. Hai case denial/role-grant thất bại trước bản sửa, cùng status/membership kiểm tra bằng barrier sau lần đọc identity đầu tiên. Sau version-write User/Role và shared Role lock, cả bốn case đạt và đơn giữ SENT. Đã sửa fixture SENT để cung cấp forwardedAt theo CHECK hiện hành; receivedAt vẫn độc lập với forwardedAt. Shared transaction retries thực tế ghi nhận 1–2 lượt trong các race; thời gian của lượt cuối khoảng 7–60 ms cho lifecycle action, có gồm test barrier, không phải SLA.

| Tiêu chí | Bằng chứng đã chạy                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SC-001   | Cascade trường và NCC mọi account status, admin-only, idempotency, partner/scope giữ nguyên; rollback sau update nhóm                                                                |
| SC-002   | IN_PROGRESS chặn; mọi trạng thái incident chưa CLOSED chặn, bất kể notification/receipt; query/index đúng scope                                                                      |
| SC-003   | Cán bộ một tài khoản/xã gồm inactive; legacy recipient, nhiều forwarding, xã khác và CLOSED                                                                                          |
| SC-004   | Identity PostgreSQL thật và session store cô lập: login/refresh/me/business của trường/NCC/cán bộ bị từ chối sau khóa                                                                |
| SC-005   | Role/permission/scope negative matrix; rollback, no-op và các race hai thứ tự; thu hồi quyền khi transaction đã đọc identity                                                         |
| SC-006   | Pause với create/send/accept hai thứ tự; staff không vượt giới hạn, account ACTIVE vẫn login/đọc                                                                                     |
| SC-007   | Pause/deactivation với receive/forward, thay xã không làm mồ côi report; notification và incident giữ nguyên                                                                         |
| SC-008   | DRAFT/SENT/report chưa nhận bị chặn; receipt cũ giữ nguyên; adapter START/CONTINUE cho phép hoàn tất việc đã nhận khi pause; resume không tự nhận hoặc kích hoạt account DEACTIVATED |

START/CONTINUE, forward và membership test adapters chỉ ghi trong transaction theo guard, không phải API production mới. Phiên dùng store cô lập trong suite tính năng; suite authorization kiểm chứng thêm backend phiên Redis hiện có. Scope rollout vẫn yêu cầu operator preflight dữ liệu vận hành, migration được review và provision quyền receive theo quy trình được phép; lần kiểm chứng này không deploy hoặc bootstrap database vận hành.

**61/61 task đã hoàn tất**. Không có `.specify/extensions.yml`, nên không có hook trước/sau phải thực thi. Không tự commit, push hoặc deploy.

Spec gate được đánh giá lại với branch Git hiện tại, toàn bộ thư mục specs và danh sách thay đổi thực tế: đạt. Định dạng tài liệu và git diff --check đạt. Docker xác nhận không còn container foodprint-016-tests-b7c19e6a. Đây là kiểm chứng working tree, không phải kết quả CI của một PR đã tạo.
