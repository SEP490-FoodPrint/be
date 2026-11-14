# Tasks: Tiếp nhận yêu cầu nguyên liệu của nhà cung cấp

**Input**: Các tài liệu trong `specs/supplier-order-intake/`.

**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/supply-requests.md](contracts/supply-requests.md), [quickstart.md](quickstart.md).

**Tests**: Có task kiểm chứng theo Independent Test, acceptance scenarios và success criteria trong spec, ma trận kiểm chứng của plan và quality gate của hiến chương. Dùng Node test runner/tsx hiện có; không thêm framework.

**Organization**: Ba story đều P1 theo spec; thứ tự bên dưới tạo các phần hoàn chỉnh có thể kiểm chứng riêng. Đã hoàn thành 40/40 task; bằng chứng kiểm chứng và các lần sửa fixture được ghi tại quickstart.md.

## Format: `[ID] [P?] [Story] Description`

- `[P]`: Có thể làm song song với các task khác file trong cùng đợt sau khi các dependency đã hoàn thành; không cho phép hai người sửa chung file.
- `[US1]`, `[US2]`, `[US3]` tương ứng ba user story của spec.
- Đường dẫn là tương đối với root repository. Mỗi task có đầu ra hoặc file cần chỉnh cụ thể.
- Mở rộng module hiện có; không tạo schema/migration/seed, không deploy, không thêm cache hoặc dependency.

## Phase 1: Setup

**Purpose**: Xác nhận đúng tính năng và phạm vi công việc trước khi sửa code.

- [x] T001 Đọc `AGENTS.md`, `.specify/memory/constitution.md` và `specs/supplier-order-intake/spec.md`; kiểm tra nhánh `feat/supplier-order-intake`, feature pointer `.specify/feature.json`, checklist và thiết kế đã đồng nhất, ghi mọi sai lệch phải giải quyết vào `specs/supplier-order-intake/quickstart.md` trước khi triển khai.
- [x] T002 Rà soát routes/service/repository hiện có trong `src/modules/supply-order/`, mount tại `src/routes/index.ts` và grants trong `src/constants/permission-catalog.ts`; xác nhận `/api/supply-requests` cùng view/accept của hai role đã có, ghi baseline và prerequisite kiểm chứng vào `specs/supplier-order-intake/quickstart.md`, không cài lại dependency hoặc chạy bootstrap nếu không cần.

## Phase 2: Foundational — Hợp đồng dùng chung

**Purpose**: Chốt giao diện giữa các nhóm file để tránh tích hợp lệch và sửa chồng.

- [x] T003 Đối chiếu `specs/supplier-order-intake/contracts/supply-requests.md` với `src/modules/supply-order/supply-order.request.dto.ts`, `src/modules/supply-order/supply-order.response.dto.ts` và `src/modules/supply-order/supply-order.repository.ts`; chốt tên DTO/method supplier list, supplier detail và legacy list trong ghi chú triển khai của `specs/supplier-order-intake/plan.md`, giữ receipt bốn trường và input repository không import DTO.
- [x] T004 Xác nhận phương án kiểm tra hai role bằng `ROLES`/`ORG_TYPES` trong `src/modules/supply-order/supply-order.service.ts` và nhánh `SUPPLIER_ACCEPT_ORDER` của `src/modules/account-lifecycle/intake-access.service.ts`; ghi ranh giới kiểm tra trước/sau reload và protocol khóa vào `specs/supplier-order-intake/plan.md`, không thay quyền/scope SCHOOL/SYSTEM tại `src/utils/resource-access.ts`.
- [x] T005 Xác nhận các file unit đã đăng ký trong `package.json` và harness `tests/authorization.integration.test.ts`, `tests/account-lifecycle.integration.test.ts`; ghi điều kiện instance disposable local/ủy quyền, fixture riêng, không đọc lộ credentials và không tự chạy integration khi thiếu prerequisite vào `specs/supplier-order-intake/quickstart.md`.

