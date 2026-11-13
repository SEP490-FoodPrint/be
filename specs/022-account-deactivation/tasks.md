# Tasks: Vô hiệu hóa tài khoản và tạm dừng tiếp nhận công việc

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/account-lifecycle-api.md](contracts/account-lifecycle-api.md), [quickstart.md](quickstart.md).

**Branch**: `feat/022-account-deactivation`.

**Tests**: Có tác vụ kiểm thử vì spec xác định User Scenarios & Testing, SC-001–008 và các tình huống rollback/cạnh tranh bắt buộc. Test viết trước phần triển khai tương ứng, xác nhận thất bại vì hành vi chưa có, rồi chạy lại sau khi hoàn thiện. Không bổ sung framework hoặc test mirror implementation.

**Organization**: Đúng bốn user story P1 trong spec. Các kịch bản tạm dừng của trường/NCC nằm trong US1; các kịch bản tạm dừng cán bộ nằm trong US3, không tạo user story mới. US2 đào sâu matrix điều kiện và race, US4 kiểm chứng security xuyên các luồng; bảo vệ quyền và IN_PROGRESS tối thiểu vẫn phải có từ foundation/US1.

## Format và phạm vi

Mỗi task có checkbox, ID tuần tự, `[USn]` ở pha story và đường dẫn cụ thể. `[P]` chỉ cho task không sửa cùng file, đủ prerequisite trong cùng batch; không có nghĩa toàn bộ các story chạy song song. Đường dẫn là relative từ repository root; file chưa tồn tại là đầu ra cần tạo.

Tác vụ này chỉ sinh tasks.md. Các task schema/migration là soạn file để review khi implement; không phải quyền tự apply migration, deploy, seed hoặc sửa dữ liệu vận hành. Test DB cần target local disposable được chọn rõ và quyền sử dụng; phải ghi prerequisite chưa đáp ứng. Generated client/build artifacts và `.specify/feature.json` không commit. Không thêm full CRUD đơn, hoàn tất giao nhận, đóng sự cố, nhóm thành viên cán bộ hoặc tài khoản thay thế.

## Phase 1: Setup

**Goal**: Chuẩn bị module và harness theo cấu trúc hiện có, không thêm framework hoặc triển khai database.

**Independent test / checkpoint**: Factory và test helper import được mà không mở kết nối DB/Redis.

- [x] T001 Khởi tạo factory/service dependency interfaces và cấu trúc module trong `src/modules/account-lifecycle/account-lifecycle.service.ts`, `src/modules/account-lifecycle/account-lifecycle.repository.ts`, `src/modules/account-lifecycle/account-lifecycle.routes.ts`; dùng shared Prisma client, chưa mount endpoint chưa hoàn thiện.
- [x] T002 [P] Tạo fixture builders và dependency injection helpers trong `tests/helpers/account-lifecycle.ts`, tái sử dụng `tests/helpers/authorization.ts` và `tests/helpers/http.ts`; dữ liệu chỉ dùng cho test, không tạo seed hoặc account trong runtime.

## Phase 2: Foundational — điều kiện tiên quyết chung

**Goal**: Chuẩn bị schema, migration được review, shared lock/guard và test harness. Không story nào bắt đầu trước khi nhóm này hoàn tất.

**Independent test / checkpoint**: Schema/client hợp lệ; guard và preflight có test; migration có fixture nâng cấp thành công/thất bại trên DB local disposable khi được phép chạy.

