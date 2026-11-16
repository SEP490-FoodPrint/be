# Tasks: Đổi trạng thái ẩn/hiện nguyên liệu nhà cung cấp

**Input**: Design documents from `specs/ingredient-change-status/`

**Prerequisites**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contract](contracts/ingredient-status-api.md), [quickstart.md](quickstart.md).

**Branch**: `feat/ingredient-change-status`

**Tests**: Các task kiểm chứng phục vụ acceptance scenarios và SC-001–005 trong spec, theo validation design của plan. Mở rộng Node test runner hiện có; viết các trường hợp mới trước phần triển khai tương ứng và xác nhận chúng phát hiện hành vi chưa được đáp ứng. Không thêm framework hoặc file test mới.

**Organization**: Ba user story theo thứ tự P1, P1, P2; mọi task dưới đây chưa thực hiện. Chạy kiểm thử ghi PostgreSQL chỉ khi có ủy quyền cho instance local và các database tạm của lần chạy; nếu thiếu điều kiện, giữ task chạy integration chưa hoàn tất và ghi blocker cụ thể.

## Format: `[ID] [P?] [Story] Description`

- `[P]`: Có thể làm song song với task ở file khác sau khi các phụ thuộc đã hoàn tất; xem bảng phụ thuộc bên dưới.
- `[US1]`, `[US2]`, `[US3]`: Ánh xạ user story trong spec.
- Đường dẫn là tương đối từ root repository.

## Phase 1: Setup

**Purpose**: Xác nhận đúng tính năng và công cụ hiện có trước khi sửa code.

- [x] T001 Đối chiếu nhánh và bộ tài liệu `specs/ingredient-change-status/spec.md`, `plan.md`, `contracts/ingredient-status-api.md`; kiểm tra phiên bản từ `.nvmrc`, `package.json` và Prisma Client sẵn có; ghi prerequisite thiếu vào `specs/ingredient-change-status/quickstart.md`, chỉ cài dependency/sinh client nếu cần, không kết nối hay sửa DB.

## Phase 2: Foundational

**Purpose**: Chuẩn bị fixture chung cho ba story bằng hạ tầng kiểm thử hiện có.

- [x] T002 Mở rộng fixture trong `tests/ingredient-management.test.ts` để cấu hình trạng thái ban đầu ACTIVE/INACTIVE, theo dõi actor hiện tại, scope, thứ tự gọi, tx và số lần mutation; giữ các test thêm/sửa/upload hiện có hoạt động, không coi timestamp giả trong fixture là bằng chứng cho PostgreSQL.

**Checkpoint**: Hợp đồng status đã chốt; fixture sẵn sàng. Tái sử dụng `ingredientManagementScope`, helper `write`, `authorizationTransaction`, schema và Response DTO hiện có; không tạo hạ tầng auth hoặc model mới.

## Phase 3: User Story 1 — Một thao tác cho cả ẩn và hiện (Priority: P1)

**Goal**: Thay route hide bằng PATCH status, đặt đúng trạng thái đích và xử lý yêu cầu lặp.

**Independent Test**: Với admin hợp lệ và nguyên liệu của mình, dùng cùng route để ACTIVE → INACTIVE → ACTIVE; GET đọc lại đúng trạng thái; lặp cả hai đích không mutation hoặc đổi timestamp; route hide cũ không còn handler.

### Tests for User Story 1

- [x] T003 [US1] Chuyển các test hide trong `tests/ingredient-management.test.ts` sang changeStatus; bổ sung validator/HTTP cho hai trạng thái, body thiếu/{}/null/array, enum sai/chữ thường/khoảng trắng/sai kiểu, trường thừa và UUID sai; thêm service no-op không gọi mutation, repository guard id/supplierId/status khác đích, data chỉ status, DTO/envelope ISO an toàn và GET đọc lại; đăng ký notFoundHandler để chứng minh POST hide hợp lệ trả 404 và không ghi.
- [x] T004 [P] [US1] Chuyển caller hide trong scenario CRUD của `tests/authorization.integration.test.ts` sang PATCH status; thêm kỳ vọng hai chiều, mở nguyên liệu legacy INACTIVE, gửi lặp cả hai trạng thái giữ updatedAt thực và dữ liệu đọc lại; chỉ viết scenario ở bước này, chưa chạy DB.

### Implementation for User Story 1