**Checkpoint**: Hợp đồng, ranh giới quyền/giao dịch và cách kiểm chứng đã rõ. Hoàn thành T001–T005 trước khi thực hiện các story.

## Phase 3: User Story 1 — Xem yêu cầu đã gửi (Priority: P1) — MVP danh sách

**Goal**: Admin/staff xem danh sách đúng nhà cung cấp, không có DRAFT, lọc trạng thái và phân trang.

**Independent Test**: Với hai nhà cung cấp và đủ trạng thái, cả hai role A chỉ thấy năm trạng thái hợp lệ của A; filter/page chính xác; thiếu view bị chặn; SCHOOL/SYSTEM giữ hợp đồng cũ.

### Tests

- [x] T006 [P] [US1] Bổ sung test validation, service/HTTP và repository query cho list trong `tests/supply-order-intake.test.ts`: hai role, role/org/membership sai, thiếu view, strict query, status DRAFT/lạ, giới hạn page/limit/offset, WHERE supplier scope không bị ghi đè, ẩn DRAFT, limit+1/id asc, empty/last page, projection/date/null và lỗi dependency được che; viết kỳ vọng mới trước implementation và điều chỉnh fake theo giao diện T003.
- [x] T007 [P] [US1] Bổ sung regression tại `tests/modules.test.ts` cho GET SCHOOL/SYSTEM: quyền và scope hiện hành, trường vẫn thấy DRAFT của mình, tám field cũ, pagination cũ; status vẫn bị 400 ở hai nhánh, không mở rộng quyền xem ngầm.

### Implementation

- [x] T008 [US1] Mở rộng `src/modules/supply-order/supply-order.validation.ts` với optional status năm giá trị đã gửi, strict query và giới hạn phân trang hiện có; cập nhật Request DTO bằng z.infer/type-only import tại `src/modules/supply-order/supply-order.request.dto.ts`, không tự viết lại cấu trúc input.
- [x] T009 [P] [US1] Định nghĩa DTO supplier list mở rộng an toàn trong `src/modules/supply-order/supply-order.response.dto.ts`: schoolName, requestedDeliveryDate, sentAt cùng field/pagination cũ; giữ DTO legacy và receipt không đổi theo hợp đồng T003.
- [x] T010 [US1] Mở rộng nhánh truy vấn supplier list tại `src/modules/supply-order/supply-order.repository.ts`: scope tin cậy kết hợp tập trạng thái ngoài DRAFT và status tùy chọn, School id/name cùng field được phép, id asc/limit+1; không thêm điều kiện sentAt khác null, không N+1 và giữ query/projection legacy.
- [x] T011 [US1] Hoàn thiện `getAll` tại `src/modules/supply-order/supply-order.service.ts`: supplier kiểm tra hai role/org/membership/view, tái sử dụng listScopes, truyền filter/scope cho repository và map DTO/date-only/timestamp/null tường minh; SCHOOL/SYSTEM giữ hành vi cũ và từ chối status; service không dựng Prisma args.
- [x] T012 [US1] Tích hợp validation/service list trong `src/modules/supply-order/supply-order.controller.ts`, giữ middleware và GET mount tại `src/modules/supply-order/supply-order.routes.ts`; controller không import DTO, giữ sendSuccess/error envelope.
- [x] T013 [US1] Chạy kiểm chứng US1 trong `tests/supply-order-intake.test.ts` và `tests/modules.test.ts` bằng tsx/Node test runner, sửa lỗi thuộc phạm vi và ghi lệnh/kết quả thật vào `specs/supplier-order-intake/quickstart.md`; chỉ công nhận checkpoint khi assertions list và regression đã pass.

**Checkpoint**: FR-001–005, FR-014–015 cho danh sách được đáp ứng; US1 là MVP đọc có ích, chưa thay thế toàn bộ luồng tiếp nhận yêu cầu.

## Phase 4: User Story 2 — Xem chi tiết trước khi nhận (Priority: P1)