- [x] T003 Viết test cho preflight duplicate officer, mapping người nhận nội bộ bị thiếu/sai, external report và dữ liệu receipt không có bằng chứng trong `tests/account-lifecycle-data.test.ts`; xác nhận lỗi không làm thay đổi dữ liệu.
- [x] T004 Triển khai truy vấn catalog/dữ liệu chỉ đọc tương thích schema trước và sau migration trong `src/modules/account-lifecycle/account-lifecycle-data.repository.ts` và CLI `src/scripts/check-account-lifecycle-data.ts`; không dùng cột chưa tồn tại trên DB trước migration, không log URL/PII và không tự sửa dữ liệu; dùng shared client và transaction READ ONLY.
- [x] T005 Bổ sung `IntakeState`, intakeState trên School/Supplier/User, recipientUserId/receivedAt và relations trên FoodSafetyReportForwarding, partial unique officer trong `prisma/schema.prisma` theo `specs/022-account-deactivation/data-model.md`; giữ enum/status/định danh và hai admin unique cũ.
- [x] T006 Soạn SQL migration mới trong `prisma/migrations/20261112000100_account_lifecycle_intake/migration.sql`: preflight duplicate/orphan, mặc định ACTIVE, CHECK đúng owner/role và receipt, FK/index, backfill recipient duy nhất gồm inactive; không suy diễn receivedAt từ forwardedAt/SENT, không seed/xóa/gộp account hoặc sửa migration cũ; đây là tạo file review, không tự apply DB.
- [x] T007 Mở rộng `tests/migrations.test.ts` cho fresh/upgrade, defaults, CHECK/FK/index, partial unique cả inactive/deactivated, bảo toàn baseline và rollback khi gặp duplicate/orphan; mọi fixture nằm trong database test mới, không thay baseline manifest.
- [x] T008 Viết test hợp đồng trusted scope/operation, shared TransactionClient, thứ tự khóa và lỗi fail-closed trong `tests/intake-access.test.ts`; chuẩn bị các operation SCHOOL_CREATE_ORDER, SCHOOL_SEND_ORDER, SUPPLIER_ACCEPT_ORDER, OFFICER_RECEIVE_REQUEST, START_ORDER_PROCESSING, CONTINUE_ACCEPTED_WORK mà không mở HTTP giả.
- [x] T009 Triển khai query/row-lock primitives trong `src/modules/account-lifecycle/intake-access.repository.ts`: resolve admin/membership, khóa School → Supplier → User → Role actor theo ID tăng dần rồi resource; query EXISTS IN_PROGRESS và forwarding chưa CLOSED có fallback legacy theo xã; không import Request/Response DTO và không mở transaction riêng.
- [x] T010 Triển khai service guard nền trong `src/modules/account-lifecycle/intake-access.service.ts`: trusted scope/operation, nạp lại actor/quyền bằng transaction hiện hành, kiểm tra target đúng mapping và account hiện hành, dispatch guard tạo/gửi/nhận; chỉ service quyết định cho phép, repository giữ mọi Prisma args/SQL; operation chưa có policy hoàn thiện phải từ chối, không mặc định cho qua.
- [x] T011 Tạo harness PostgreSQL disposable và barriers trong `tests/helpers/account-lifecycle-database.ts` dựa trên `tests/authorization.integration.test.ts`; từ chối Azure/nonlocal/URL không đúng test prefix, tạo DB riêng cho mỗi lượt và chỉ cleanup DB do lượt đó tạo, không tự chạy vào DB member.
- [x] T012 Đăng ký các test nền đã tồn tại vào test:unit và preflight script trong `package.json`; chạy prisma:validate/generate, typecheck và unit nền, ghi kết quả thật hoặc thiếu prerequisite vào `specs/022-account-deactivation/quickstart.md`; migration test chỉ chạy trên target disposable được chọn rõ và được phép, không tự deploy hoặc bootstrap DB vận hành.

## Phase 3: US1 — Vô hiệu hóa admin và tạm dừng đơn của tổ chức (P1)

**Goal**: Khóa admin cùng mọi thành viên đúng tổ chức, đã có điều kiện IN_PROGRESS và kiểm tra quyền ngay từ lần đầu; cung cấp tạm dừng/resume và enforcement trên create/send/accept.

**Independent test / checkpoint**: Trường và NCC đủ điều kiện bị khóa trọn nhóm; đối tác không đổi; PAUSED chặn tạo/gửi/nhận qua mọi thành viên, nhưng đăng nhập/đọc và việc đã nhận vẫn được phép.