- [x] T005 [P] [US1] Thay ingredientHideSchema/validateIngredientHide bằng ingredientChangeStatusSchema/validateIngredientChangeStatus trong `src/modules/ingredient/ingredient.validation.ts`: z.strictObject với status enum ACTIVE/INACTIVE bắt buộc, thông báo tiếng Việt đúng contract, dùng parseRequest, không default/trim/coerce/toggle và giữ validator params hiện có.
- [x] T006 [US1] Thay IngredientHideRequest bằng IngredientChangeStatusRequest trong `src/modules/ingredient/ingredient.request.dto.ts`, suy bằng z.infer từ schema qua type-only import; giữ file Response DTO và hợp đồng các Request DTO khác.
- [x] T007 [P] [US1] Thay hide bằng changeStatus(scope, id, status, tx) trong `src/modules/ingredient/ingredient.repository.ts`; dùng type trạng thái nội bộ, updateMany WHERE id + supplierId + status khác đích, data chỉ status, đọc lại bằng find cùng tx; không import DTO và không mở transaction riêng.
- [x] T008 [US1] Thay hide bằng changeStatus trong `src/modules/ingredient/ingredient.service.ts`; nhận DTO mới, đi qua helper write hiện có để recheck actor/quyền/membership/supplier; khóa và đọc target theo scope trong cùng tx, trả dto hiện tại khi cùng đích, chỉ gọi repo.changeStatus khi khác; giữ 404 chung và mapper allowlist, chỉ hoàn tất sau commit.
- [x] T009 [US1] Thay controller.hide bằng controller.changeStatus trong `src/modules/ingredient/ingredient.controller.ts`; validate params/body, lấy requirePrincipal, gọi service, sendSuccess HTTP 200 với message “Đổi trạng thái nguyên liệu thành công”; không import DTO và giữ asyncHandler.
- [x] T010 [US1] Thay đăng ký POST /:ingredientId/hide bằng PATCH /:ingredientId/status trong `src/modules/ingredient/ingredient.routes.ts`, dùng controller.changeStatus sau middleware management hiện có; không alias, restore route hoặc redirect.
- [x] T011 [US1] Chuyển caller /ingredients/management/:id/hide trong `tests/supplier-onboarding.integration.test.ts` sang PATCH /status với body status INACTIVE, giữ các assertion lựa chọn/hồ sơ hiện có; không chạy suite legacy trực tiếp vì chưa có cơ chế manifest cleanup của wrapper.
- [x] T012 [US1] Chạy `npm exec --no -- tsx --test tests/ingredient-management.test.ts` sau khi hoàn tất T003–T011; sửa lỗi thuộc story và ghi kết quả thực tế vào `specs/ingredient-change-status/quickstart.md`, không báo các integration mới đã pass nếu chưa chạy.

**Checkpoint**: US1 có thể demo hai chiều và gửi lặp bằng HTTP fixture. Luồng production đã kế thừa đầy đủ quyền ngay từ T008; US2 là kiểm chứng riêng các ranh giới quyền, không phải bước bổ sung quyền sau khi mở endpoint.

## Phase 4: User Story 2 — Đúng quyền và phạm vi sở hữu (Priority: P1)

**Goal**: Chứng minh cả chuyển thật và no-op đều tuân theo quyền hiện tại và cô lập supplier.

**Independent Test**: Admin A chỉ tác động nguyên liệu A; staff/System Admin/thiếu quyền/supplier không ACTIVE bị từ chối. Principal cũ sau khi quyền hoặc membership thay đổi không thực hiện được chuyển trạng thái hoặc no-op.

### Tests and Integration for User Story 2