**Goal**: Xem trường gửi, ngày giao, ghi chú, đủ dòng nguyên liệu và thông tin người/thời điểm nhận.

**Independent Test**: Mở đơn nhiều dòng bằng cả hai role; số lượng/đơn vị khớp dữ liệu lưu, Decimal không mất chính xác, inactive không mất dòng; DRAFT/khác supplier/không tồn tại trả 404.

### Tests

- [x] T014 [US2] Bổ sung tests detail tại `tests/supply-order-intake.test.ts`: UUID/query strict, hai role và view permission, ngoài scope/DRAFT 404, select chỉ field cho phép, mọi dòng gồm inactive, thứ tự id asc, Decimal lớn/chính xác, date-only/timestamp/null, receipt lịch sử thiếu thông tin, không lộ contractSnapshot/email/phone/credentials và dependency failures.

### Implementation

- [x] T015 [US2] Thêm params/query validation chi tiết dùng UUID chung và strict empty query trong `src/modules/supply-order/supply-order.validation.ts`; thêm Request DTO suy ra schema tại `src/modules/supply-order/supply-order.request.dto.ts`, giữ schema accept hiện hành tương thích.
- [x] T016 [P] [US2] Thêm supplier detail Response DTO vào `src/modules/supply-order/supply-order.response.dto.ts`: list fields, note, acceptedByUserId và items chứa id/ingredientEntryId/ingredientName/requestedQuantity/unit/note; không đưa hồ sơ User hoặc contractSnapshot vào output.
- [x] T017 [US2] Thêm repository detail trong `src/modules/supply-order/supply-order.repository.ts` lọc id + trusted supplierId + trạng thái ngoài DRAFT, select School và items -> IngredientEntry -> Ingredient, order items id asc; không lọc ACTIVE entry/ingredient, không truy vấn tài khoản người nhận.
- [x] T018 [US2] Thêm service detail tại `src/modules/supply-order/supply-order.service.ts`, kiểm tra hai role/org/membership/view và trả 404 thống nhất khi thiếu bản ghi; map toàn bộ DTO allowlist, Decimal.toString, date-only/ISO/null, lấy unit từ dòng yêu cầu, không tự bổ sung lịch sử thiếu.
- [x] T019 [US2] Thêm controller detail tại `src/modules/supply-order/supply-order.controller.ts` và GET `/:id` trong `src/modules/supply-order/supply-order.routes.ts`; validate params/query, gọi service và response helpers, giữ route `/api/supply-requests/:id/contract-evidence` ở module supplier-onboarding hoạt động như cũ.
- [x] T020 [US2] Bổ sung fixture và kịch bản đọc thực tại `tests/authorization.integration.test.ts` bằng harness hiện có: admin/staff A xem được đơn A, B không xem được, DRAFT bị che, thiếu view bị chặn, đủ dòng và serialization; chỉ viết fixture trong database mới của harness, chưa chạy khi chưa có prerequisite.
- [x] T021 [US2] Chạy unit/HTTP detail từ `tests/supply-order-intake.test.ts`, kiểm tra không hồi quy US1 và ghi kết quả thật vào `specs/supplier-order-intake/quickstart.md`; không dùng mock để kết luận integration PostgreSQL đã pass.

**Checkpoint**: FR-006–007 cùng bảo vệ quyền/phạm vi cho chi tiết được đáp ứng; có thể kiểm chứng US2 riêng bằng ID đơn thử đã có.

## Phase 5: User Story 3 — Xác nhận tiếp nhận (Priority: P1)

**Goal**: Cả admin/staff nhận SENT đúng một lần, giữ receipt đầu tiên, tuân thủ intake/quyền hiện hành.

**Independent Test**: Mỗi role nhận đơn SENT riêng; nhận lại và hai người nhận cùng đơn không đổi receipt đầu tiên; pause/deactivation/thu quyền/người ngoài scope không tạo ghi không hợp lệ.