- [x] T013 [P] [US1] Viết unit/HTTP contract tests cho GET lifecycle, POST deactivate và PATCH intake-state của admin tổ chức trong `tests/account-lifecycle.test.ts`: cascade toàn status, tổng affectedAccountCount gồm tài khoản vốn đã khóa, strict params/body/query, trạng thái sai owner, no-op timestamp và không kích hoạt lại khi resume; từ đầu có kiểm thử role+permission và IN_PROGRESS tối thiểu.
- [x] T014 [P] [US1] Bổ sung regression tests create/send cũ và pause trên DRAFT cũ, staff cùng org, no-op SENT cùng contract trong `tests/supplier-onboarding.test.ts`; thêm unit/HTTP accept tests tại `tests/supply-order-intake.test.ts` cho SENT→ACCEPTED, scope khác NCC, paused, no-op ACCEPTED/IN_PROGRESS và trạng thái bị từ chối.
- [x] T015 [P] [US1] Viết integration cascade/rollback và tạm dừng tổ chức trong `tests/account-lifecycle.integration.test.ts` dùng harness nền: tổ chức không có staff, nhiều staff mọi status, nhiều đối tác và lỗi giữa transaction; không xem unit mock là bằng chứng atomicity.
- [x] T016 [US1] Định nghĩa UUID/action-empty/query-empty/intake-state bằng Zod strictObject/safeParse trong `src/modules/account-lifecycle/account-lifecycle.validation.ts` và Request DTO z.infer type-only trong `src/modules/account-lifecycle/account-lifecycle.request.dto.ts`; normalize body vắng thành {}, từ chối null/trường lạ, giữ lỗi tiếng Việt có field path.
- [x] T017 [US1] Định nghĩa LifecycleResponse và DeactivateResponse allowlist trong `src/modules/account-lifecycle/account-lifecycle.response.dto.ts` theo contract, phân biệt accountStatus/intakeState và updatedAt của entity chứa state; affectedAccountCount là tổng trong scope, không phải số changed.
- [x] T018 [US1] Hoàn thiện repository tổ chức trong `src/modules/account-lifecycle/account-lifecycle.repository.ts`: tìm đúng admin, đọc parent state/đếm scope, EXISTS IN_PROGRESS và updateMany DEACTIVATED theo schoolId hoặc supplierId, cập nhật parent intakeState chỉ khi đổi; tất cả dùng TransactionClient từ service.
- [x] T019 [US1] Hoàn thiện nhánh tổ chức trong `src/modules/account-lifecycle/account-lifecycle.service.ts`: SYSTEM_ADMIN+SYSTEM+user.manage, recheck actor/target/membership dưới khóa, chặn IN_PROGRESS trước cascade, rollback toàn bộ, phát hiện admin đã khóa còn staff chưa khóa, map DTO ISO; chưa có nhánh cán bộ thì trả lỗi rõ, không chạy cascade chung.
- [x] T020 [US1] Triển khai controller và ba route quản trị trong `src/modules/account-lifecycle/account-lifecycle.controller.ts`, `src/modules/account-lifecycle/account-lifecycle.routes.ts` và mount trong `src/routes/index.ts`; dùng authenticate/response helpers/asyncHandler, controller không import DTO và giữ nguyên GET users hiện có.
- [x] T021 [US1] Chuyển riêng validation create/send sang Zod mà giữ accepted input, null/default/limit/normalization tại `src/modules/supplier-onboarding/supplier-onboarding.validation.ts`; thêm Request/Response DTO tách biệt trong `src/modules/supplier-onboarding/supplier-onboarding.request.dto.ts` và `src/modules/supplier-onboarding/supplier-onboarding.response.dto.ts` theo contract, không migrate validators hợp đồng ngoài phạm vi.
- [x] T022 [US1] Tách query và persistence của createOrderDraft/sendOrder sang `src/modules/supplier-onboarding/supplier-onboarding.repository.ts`: scope, nguyên liệu, quan hệ, hợp đồng/snapshot, locks và ghi order/item; giữ nguyên query nghiệp vụ và shared TransactionClient, không import DTO.
- [x] T023 [US1] Tích hợp guard vào createOrderDraft/sendOrder trong `src/modules/supplier-onboarding/supplier-onboarding.service.ts` và cập nhật `src/modules/supplier-onboarding/supplier-onboarding.controller.ts` theo normalized DTO; parent locks trước pair advisory lock, rà soát lockSupplier callers tránh chu trình khóa; school PAUSED chặn create/DRAFT-send, no-op SENT hợp lệ không ghi, supplier pause chỉ chặn bước accept.
- [x] T024 [US1] Thêm schemas action/params/query và Request/Response DTO tách riêng trong `src/modules/supply-order/supply-order.validation.ts`, `src/modules/supply-order/supply-order.request.dto.ts`, `src/modules/supply-order/supply-order.response.dto.ts`; giữ parser/pagination và safe projection của GET cũ.
- [x] T025 [US1] Tạo `src/modules/supply-order/supply-order.repository.ts` chứa query GET hiện có và persistence accept có ownership supplier, locks, server acceptedByUserId/acceptedAt; service không còn dựng Prisma args trong phần được sửa.
- [x] T026 [US1] Triển khai accept trong `src/modules/supply-order/supply-order.service.ts`, `src/modules/supply-order/supply-order.controller.ts`, `src/modules/supply-order/supply-order.routes.ts`: SUPPLIER+supply_request.accept, đúng order scope, guard Supplier.intakeState/admin hai bên; SENT→ACCEPTED một lần, lặp ACCEPTED/IN_PROGRESS trả receipt cũ, không mở start/complete API.
- [x] T027 [US1] Đăng ký tests US1 vào test:unit và test:account-lifecycle:integration trong `package.json`; chạy unit/HTTP injection, typecheck/build và integration US1 khi có target được phép; ghi bằng chứng checkpoint vào `specs/022-account-deactivation/quickstart.md` thay vì đánh dấu pass khi chưa chạy.