- [x] T013 [US2] Mở rộng ma trận service/HTTP trong `tests/ingredient-management.test.ts` cho cả trạng thái đích và no-op: staff dù có manage, System Admin, thiếu permission, tổ chức/membership sai, supplier INACTIVE và chưa đăng nhập; xác nhận 401/403 phù hợp, không gọi mutation và không có bypass.
- [x] T014 [P] [US2] Bổ sung kiểm thử login/quyền thật trong `tests/authorization.integration.test.ts` cho cả ẩn/hiện: admin A với target A/B, UUID không tồn tại, staff dù có manage, System Admin, account/supplier không ACTIVE; so cùng 404/message của target B và target không tồn tại, xác nhận dữ liệu không đổi.
- [x] T015 [US2] Bổ sung kiểm thử principal cũ trong `tests/ingredient-management.test.ts`: repo.actor trả role/quyền/membership mới, scope supplier đổi hoặc load actor từ chối tài khoản không ACTIVE; kiểm tra cả chuyển thật và cùng đích đều bị chặn trước mutation, các recheck/lock/read/write hợp lệ dùng cùng tx.
- [x] T016 [US2] Bổ sung kiểm thử service với principal cũ và dữ liệu quyền thật trong `tests/authorization.integration.test.ts`: thu hồi grant hoặc thêm denial, đổi membership/role hoặc ngừng tài khoản sau lúc lấy principal; gọi changeStatus cho chuyển thật và no-op, xác nhận từ chối và khôi phục fixture trong DB tạm để không ảnh hưởng scenario sau.
- [x] T017 [US2] Chạy lại `npm exec --no -- tsx --test tests/ingredient-management.test.ts` cho các trường hợp T013/T015; nếu regression phát hiện sai luồng, sửa trong `src/modules/ingredient/ingredient.service.ts` hoặc `ingredient.repository.ts` theo helper/scope hiện có, không mở rộng quyền; ghi kết quả vào `specs/ingredient-change-status/quickstart.md`.

**Checkpoint**: Toàn bộ kỳ vọng quyền/cô lập đã được mã hóa; unit có kết quả thực tế. Các case PostgreSQL chờ task chạy có quản lý ở Phase 6.

## Phase 5: User Story 3 — Bảo toàn dữ liệu và lịch sử (Priority: P2)

**Goal**: Ẩn/hiện nhiều lần giữ định danh, nội dung, quan hệ; lựa chọn mới phản ánh trạng thái và các điều kiện liên quan; cạnh tranh không làm mất dữ liệu.

**Independent Test**: Thực hiện ít nhất ba chu kỳ trên nguyên liệu có danh mục, ảnh và lịch sử; so mọi trường ngoài status/updatedAt cùng các liên kết. Kiểm tra lựa chọn khi ẩn/hiện và các yêu cầu cạnh tranh có thứ tự ghi quan sát được.

### Tests and Integration for User Story 3

- [x] T018 [US3] Mở rộng kiểm thử trong `tests/ingredient-management.test.ts` cho ít nhất ba chu kỳ, DTO giữ nội dung và thứ tự ảnh, no-op không mutation, PATCH thông tin giữ status INACTIVE và tiếp tục từ chối trường status; kiểm tra repository chỉ ghi status, không chạm category/ảnh/owner hay dữ liệu liên quan.
- [x] T019 [P] [US3] Bổ sung fixture thật có danh mục, ảnh và IngredientEntry cùng liên kết nghiệp vụ trong `tests/authorization.integration.test.ts`; chạy ít nhất ba chu kỳ, đối chiếu id/owner/createdAt/nội dung/liên kết và số bản ghi, xác nhận updatedAt chỉ cập nhật khi đổi thật và hồ sơ liên quan không tự đổi trạng thái.
- [x] T020 [US3] Bổ sung scenario SCHOOL GET ingredients và menu options main/seasoning trong `tests/authorization.integration.test.ts`: supplier/quan hệ/entry hợp lệ thì ẩn làm biến mất và hiện lại làm xuất hiện; quản trị vẫn thấy cả hai; entry/quan hệ không ACTIVE không tự bật khi hiện lại ingredient; giữ bộ lọc hiện có, không thêm lọc ACTIVE toàn cục.
- [x] T021 [US3] Bổ sung race cùng đích ở cả hai trạng thái, khác đích và status song song PATCH mô tả trong `tests/authorization.integration.test.ts`, dùng barrier/helper hiện có với thứ tự ghi kiểm soát hoặc quan sát được; kiểm tra trạng thái cuối, mô tả không mất và không bản sao, không suy commit từ thứ tự HTTP response hoặc dùng sleep để định thứ tự.
- [x] T022 [US3] Bổ sung fault injection repository trong transaction thật vào `tests/authorization.integration.test.ts` để chứng minh lỗi trước commit rollback đầy đủ và trả lỗi an toàn; kiểm tra retry qua helper hiện có và 503 khi hết retry, không thêm transaction/retry production độc lập hoặc làm lộ driver/query.
- [x] T023 [US3] Chạy lại test file `tests/ingredient-management.test.ts` sau T018, rà soát assertion bảo toàn và PATCH semantics; ghi kết quả và danh sách integration cần chạy vào `specs/ingredient-change-status/quickstart.md`, không thay schema hoặc các bộ lọc đọc để làm test pass trái hợp đồng.