### Tests

- [x] T022 [P] [US3] Mở rộng service/HTTP tests tại `tests/supply-order-intake.test.ts` cho hai role, accept độc lập view, role lạ dù có quyền, scope thay đổi sau guard, DRAFT 404 thay kỳ vọng 409 cũ, COMPLETED/CANCELLED 409, strict empty body/query, receipt bốn field và người khác cùng supplier nhận lại không đổi actor/time/updatedAt; kiểm tra guard/read/write cùng tx, conditional update và rollback qua failure injection.
- [x] T023 [P] [US3] Mở rộng `tests/intake-access.test.ts` cho role allowlist trước/sau reload, DRAFT 404 ở resolve và reread, thu quyền/đổi role/org/membership, supplier PAUSED và admin hai bên DEACTIVATED chặn SENT; school PAUSED không chặn nhận, receipt ACCEPTED/IN_PROGRESS vẫn trả sau kiểm tra quyền dù intake/admin đã đổi; giữ assertions lock order và các operation khác.

### Implementation

- [x] T024 [US3] Sửa riêng nhánh `SUPPLIER_ACCEPT_ORDER` trong `src/modules/account-lifecycle/intake-access.service.ts`: role/org/membership/permission hiện hành sau reload, che DRAFT bằng 404 ở lần đọc đầu và sau khóa trước lỗi trạng thái, giữ nhánh receipt trước intake/admin checks; không thay guard create/send/receive hoặc giao thức khóa.
- [x] T025 [US3] Rà soát và hoàn thiện `findForSupplier`/`accept` trong `src/modules/supply-order/supply-order.repository.ts` theo hợp đồng T003: WHERE giữ id + supplierId, update thêm status SENT, ghi status/actor/time một lần và dùng tx được truyền vào; không mở transaction riêng hoặc trả dữ liệu nhạy cảm.
- [x] T026 [US3] Hoàn thiện `accept` trong `src/modules/supply-order/supply-order.service.ts`: kiểm tra hai role trước tx và actor do guard trả lại, giữ authorizationTransaction/retry, DRAFT 404 ở tầng service nếu cần phòng vệ, SENT -> ACCEPTED nguyên tử, receipt cũ không ghi và map đúng bốn field; không yêu cầu view permission hoặc thêm nghiệp vụ giao hàng/tồn kho.
- [x] T027 [US3] Rà soát tích hợp POST trong `src/modules/supply-order/supply-order.controller.ts`, `src/modules/supply-order/supply-order.validation.ts` và `src/modules/supply-order/supply-order.routes.ts`; giữ absent body/{} hợp lệ, từ chối null/array/field lạ và query lạ, dùng lỗi tiếng Việt/envelope cũ, cập nhật duy nhất chỗ lệch hợp đồng.
- [x] T028 [US3] Bổ sung integration hai tài khoản admin/staff nhận cùng một SENT trong `tests/authorization.integration.test.ts`: chỉ một receipt đầu tiên, cả hai kết quả nhất quán, retry không ghi lại và lỗi sau update rollback toàn bộ; dùng barrier/khóa xác định, không dựa vào sleep ngẫu nhiên hoặc mock để chứng minh PostgreSQL concurrency.
- [x] T029 [US3] Tái sử dụng và bổ sung khi còn thiếu các race accept với pause/deactivate/thu quyền/đổi membership tại `tests/account-lifecycle.integration.test.ts`; dùng cùng thứ tự khóa/Serializable retry, chứng minh trạng thái đã commit trước lần xác minh cuối ngăn nhận mới; regression create/send/receive và retry receipt vẫn đúng.
- [x] T030 [US3] Bổ sung kịch bản fixture giao dịch đổi CANCELLED cạnh tranh với accept tại `tests/authorization.integration.test.ts` theo protocol khóa hiện có; kiểm tra thứ tự CANCELLED thắng khiến nhận bị từ chối, không có ghi nhận dở dang; không tạo endpoint hủy hoặc thay vòng đời hiện hành.
- [x] T031 [US3] Chạy unit/HTTP và guard tests trong `tests/supply-order-intake.test.ts`, `tests/intake-access.test.ts`, ghi kết quả từng nhóm vào `specs/supplier-order-intake/quickstart.md`; sửa failure có liên quan và kiểm tra nhánh shared guard không hồi quy.
- [x] T032 [US3] Khi instance PostgreSQL disposable local đã được chọn và ủy quyền rõ ràng, chạy `npm run test:authorization` và `npm run test:account-lifecycle:integration` cho `tests/authorization.integration.test.ts`, `tests/account-lifecycle.integration.test.ts`, sửa lỗi và ghi kết quả vào `specs/supplier-order-intake/quickstart.md`; nếu thiếu prerequisite, để task chưa hoàn thành và ghi lý do, không chuyển sang DB thành viên/Azure.
- [x] T033 [US3] Đối chiếu kịch bản hai role list -> detail -> accept -> detail/retry trong `specs/supplier-order-intake/quickstart.md` với kết quả HTTP tự động và integration đã chạy; bổ sung kiểm chứng còn thiếu trong `tests/authorization.integration.test.ts`, ghi rõ coverage thực tế và không khẳng định SC-003/FR-012 đã chứng minh trên PostgreSQL nếu T032 chưa pass.