## Phase 4: US2 — Điều kiện chặn đơn đang diễn ra và cạnh tranh (P1)

**Goal**: Chứng minh và hoàn thiện chính sách chỉ IN_PROGRESS chặn khóa; mọi writer liên quan phối hợp khóa/transaction để không có đơn mới IN_PROGRESS hoặc staff bị bỏ sót sau deactivation.

**Independent test / checkpoint**: Mọi trạng thái trừ IN_PROGRESS không chặn; đơn ngoài tổ chức không chặn. Các race có kết quả tuần tự hợp lệ, không có admin đã khóa cùng công việc mới phát sinh trái điều kiện.

- [x] T028 [P] [US2] Mở rộng matrix trong `tests/intake-access.test.ts` cho cả hai loại admin với DRAFT/SENT/ACCEPTED/IN_PROGRESS/COMPLETED/CANCELLED, nhiều đối tác, đơn ngoài scope, Delivery mọi trạng thái; xác nhận chỉ IN_PROGRESS chặn và truy vấn lỗi không được hiểu là không có đơn.
- [x] T029 [P] [US2] Bổ sung race có barrier trong `tests/account-lifecycle.integration.test.ts`: deactivation vs IN_PROGRESS, pause vs create/send/accept, cascade vs member insert/move, cả hai thứ tự commit; dùng trusted adapters cho writer chưa có API, không thêm endpoint chỉ để test.
- [x] T030 [US2] Hoàn thiện START_ORDER_PROCESSING/CONTINUE_ACCEPTED_WORK trong `src/modules/account-lifecycle/intake-access.service.ts` và lookup dưới khóa trong `src/modules/account-lifecycle/intake-access.repository.ts`; công việc đã ACCEPTED tiếp tục khi pause nhưng từ chối nếu admin/account liên quan DEACTIVATED, không bổ sung điều kiện chặn khóa dựa Delivery.
- [x] T031 [US2] Bổ sung trusted guard cho thêm/chuyển membership tổ chức vào `src/modules/account-lifecycle/intake-access.service.ts` và `src/modules/account-lifecycle/intake-access.repository.ts`; cùng parent-lock protocol, không tạo/chuyển account ACTIVE vào org có admin DEACTIVATED; không mở User CRUD ngoài spec.
- [x] T032 [US2] Kiểm tra và chỉnh những writer tổ chức hiện có thực sự cần tích hợp trong `src/modules/auth/onboarding.repository.ts`, `src/modules/auth/onboarding.service.ts`, `src/modules/supplier-onboarding/supplier-onboarding.repository.ts` nếu audit tìm thấy đường bỏ guard; không thay luồng tạo tổ chức mới vốn không gắn parent cũ, ghi danh sách writer đã audit vào `specs/022-account-deactivation/research.md`.
- [x] T033 [US2] Hoàn thiện fail-closed/retry boundaries trong `src/modules/account-lifecycle/account-lifecycle.service.ts` và `src/modules/account-lifecycle/intake-access.service.ts`, tái sử dụng `src/utils/authorization.ts`: không mở nested/independent transaction, không thay timeout/retry toàn repo hoặc cache quyền; lỗi hạ tầng trả 503, blocker trả 409 tiếng Việt.
- [x] T034 [US2] Kiểm chứng indexed EXISTS, shared TransactionClient và không N+1 bằng assertions trong `tests/intake-access.test.ts`; bổ sung retry/idempotency/rollback assertions vào `tests/account-lifecycle.integration.test.ts`, ghi thời gian chờ/transaction thực thay vì thêm SLA sản phẩm giả.
- [x] T035 [US2] Chạy matrix/race US2 bằng script của `package.json` trên disposable local target được phép; cập nhật `specs/022-account-deactivation/quickstart.md` với bằng chứng và giới hạn adapter: không tuyên bố đã có HTTP chuyển IN_PROGRESS/hoàn tất đơn.