**Checkpoint**: Tất cả acceptance scenarios và SC-001–005 đã có kiểm chứng tương ứng; kết quả PostgreSQL thực được xác nhận tại T028.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Đồng bộ tài liệu, caller và thực hiện quality gate sau khi ba story hoàn tất phần code/tests.

- [x] T024 [P] Cập nhật mục quản trị nguyên liệu trong `docs/AUTHORIZATION.md` sang PATCH status, body hai giá trị, quyền, no-op và 404 target; dẫn `specs/ingredient-change-status/contracts/ingredient-status-api.md` và ghi rõ contract mới thay phần hide trước đây.
- [x] T025 [P] Cập nhật `src/modules/README.md` mô tả ẩn/hiện qua một endpoint status và loại bỏ khẳng định không thể bật lại; dẫn contract mới, nêu giữ lịch sử và PATCH thông tin không tự đổi status.
- [x] T026 Rà soát `src/modules/ingredient/`, `tests/ingredient-management.test.ts`, `tests/authorization.integration.test.ts`, `tests/supplier-onboarding.integration.test.ts` để không còn symbol/caller hide cũ ngoài negative test chứng minh route đã bỏ; kiểm tra response safe projection và import phân lớp; ghi hướng dẫn client ngoài repo đổi route trong `specs/ingredient-change-status/quickstart.md`, giữ spec 008 là lịch sử.
- [x] T027 Chạy `npm run validate` và `npm run test:unit` theo `package.json`, xác nhận test ingredient-management đã nằm trong test:unit; chỉ sửa lỗi liên quan và format file thay đổi, ghi kết quả thật và lỗi nền nếu có vào `specs/ingredient-change-status/quickstart.md`.
- [ ] T028 Khi đã có ủy quyền ghi các DB tạm trên instance được chọn, chạy `npm run test:local:check` rồi `npm run test:local:authorization` cho `tests/authorization.integration.test.ts` qua `tests/helpers/run-local-tests.ts`; dùng .env.test.local và Redis test hiện có, ghi kết quả, xác nhận cleanup theo manifest vào `specs/ingredient-change-status/quickstart.md`; thiếu điều kiện thì ghi blocked và để task chưa hoàn tất, không tự chạy suite legacy hoặc đổi sang DB ứng dụng/Azure.
- [x] T029 Đối chiếu coverage FR-001–013 và SC-001–005 với kết quả thực tế; chạy Prettier check cho bộ `specs/ingredient-change-status/`, rà soát gate spec theo `.github/scripts/spec-gate.mjs` và phạm vi diff; cập nhật evidence trong `specs/ingredient-change-status/quickstart.md` cùng trạng thái task tại `specs/ingredient-change-status/tasks.md`, không đánh dấu hoàn tất task chưa chạy hoặc còn blocker.

## Dependencies & Execution Order

### Phase dependencies

```text
T001 Setup
  → T002 Foundational
    → US1 (T003–T012)
      → US2 (T013–T017)
        → US3 (T018–T023)
          → Polish (T024–T029)
```

Thực hiện mặc định theo thứ tự trên vì cả ba story dùng cùng module và hai file tests. US2/US3 có thể kiểm chứng độc lập trên endpoint US1 đã triển khai, không cần xây endpoint hoặc UI riêng. Không tách phát hành US1 khỏi các yêu cầu quyền và bảo toàn dữ liệu đã xác nhận.

### Task dependencies within phases

| Nhóm          | Thứ tự bắt buộc / cơ hội song song                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Chuẩn bị      | T001 → T002                                                                                                                                 |
| US1 — test    | T003 và T004 có thể viết song song sau T002 vì khác file; các case mới phải phát hiện hành vi thiếu trước khi hoàn thiện implementation     |
| US1 — logic   | Sau T003/T004: T005 và T007 có thể làm song song; T006 phụ thuộc T005; T008 phụ thuộc T006/T007; T009 phụ thuộc T008; T010 phụ thuộc T009   |
| US1 — kết nối | T011 sau T010; T012 sau toàn bộ T003–T011                                                                                                   |
| US2           | Sau US1: T013 song song T014; T015 sau T013; T016 sau T014; T017 sau T013–T016                                                              |
| US3           | Sau US2: T018 song song T019; T020 → T021 → T022 nối tiếp T019 vì cùng file integration; T023 sau T018–T022                                 |
| Hoàn thiện    | T024 song song T025 sau US3; T026 sau T024/T025; T027 → T028 → T029 sau T026; task DB bị blocked không ngăn ghi báo cáo trung thực tại T029 |