**Checkpoint**: FR-008–013 được kiểm chứng; chỉ kết luận concurrency thực khi integration chạy thành công, không đánh dấu hoàn thành toàn bộ feature nếu còn prerequisite T032.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Tài liệu, regression và bằng chứng cuối cùng cho toàn bộ tính năng.

- [x] T034 [P] Cập nhật matrix đọc/tiếp nhận và quy tắc hai role, quyền độc lập, che DRAFT, receipt retry tại `docs/AUTHORIZATION.md`; phân biệt GET chung SCHOOL/SYSTEM với chi tiết/tiếp nhận supplier, giữ các quyền hiện hành.
- [x] T035 [P] Cập nhật ownership/mapping ba thao tác `/api/supply-requests` tại `src/modules/README.md`, mô tả các field/filter supplier được bổ sung và đường dẫn chính xác, không dùng tiền tố supplier-onboarding hoặc supply-orders.
- [x] T036 Rà soát regression trong `tests/modules.test.ts`, `tests/authorization.test.ts`, `tests/supplier-onboarding.test.ts`, `tests/account-lifecycle.test.ts` và `tests/intake-access.test.ts`; cập nhật fake/type fixtures nếu contract repository/service mở rộng, bổ sung assertions còn thiếu để giữ SCHOOL/SYSTEM scope/projection, tạo/gửi đơn, contract-evidence và các operation guard khác.
- [x] T037 Rà soát các file đã thay đổi trong `src/modules/supply-order/` và `src/modules/account-lifecycle/intake-access.service.ts` theo `AGENTS.md`: DTO chỉ service dùng, Request DTO suy từ strict Zod, repository không import DTO, service không dựng Prisma args, safe projection/serialization, shared tx và không thay schema/quyền/cache ngoài phạm vi; sửa lỗi thực tế được tìm thấy.
- [x] T038 Chạy `npm run validate` và `npm run test:unit` từ repository root sau các thay đổi cuối, sửa lỗi liên quan và ghi từng kết quả thật vào `specs/supplier-order-intake/quickstart.md`; kiểm tra `package.json` vẫn bao gồm mọi file unit mới nếu có, không coi integration chưa chạy là pass.
- [x] T039 Rà soát `specs/supplier-order-intake/spec.md`, `plan.md`, `tasks.md` và `contracts/supply-requests.md` với implementation; xác minh đủ FR-001–015/SC-001–005, liên kết/định dạng hợp lệ, ghi hạn chế còn lại và cập nhật checkbox chỉ cho task thực sự hoàn tất trong `specs/supplier-order-intake/tasks.md`.
- [x] T040 Kiểm tra diff cuối và trạng thái quality/integration trong `specs/supplier-order-intake/quickstart.md`; xác nhận chỉ file thuộc phạm vi, không có generated output/credential/`.specify/feature.json` được đưa vào commit, không tự stage thay đổi người dùng; ghi báo cáo sẵn sàng review và task còn chặn nếu có vào `specs/supplier-order-intake/quickstart.md`.

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup T001–T002
    -> Foundational T003–T005
        -> US1 T006–T013 -> US2 T014–T021
        -> US3 guard lane T023–T024