## Phase 5: US3 — Khóa và tạm dừng riêng cán bộ ATTP xã (P1)

**Goal**: Cán bộ là một tài khoản/xã; chỉ khóa khi mọi yêu cầu CLOSED; tạm dừng chặn receive mới nhưng giữ xử lý yêu cầu đã nhận.

**Independent test / checkpoint**: Một request OPEN/INVESTIGATING/RESOLVED cũng chặn khóa; CLOSED hoặc không có request cho phép. Pause đúng người, receipt cũ giữ nguyên và cán bộ xã khác không bị ảnh hưởng.

- [x] T036 [P] [US3] Bổ sung unit/HTTP lifecycle cán bộ trong `tests/account-lifecycle.test.ts` và receive contracts trong `tests/reporting-receive.test.ts`: đúng recipient, strict body/query, thiếu receive permission, PAUSED, lặp receipt, CLOSED chưa nhận, không đổi NotificationStatus/incident status hoặc nhận bằng quyền view.
- [x] T037 [P] [US3] Bổ sung integration cardinality và blocker cán bộ trong `tests/account-lifecycle.integration.test.ts`: một officer/xã gồm inactive, OPEN/INVESTIGATING/RESOLVED/CLOSED, PENDING/FAILED forwarding, receivedAt null/non-null, nhiều forwarding, legacy null recipient và xã khác.
- [x] T038 [US3] Thêm permission hẹp food_safety_report.receive và grant mặc định chỉ COMMUNE_FOOD_SAFETY_OFFICER vào `src/constants/permission-catalog.ts`; thêm regression bootstrap idempotency/inactive-preservation tại `tests/authorization.test.ts`, không cấp food_safety_incident.manage và không chạy bootstrap DB vận hành.
- [x] T039 [US3] Định nghĩa params/action strict Zod, Request DTO z.infer và Response DTO allowlist cho reporting tại `src/modules/reporting/reporting.validation.ts`, `src/modules/reporting/reporting.request.dto.ts`, `src/modules/reporting/reporting.response.dto.ts`; giữ normalized pagination GET hiện có.
- [x] T040 [US3] Tạo `src/modules/reporting/reporting.repository.ts` chứa list queries hiện có, find/lock report theo recipientUserId/xã, incident và cập nhật receivedAt một lần; không dùng status SENT/forwardedAt để suy ra đã nhận và không nhận thời gian từ client.
- [x] T041 [US3] Triển khai service receive trong `src/modules/reporting/reporting.service.ts`: officer+AUTHORITY+food_safety_report.receive, live principal/scope, OFFICER_RECEIVE_REQUEST guard trong cùng transaction; receipt cũ trả lại dù pause, report chưa nhận với PAUSED hoặc CLOSED từ chối; map Date ISO và giữ GET projection/pagination.
- [x] T042 [US3] Thêm action receive tại `src/modules/reporting/reporting.controller.ts` và `src/modules/reporting/reporting.routes.ts`, kiểm tra mount `/api/food-safety-reports` trong `src/routes/index.ts`; controller chỉ validate/call service/sendSuccess, không import DTO hoặc đăng ký duplicate GET.
- [x] T043 [US3] Hoàn thiện nhánh officer trong `src/modules/account-lifecycle/account-lifecycle.repository.ts` và `src/modules/account-lifecycle/account-lifecycle.service.ts`: blocker mọi forwarding chưa CLOSED gồm legacy fallback, cascade đúng một user, intakeState ghi đúng User, no-op/invalid mapping/idempotency theo contract, không cập nhật group xã.
- [x] T044 [US3] Tích hợp mapping recipient ổn định vào `src/utils/resource-access.ts` và repository đọc chịu ảnh hưởng trong `src/modules/reporting/reporting.repository.ts`, `src/modules/inspection/inspection.service.ts`, `src/modules/food-analysis/food-analysis.service.ts`, `src/modules/traceability/traceability.service.ts` sau khi audit tên thực tế; query mới nằm trong repository của module được sửa, giữ permission/projection và fallback legacy không làm rộng scope sang cán bộ xã khác.
- [x] T045 [US3] Hoàn thiện guard nhận/gán/forward request và đổi role/xã cán bộ trong `src/modules/account-lifecycle/intake-access.service.ts`, `src/modules/account-lifecycle/intake-access.repository.ts`; không làm mồ côi request chưa CLOSED, không tạo officer thứ hai hoặc coi xã là nhóm admin/member; writer chưa có production API chỉ có integration contract, không invent lifecycle.
- [x] T046 [US3] Bổ sung race pause/deactivation vs receive/forward và membership cán bộ trong `tests/account-lifecycle.integration.test.ts`: receipt/recipient dùng cùng lock protocol, report chưa nhận vẫn ngăn khóa, resume không tự nhận và notification retry không tự điền receivedAt.
- [x] T047 [US3] Đăng ký test nhận báo cáo trong `package.json`, chạy unit/HTTP và integration cán bộ khi có local target được phép; ghi coverage yêu cầu đã nhận vs chưa nhận và dữ liệu lịch sử vào `specs/022-account-deactivation/quickstart.md`.