Các task dùng cùng file không chạy song song. Các lần chạy kiểm thử mở rộng chỉ thực hiện sau thay đổi mới tương ứng; không chạy lại suite đã đạt nếu không có thay đổi hoặc lỗi mới.

### Parallel examples per user story

**US1**: Sau T002, T003 sửa `tests/ingredient-management.test.ts` trong khi T004 sửa `tests/authorization.integration.test.ts`. Sau phần test, T005 sửa validation trong khi T007 sửa repository; service chờ DTO và repository.

**US2**: Sau T012, T013 viết ma trận quyền unit/HTTP trong `tests/ingredient-management.test.ts` đồng thời T014 viết ma trận quyền thật trong `tests/authorization.integration.test.ts`. T015/T016 tiếp tục theo nhánh file của mình.

**US3**: Sau T017, T018 viết regression nội dung/PATCH trong `tests/ingredient-management.test.ts` đồng thời T019 viết chu kỳ/history trong `tests/authorization.integration.test.ts`. T020–T022 tuần tự vì cùng file.

**Polish**: T024 và T025 sửa hai tài liệu khác nhau, có thể làm song song.

## Implementation Strategy

### MVP first

Hoàn tất Phase 1–3 để demo một PATCH status cho cả hai chiều, no-op và route hide được bỏ. Quyền production đã được kế thừa ngay trong US1; trước khi phát hành phải hoàn tất kiểm chứng US2/US3 và các quality gate bắt buộc. Không deploy hoặc ghi DB đang sử dụng trong các task này.

### Incremental delivery

1. Chuẩn bị fixture và viết kỳ vọng US1, hoàn thiện validation/DTO/repository/service/controller/routes, cập nhật caller cũ.
2. Kiểm chứng quyền bằng US2, sửa sai sót trong cùng luồng hiện có nếu phát hiện.
3. Kiểm chứng lịch sử, lựa chọn và concurrency bằng US3; tận dụng hành vi đã triển khai, không tạo thêm abstraction chỉ để có task code riêng cho mỗi story.
4. Đồng bộ docs, chạy quality/unit và integration được ủy quyền; cập nhật trạng thái/evidence thật rồi mới coi tính năng hoàn tất.

## Requirement Coverage

| Requirement | Tasks chính                      |
| ----------- | -------------------------------- |
| FR-001      | T003, T009–T011, T026            |
| FR-002–003  | T003–T010                        |
| FR-004      | T003–T004, T007–T008, T019, T021 |
| FR-005–007  | T008, T010, T013–T017            |
| FR-008      | T003, T005–T006, T009            |
| FR-009      | T007–T008, T018–T019, T021–T022  |
| FR-010      | T003–T004, T008–T010             |
| FR-011      | T019–T020                        |
| FR-012      | T018, T021                       |
| FR-013      | T011, T024–T026                  |
| SC-001      | T003–T004, T012, T028            |
| SC-002      | T003–T004, T019, T021, T028      |
| SC-003      | T013–T017, T028                  |
| SC-004      | T018–T019, T028                  |
| SC-005      | T003, T012, T027                 |

## Task Summary

| Nhóm         | Số task |
| ------------ | ------- |
| Setup        | 1       |
| Foundational | 1       |
| US1 (P1)     | 10      |
| US2 (P1)     | 5       |
| US3 (P2)     | 6       |
| Polish       | 6       |
| Tổng         | 29      |

Có 7 task gắn [P]: T004, T005, T007, T014, T019, T024, T025. Chỉ chạy song song trong các cửa sổ và phụ thuộc đã nêu.

## Notes

- Bước tạo tasks chỉ ghi tài liệu này; không thực hiện task, thay API, chạy test hay truy cập DB.
- Không có .specify/extensions.yml tại thời điểm tạo tasks; không có before_tasks/after_tasks hook cần chạy.
- Không thay Prisma schema, migration, seed, cache hoặc hệ thống auth dùng chung trong phạm vi này.