US1/US2 hoàn tất các file module -> US3 T022, T025–T033
    -> Polish T034–T040
```

US2/US3 có thể kiểm chứng nghiệp vụ riêng với ID đơn thử có sẵn; thứ tự module US1 -> US2 -> US3 nhằm tránh cùng sửa service/repository/DTO/tests. Không có dependency nghiệp vụ yêu cầu phải gọi list hoặc detail trước accept. Guard lane độc lập có thể chạy sớm sau foundation.

### Task Dependencies

| Nhóm                                          | Dependency / thứ tự bắt buộc                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| T001–T005                                     | Tuần tự setup rồi foundation; bàn giao hợp đồng trước sửa source.                                    |
| T006 + T007                                   | Song song sau T005, khác file; giữ test mới thể hiện failure trước triển khai nếu có thể.            |
| T008 + T009                                   | Sau khi chốt hợp đồng và viết tests; khác file có thể song song.                                     |
| T010 -> T011 -> T012 -> T013                  | DTO/schema sẵn sàng, repository trước service rồi HTTP/kiểm chứng.                                   |
| T014 -> (T015 + T016) -> T017 -> T018 -> T019 | Sau US1 để không chồng file; schema và response DTO có thể làm song song.                            |
| T020 -> T021                                  | Sau detail có thể gọi; integration file chỉ một owner, chạy unit sau tích hợp.                       |
| T023 -> T024                                  | Có thể bắt đầu sau T005, giữ tests/intake-access và guard cùng một owner; không cần chờ US1/US2.     |
| T022 -> T025 -> T026 -> T027                  | Sau module edits US1/US2; T026 còn phụ thuộc T024.                                                   |
| T028 + T029                                   | Sau tiếp nhận được tích hợp, khác file có thể song song; T028 sau T020 vì chung file.                |
| T030 -> T031 -> T032 -> T033                  | T030 sau T028 vì chung file; T031 sau T022–T030; T032 cần prerequisite DB; T033 sau kiểm chứng.      |
| T034 + T035                                   | Sau ba hợp đồng thực thi ổn định, khác file có thể song song.                                        |
| T036 -> T037 -> T038 -> T039 -> T040          | Sau story implementation; quality sau sửa cuối; không công nhận feature complete nếu T032 còn thiếu. |

T032 thiếu hạ tầng không ngăn các việc độc lập T034–T038 tiến hành; T039–T040 phải ghi đúng tình trạng còn chặn và không báo hoàn tất toàn bộ.

### File Ownership When Parallelizing

| Lane                         | File được giao độc quyền                                                                                                                                                                                                   | Bàn giao                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A — Data contract/repository | `src/modules/supply-order/supply-order.validation.ts`, `supply-order.request.dto.ts`, `supply-order.response.dto.ts`, `supply-order.repository.ts`                                                                         | Schema/DTO/method đã thống nhất cho C; T027 phần validation do A thực hiện hoặc chuyển owner rõ ràng. |
| B — Intake guard             | `src/modules/account-lifecycle/intake-access.service.ts`, `tests/intake-access.test.ts`                                                                                                                                    | T023–T024 và guard regression; không sửa module supply-order.                                         |
| C — Orchestration/HTTP       | `src/modules/supply-order/supply-order.service.ts`, `supply-order.controller.ts`, `supply-order.routes.ts`, `tests/supply-order-intake.test.ts`                                                                            | Dùng hợp đồng A, guard B; service/HTTP sau repository tương ứng.                                      |
| Người tích hợp               | `tests/modules.test.ts`, `tests/authorization.test.ts`, `tests/supplier-onboarding.test.ts`, `tests/authorization.integration.test.ts`, `tests/account-lifecycle.integration.test.ts`, docs/spec và `package.json` nếu cần | Quản lý integration fixture, chất lượng cuối và bằng chứng.                                           |

Mỗi file chỉ một người sửa tại một thời điểm, kể cả task thuộc story khác. Không chia song song theo story khi chúng dùng chung file; phải bàn giao hoặc chờ task trước. Đây là chỉ dẫn phân công khi implement, không phải yêu cầu spawn agent trong bước tạo tasks.

## Parallel Example: User Story 1

Sau T005: T006 viết list contract/query tests tại `tests/supply-order-intake.test.ts` song song T007 viết legacy regression tại `tests/modules.test.ts`. Sau hai task, T008 schema/Request DTO song song T009 Response DTO; T010–T013 theo dependency.

## Parallel Example: User Story 2

Sau US1 và T014: T015 schema/Request DTO song song T016 Response DTO. Khi giao diện repository T017 đã bàn giao, C thực hiện T018–T019; người tích hợp thực hiện T020 sau endpoint sẵn sàng. Không giao cùng test file cho hai người.

## Parallel Example: User Story 3

Sau T005, B có thể làm T023–T024 trong lúc A/C triển khai US1/US2. Sau code nhận đơn sẵn sàng, T028 ở `tests/authorization.integration.test.ts` song song T029 ở `tests/account-lifecycle.integration.test.ts`; T030 chờ T028 vì sửa cùng file. Chỉ chạy T032 sau kiểm tra prerequisite, không chạy hai suite DB song song nếu harness chưa bảo đảm độc lập.

## Implementation Strategy

### MVP First

Hoàn thành setup/foundation và US1: admin/staff có danh sách đúng phạm vi, lọc trạng thái, không thấy nháp. Xác minh checkpoint đọc; đây là MVP đầu tiên để review. Không coi US1 là hoàn tất yêu cầu tiếp nhận đầy đủ của người dùng.

### Incremental Delivery

Tiếp tục US2 để xem đủ nội dung đơn, rồi US3 để nhận đúng quyền và nhất quán. Kiểm chứng từng phần, giữ regression đã có; hoàn thành polish và integration trước khi kết luận đủ tính năng. Việc deploy/merge không thuộc các task này.

## Requirement Coverage

| Yêu cầu    | Tasks chính                                              |
| ---------- | -------------------------------------------------------- |
| FR-001–003 | T006–T012, T014–T019, T022–T027                          |
| FR-004–005 | T006–T013                                                |
| FR-006–007 | T014–T021, T022, T026                                    |
| FR-008–011 | T022–T027, T029–T031                                     |
| FR-012–013 | T023–T026, T028–T033                                     |
| FR-014–015 | T007, T012, T019, T027, T034–T040                        |
| SC-001     | US1–US3, T033                                            |
| SC-002     | T006–T007, T014, T020, T022–T024                         |
| SC-003     | T022–T026, T028–T033; kết luận PostgreSQL phụ thuộc T032 |
| SC-004     | T014, T017–T021                                          |
| SC-005     | T022–T032                                                |

## Notes

- Tổng cộng 40 task: setup/foundation 5, US1 8, US2 8, US3 12, polish 7.
- Không có `.specify/extensions.yml` khi tạo tasks; không có before_tasks/after_tasks hook cần chạy.
- Implementation đã hoàn tất. Validate PASS, unit/HTTP 511/511, authorization PostgreSQL 46/46, lifecycle PostgreSQL 25/25; PostgreSQL tạm đã dọn, không ghi DB thành viên/Azure. Xem quickstart.md để tái kiểm chứng.