## Phase 6: US4 — Quyền quản trị và hiệu lực khóa phiên (P1)

**Goal**: Kiểm chứng xuyên các endpoint rằng không có role bypass, tài khoản DEACTIVATED bị chặn ở lần truy cập kế tiếp, PAUSED vẫn đăng nhập/đọc và xử lý việc đã nhận.

**Independent test / checkpoint**: Tài khoản thuộc cả ba nhóm không login/refresh/me/business bằng phiên cũ sau khóa; tạm dừng không làm mất login; revoke permission/đổi membership đồng thời không cho ghi bằng quyền cũ.

- [x] T048 [P] [US4] Bổ sung regression login/refresh/me với DEACTIVATED và PAUSED vào `tests/auth-session.test.ts`, dùng session-store injection cô lập; kiểm tra trạng thái DB là căn cứ, không cần xóa Redis hoặc chờ token hết hạn.
- [x] T049 [P] [US4] Bổ sung role/scope/permission negative matrix cho mọi action vào `tests/account-lifecycle.test.ts`, `tests/supply-order-intake.test.ts`, `tests/reporting-receive.test.ts`: System Admin thiếu user.manage, org admin/cán bộ có permission quản trị vẫn bị cấm quản trị, view không thay receive và ID ngoài scope không lộ dữ liệu.
- [x] T050 [US4] Bổ sung kiểm chứng DB identity thật với phiên tạo trước deactivation trong `tests/account-lifecycle.integration.test.ts`: login/refresh/me/business request kế tiếp bị từ chối, PAUSED còn ACTIVE vẫn đọc được; session backend test phải dùng store cô lập và ghi rõ injection hay Redis thật.
- [x] T051 [US4] Bổ sung barrier permission-revocation/actor-status/membership-change race trong `tests/account-lifecycle.integration.test.ts`; tái nạp actor/target trong transaction, mọi repository cùng client, không cập nhật theo identity hoặc permission chỉ đọc trước transaction.
- [x] T052 [US4] Sửa tối thiểu nếu regression phát hiện lỗ hổng trong `src/utils/authorization.ts`, `src/utils/session-identity.ts`, `src/modules/auth/session.service.ts`, `src/middlewares/auth.middleware.ts` các service action đã thêm hoặc `src/modules/permission/permission.service.ts` và `src/modules/permission/permission.repository.ts` khi regression snapshot yêu cầu version barrier; không đổi JWT/cookie contract, không dùng intakeState làm account status, không thêm session cleanup Redis bắt buộc sau commit; nếu đã đúng thì giữ source và lưu bằng chứng test.
- [x] T053 [US4] Kiểm tra error/projection boundaries tại `src/modules/account-lifecycle/account-lifecycle.controller.ts`, `src/modules/supply-order/supply-order.controller.ts`, `src/modules/reporting/reporting.controller.ts` với `tests/account-lifecycle.test.ts`: 400/401/403/404/409/503, ISO Date, nhiều validation issues tiếng Việt, không raw request/secret/query errors hoặc envelope mới.
- [x] T054 [US4] Chạy targeted security/auth regression và build, ghi kết quả vào `specs/022-account-deactivation/quickstart.md`; không tạo cảnh báo/approval trong product flow và không khai báo đã revoke mọi session Redis khi chỉ dùng DB guard.

## Phase 7: Polish & cross-cutting concerns

**Goal**: Hoàn thiện tài liệu, CI, kiểm tra chất lượng và bằng chứng nghiệm thu của toàn feature.

**Independent test / checkpoint**: Toàn bộ FR-001–019 và SC-001–008 có task/test tương ứng; các kiểm tra đã chạy có kết quả thật, kiểm tra chưa chạy ghi prerequisite cụ thể.

- [x] T055 [P] Cập nhật ma trận endpoint/quyền, grant receive và integration guard cho writer tương lai trong `docs/AUTHORIZATION.md` và `src/modules/README.md`; mô tả trạng thái tạm dừng độc lập, một tài khoản cán bộ/xã, và các lifecycle chưa có API vẫn ngoài phạm vi.
- [x] T056 [P] Cập nhật migration mới, preflight/legacy recipient/receipt và trạng thái triển khai thực tế vào `database/SCHEMA_BASELINE.md`; giữ nguyên baseline manifest và migration đã áp dụng, không ghi đã deploy khi chưa có bằng chứng, không tự chạy DDL/seed/operator data repair.
- [x] T057 Hoàn tất đăng ký mọi unit file, script preflight và test:account-lifecycle:integration trong `package.json`; thêm suite DB mới vào job disposable PostgreSQL của `.github/workflows/ci.yml` dưới Backend quality, không đưa Azure credentials vào quality job và không sửa CD thành seed/auto-bootstrap.
- [x] T058 Chạy prisma:validate/generate, npm run validate và npm run test:unit, format riêng file thay đổi khi cần; kiểm tra kiến trúc controller/DTO/service/repository, generated output không commit; lưu lệnh/kết quả thực trong `specs/022-account-deactivation/quickstart.md` và cập nhật checkbox tương ứng trong `specs/022-account-deactivation/tasks.md`.
- [x] T059 Chạy test:migrations, test:authorization và test:account-lifecycle:integration chỉ trên disposable local target được chọn rõ và được phép; ghi kết quả/blocked prerequisite tại `specs/022-account-deactivation/quickstart.md`; không dùng thiếu hạ tầng làm lý do đánh dấu pass hoặc chạy vào Azure/DB thành viên.
- [x] T060 Đối chiếu toàn bộ ma trận nghiệm thu SC-001–008 trong `specs/022-account-deactivation/quickstart.md` với `specs/022-account-deactivation/spec.md` và `specs/022-account-deactivation/contracts/account-lifecycle-api.md`; xác nhận mọi write path hiện có được bảo vệ, mọi race có bằng chứng DB thật, future-writer adapter không bị trình bày như endpoint production.
- [x] T061 Kiểm tra Spec gate của `.github/scripts/spec-gate.mjs` cho branch feat/022-account-deactivation và ba artifact `specs/022-account-deactivation/spec.md`, `specs/022-account-deactivation/plan.md`, `specs/022-account-deactivation/tasks.md`; chạy git diff --check, tổng hợp điều kiện operator preflight/deploy/bootstrap tách biệt trong `specs/022-account-deactivation/quickstart.md`, không commit/push/deploy tự động.

## Dependencies & execution order

### Phase dependencies

```text
Setup T001–T002
  -> Foundation T003–T012
  -> US1 T013–T027
  -> US2 T028–T035
  -> US3 T036–T047
  -> US4 T048–T054
  -> Polish T055–T061
```

Thứ tự mặc định tuần tự vì các story bổ sung vào cùng account-lifecycle service/repository, guard và integration suite. Không sửa những file đó đồng thời. US3 chỉ phụ thuộc kỹ thuật vào foundation và module quản trị US1; có thể bắt đầu sau US1 khi US2 chưa xong nếu cô lập thay đổi, nhưng phải tích hợp lại và chạy đủ race trước release. US4 có thể viết unit cases sau foundation nhưng checkpoint cuối đợi tất cả endpoint.

### Các dependency quan trọng trong mỗi pha

- Schema trước SQL/client; query preflight chạy được cả trước/sau schema. Migration tests cần SQL draft; DB execution là prerequisite hạ tầng riêng, không tự triển khai vào DB hiện có.
- Query/lock primitives trước guard service; mỗi service dùng transaction chung, không cho repository tự commit.
- Trong US1: ba task test đầu được viết trước; validation/DTO và repository trước service; controller/routes chỉ mount sau service đủ quyền/blocker; accept đòi hỏi guard và repository, không trùng route create/send.
- Trong US2: test matrix/race trước policy còn thiếu, guard membership trước audit integration; không bỏ IN_PROGRESS blocker khỏi US1 để chờ US2.
- Trong US3: quyền receive và schema có trước receive service; recipient/receipt repository trước service/controller, nhánh officer quản trị được bật sau blocker đã đúng; mapping read scope phải giữ giới hạn theo recipient.
- Trong US4: dùng các API thực và session identity loader hiện có; chỉ sửa auth khi test chứng minh lỗi, không tạo cơ chế revoke/cache quyền mới.
- Chỉ hoàn thành task có bằng chứng tương ứng; test hạ tầng chưa chạy vẫn để checkbox mở kèm lý do. Không đánh dấu toàn feature hoàn tất chỉ vì unit xanh.

## Parallel execution examples

Các batch dưới đây là cơ hội chia việc, không tự khởi chạy agent hoặc lệnh triển khai.

| Story / pha | Batch có thể song song | Điều kiện                                                                        |
| ----------- | ---------------------- | -------------------------------------------------------------------------------- |
| Setup       | T001 và T002           | Source module và test helpers tách file; dùng interface đã thống nhất trong plan |
| US1         | T013, T014, T015       | Foundation xong; unit quản trị, regression order và integration suite khác file  |
| US2         | T028 và T029           | US1 xong; unit guard và integration race khác file                               |
| US3         | T036 và T037           | Các pha trước xong; không có task US1/US2 còn ghi chung suite                    |
| US4         | T048 và T049           | Auth session unit và endpoint negative unit khác file                            |
| Polish      | T055 và T056           | Tất cả story đã tích hợp; tài liệu API và baseline tách file                     |

Sau batch test, triển khai theo ID; chỉ chia thêm công việc khi chắc chắn không cùng file và mọi dependency đã hoàn tất. Không mặc định đánh `[P]` cho repository/DTO/controller chỉ vì nằm khác tên file khi còn phụ thuộc interface chưa viết.

## Requirement coverage

| Yêu cầu            | Nhóm task sở hữu / bằng chứng                                        |
| ------------------ | -------------------------------------------------------------------- |
| FR-001/002, FR-011 | Foundation, US1 API/validation, US4 quyền và error boundaries        |
| FR-003/004         | US1 blocker tối thiểu, US2 matrix mọi status và race IN_PROGRESS     |
| FR-005/006/013     | US1 cascade/rollback/idempotency, US2 membership protocol            |
| FR-007/008         | US3 recipient/legacy mapping, CLOSED blocker và chỉ một cán bộ       |
| FR-009             | US4 login/refresh/me/business với phiên cũ và PAUSED vẫn ACTIVE      |
| FR-010/019         | Foundation parent locks/Serializable, US2/US3/US4 race và retry thật |
| FR-012             | US1/US3 no-op mutation/receipt, US4 resume không kích hoạt account   |
| FR-014/015/016     | US1 pause/resume/create/send/accept thật, US4 quyền quản trị         |
| FR-017/018         | US3 pause/receive thật; US1 bản nháp/SENT cũ và việc đã nhận         |
| SC-001/002/005/006 | US1+US2 unit/HTTP và PostgreSQL integration                          |
| SC-003/007         | US3 unit/HTTP, cardinality/recipient/race integration                |
| SC-004             | US4 auth/session regression và DB identity integration               |
| SC-008             | US1+US3 old-work/no-op/resume, kiểm chứng quickstart cuối            |

## Implementation strategy

### MVP an toàn

Hoàn tất Setup + Foundation + US1 để demo luồng admin trường/NCC và tạm dừng create/send/accept. MVP vẫn bắt buộc kiểm tra quyền, IN_PROGRESS, tenant isolation và rollback; không bỏ các điều kiện đó để giao sớm. Chỉ demo trên dữ liệu test/disposable đã được phép. MVP không đại diện đã hoàn tất cán bộ hoặc toàn bộ kiểm chứng cạnh tranh/security của feature.

### Incremental delivery

Tiếp tục US2 để đóng matrix/race tổ chức, US3 để bàn giao cán bộ/receive, US4 để chốt auth/security, rồi Polish để chạy quality và kiểm chứng đủ [quickstart.md](quickstart.md). Chỉ release đầy đủ khi cả bốn story và các kiểm tra bắt buộc đạt. Mọi thay đổi schema/provision quyền trên database đang dùng đi theo ủy quyền operator hoặc dev CD được duyệt, không nằm trong thao tác tự động của task generator.

## Generation validation

Tổng **61 tasks**: Setup 2, Foundation 10, US1 15, US2 8, US3 12, US4 7, Polish 7. Tất cả checkbox khởi tạo chưa hoàn thành; task đánh `[P]` chỉ là cơ hội thực thi song song theo batch ở trên.

Không có `.specify/extensions.yml`, nên không có before_tasks/after_tasks hook cần thực thi. Bước tiếp theo khuyến nghị `$speckit-analyze` để kiểm tra nhất quán trước `$speckit-implement`.
