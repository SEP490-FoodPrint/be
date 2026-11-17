---
description: "Danh sách công việc triển khai quản lý quyền và bộ quyền vai trò"
---

# Tasks: System Admin quản lý quyền và bộ quyền vai trò

**Input**: Design documents from `specs/role-permission-management/`  
**Branch**: `feat/role-permission-management`  
**Created**: 2026-11-17

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [API contract](contracts/role-permission-api.md), [quickstart.md](quickstart.md).

**Tests**: Bao gồm kiểm thử theo acceptance scenarios trong spec, Validation Strategy đã chốt trong plan và yêu cầu kiểm tra backend của AGENTS.md. Đây là thay đổi phân quyền/transaction có tác động nghiệp vụ; các ca mới phải kiểm được hành vi và race, không chỉ sao chép implementation. Viết các ca story trước phần implementation tương ứng, xác nhận thất bại đúng lý do; DB tests chỉ chạy khi đã có cho phép riêng.

**Organization**: Setup → Foundational → từng user story theo ưu tiên → Polish. Các task đã hoàn thành trong lần implement; xem bằng chứng và giới hạn nghiệm thu tại quickstart.md.

## Format: `[ID] [P?] [Story] Description`

- Mỗi công việc dùng checkbox, ID tuần tự và đường dẫn file cụ thể.
- `[P]` chỉ áp dụng cho các task khác file có thể làm song song sau khi prerequisites của nhóm đã xong.
- `[US1]`–`[US4]` bám đúng số story trong spec, không dùng cho setup/foundation/polish.
- Các story dùng chung file source và hai file test chính; không sửa đồng thời cùng file giữa các story.

## Path Conventions

Mọi đường dẫn trong task tính từ root repository. Source ở `src/modules/permission/`, helper scope ở `src/utils/resource-access.ts`, tests ở `tests/`. Không tạo model/migration vì schema hiện có đã đủ. Không sửa `specs/system-complaint-management/` hoặc chuyển nhánh complaint đang tạm dừng.

## Điều kiện thực thi

- Tạo task hoặc có credentials không phải cho phép ghi DB. Nếu chưa có cho phép disposable-local test writes, tiếp tục phần không phụ thuộc DB, giữ task kiểm DB chưa hoàn thành và báo rõ prerequisite.
- Không chạy bootstrap/seed để tự cấp quyền, không sửa grants SYSTEM_ADMIN qua API, không migration/introspection/db push/reset hoặc Azure.
- Dùng authorizationTransaction hiện có: Serializable, tối đa 3 attempts; lỗi serialization/deadlock không bị chuyển sớm thành HttpError. Mọi query/lock nằm trong repository, mọi tham gia cùng tx.
- Giữ scope/denials/ACTIVE target của các API user permission hiện hữu và giữ exports touchUser/touchRole.
- Không thêm UI hoặc phục hồi tự động khi người quản trị tự tắt guard; không tự mở rộng khả năng nghiệp vụ cho mã quyền mới.

## Phase 1: Setup — chuẩn bị trên repository hiện có

**Purpose**: Xác nhận baseline và chuẩn bị nơi kiểm chứng; không tạo lại project, cài framework hoặc thay đổi DB.

- [x] T001 Đối chiếu `specs/role-permission-management/spec.md`, `specs/role-permission-management/plan.md` và `specs/role-permission-management/contracts/role-permission-api.md` với nhánh `feat/role-permission-management`; ghi baseline/prerequisites kiểm thử vào `specs/role-permission-management/quickstart.md`, giữ complaint ngoài phạm vi và xác nhận không cần schema/catalog/seed mới.
- [x] T002 Tạo harness unit/HTTP với repository/transaction doubles trong `tests/permission-management.test.ts` theo helper `tests/helpers/http.ts`; đăng ký file vào script `test:unit` trong `package.json`, tái dùng Node test runner/tsx và không thêm dependency.

**Checkpoint**: Có baseline và harness để kiểm chứng từng story; chưa thay đổi dữ liệu môi trường.

---

## Phase 2: Foundational — phân lớp và transaction dùng chung

**Purpose**: Hoàn thành nền tảng trước mọi story. Refactor các thao tác hiện có trong module mà vẫn giữ HTTP behavior, factories/injection đang được tests sử dụng và exports dùng ở module khác.

- [x] T003 [P] Migrate schemas hiện hữu (create, replaceRole, page/limit, roleId/permissionId/userId params và empty body cho denial) sang Zod strictObject + parseRequest trong `src/modules/permission/permission.validation.ts`; giữ regex/giới hạn/trim/null/default hiện hành, UUID lowercase trước kiểm trùng và lỗi tiếng Việt kèm nhiều field paths; chưa thêm PATCH schemas của US2/US4.
- [x] T004 Tạo `src/modules/permission/permission.request.dto.ts` sau T003, xuất các Request DTO hiện có bằng z.infer và type-only schema imports; chỉ service được dùng DTO làm input, không dùng ReturnType validator hoặc viết lại cấu trúc thủ công.
- [x] T005 [P] Tạo `src/modules/permission/permission.response.dto.ts` với Permission, RoleSummary, RolePermissions, ReplaceRolePermissionsResult, paginated lists và UserPermissions như `specs/role-permission-management/data-model.md`; không thêm persistence fields vào hợp đồng cũ.
- [x] T006 [P] Thêm trusted catalog/role scopes trong `src/utils/resource-access.ts`: kiểm SYSTEM_ADMIN + SYSTEM + guard theo thao tác, trả scope toàn cục tường minh; giữ organization scope hiện hữu cho user permissions/denials và không nhận org IDs từ client.
- [x] T007 Chuyển toàn bộ Prisma query/select/order/pagination và persistence operations hiện hữu từ service sang `src/modules/permission/permission.repository.ts`; repository nhận scope tin cậy, dựng WHERE riêng, dùng shared Prisma client, không import DTO và không mở transaction riêng; giữ export permissionConcurrencyRepository.touchUser/touchRole.
- [x] T008 Bổ sung readActor trực tiếp bằng identitySelect + principalFromIdentity và các lock operations trong `src/modules/permission/permission.repository.ts`: system user UPDATE → roles sorted với strongest mode → union guard/target permissions sorted với strongest mode; tenant denial theo parent school/supplier → users → roles → permissions; giữ lỗi query/COMMIT thô cho shared retry và không nâng SHARE lên UPDATE sau khi đã khóa.
- [x] T009 Refactor các thao tác hiện có trong `src/modules/permission/permission.service.ts` nhận AuthPrincipal + Request DTO, dùng repository/scope, định nghĩa một authorizationTransaction cho mỗi write và recheck actor/target trong cùng tx sau locks; map Response DTO tường minh theo allowlist, không Prisma query args, không auth cache, không sửa semantics user/denials hoặc tự cấp quyền.
- [x] T010 Cập nhật `src/modules/permission/permission.controller.ts` để validate runtime rồi gọi service bằng principal và normalized input, không import DTO; giữ routes/envelopes/status/messages hiện tại trong `src/modules/permission/permission.routes.ts`, áp Cache-Control private, no-store và giữ auth/CSRF/rate-limit hiện hữu.
- [x] T011 Cập nhật mocks/validator assertions bị ảnh hưởng trong `tests/authorization.test.ts`, `tests/modules.test.ts` và harness `tests/permission-management.test.ts`; thêm regression user detail/denial cho ACTIVE target, scope cùng tổ chức, authority bị cấm, System Admin chỉ xem qua user.manage, multi-field errors và bounded retry không nuốt serialization thành 503 sớm.
- [x] T012 Chạy `npm run typecheck`, `npm run build` và các test không hạ tầng `tests/authorization.test.ts`, `tests/modules.test.ts`, `tests/permission-management.test.ts`; sửa lỗi baseline do refactor và ghi kết quả thực tế vào `specs/role-permission-management/quickstart.md` trước khi bắt đầu story.

**Checkpoint**: Module giữ hành vi hiện có, có đầy đủ DTO/repository/scope và protocol khóa chung; chưa yêu cầu endpoint PATCH mới.

---

## Phase 3: User Story 1 — xem và điều chỉnh bộ quyền vai trò (P1, MVP)

**Purpose**: Cho System Admin duyệt role/permission, xem quyền đã gán và lưu bộ quyền của role có thể sửa; SYSTEM_ADMIN luôn chỉ đọc.

**Independent Test**: Dùng role và permission có sẵn trong fixture, cấp/thu hồi cho hai tài khoản cùng role ở hai tổ chức bằng cùng phiên; xác minh denial riêng giữ nguyên và không truy cập vượt scope. Không phụ thuộc tạo quyền, PATCH metadata hoặc endpoint đổi trạng thái: inactive permission được chuẩn bị trực tiếp trong DB fixture được phép.

**Tests trước implementation**: Hai task đầu của story viết kiểm thử ở hai file khác nhau; có thể chuẩn bị song song. Chạy ca mới để xác nhận regression trước sửa code; không khởi chạy DB nếu chưa được phép.

- [x] T013 [P] [US1] Viết unit/HTTP contract tests US1 trong `tests/permission-management.test.ts` cho GET /roles, GET /permissions, GET/PUT /roles/:roleId/permissions: guards, no-store/envelopes, pagination 1/20 và max 100, code/id order, inactive hiển thị, editable, safe projection, UUID normalize/duplicate, 1.000/1.001 IDs, empty set, keep/remove inactive và reject new inactive/unknown IDs; xác nhận regression mới thất bại đúng lý do trước sửa tính năng.
- [x] T014 [P] [US1] Mở rộng `tests/authorization.integration.test.ts` với fixtures hai tổ chức chung role và denial riêng; kiểm request kế tiếp đổi quyền không login lại, SYSTEM_ADMIN PUT cùng tập/rỗng đều 403, giữ assignedAt/denials, fault rollback sau ghi đầu, hai PUT dùng barrier và actor locked/demoted/guard revoked trước hoặc sau điểm khóa; chỉ chạy DB khi có cho phép riêng.
- [x] T015 [US1] Bổ sung repository reads cho role summaries và hoàn thiện role/permission lists trong `src/modules/permission/permission.repository.ts`: trusted scope, explicit WHERE, code ASC/id ASC, limit+1, role detail chứa cả inactive đã gán; không đổi GET /api/auth/roles.
- [x] T016 [US1] Thêm operation-specific repository methods cho grant diff và đọc tập C/R dưới khóa trong `src/modules/permission/permission.repository.ts`; chỉ xóa C−R/tạo R−C, giữ C∩R và assignedAt, không đụng denials, touchRole khi delta thực sự đổi, giữ nguyên lỗi để authorizationTransaction retry.
- [x] T017 [US1] Triển khai listRoles và hoàn thiện replaceRole trong `src/modules/permission/permission.service.ts`: role.view cho list, role_permission.manage cho detail/write, SYSTEM_ADMIN target 403; khóa target role và union C∪R+guard, recheck actor, xác nhận requested IDs tồn tại và chỉ phần thêm mới active, map output hiện hữu; không dựng Prisma args trong service.
- [x] T018 [US1] Thêm controller/list route GET /api/roles và nối các thao tác US1 trong `src/modules/permission/permission.controller.ts`, `src/modules/permission/permission.routes.ts`; xác minh mount có sẵn ở `src/routes/index.ts`, giữ GET /api/auth/roles và không tạo /v1 alias.
- [x] T019 [US1] Chạy unit/HTTP US1 trong `tests/permission-management.test.ts` cùng regression `tests/authorization.test.ts`, `tests/modules.test.ts`; sửa lỗi guard/scope/DTO/limits và ghi bằng chứng checkpoint vào `specs/role-permission-management/quickstart.md`.
- [x] T020 [US1] Khi có cho phép test writes, chạy `npm run test:local:authorization` cho các ca US1 trong `tests/authorization.integration.test.ts` bằng runner `tests/helpers/run-local-tests.ts`; kiểm exact grants/denials snapshots, rollback, cả hai thứ tự barrier và kết quả nguyên bộ; ghi prerequisites bị chặn nếu chưa được phép, không coi mocks là DB PASS.

**Checkpoint**: MVP US1 dùng được với catalog hiện có; chỉ kết luận concurrency sau PostgreSQL integration thực.

---

## Phase 4: User Story 2 — tạm ngừng/kích hoạt toàn hệ thống (P1)

**Purpose**: Đổi Permission.isActive toàn cục, bảo toàn grants/denials và áp dụng cả System Admin.

**Independent Test**: Dùng permission đã được fixture gán cho nhiều role/tổ chức, bao gồm System Admin; off/on rồi kiểm request kế tiếp của tài khoản có quyền, không được gán và có denial. Dùng role detail hiện hữu/fixture IDs, không yêu cầu US3/US4 hoặc role list mới.

**Tests trước implementation**: Hai task đầu của story viết kiểm thử ở hai file khác nhau; có thể chuẩn bị song song. Chạy ca mới để xác nhận regression trước sửa code; không khởi chạy DB nếu chưa được phép.

- [x] T021 [P] [US2] Viết unit/HTTP tests US2 trong `tests/permission-management.test.ts` cho PATCH state: boolean strict, sai UUID/unknown fields, guard role_permission.manage độc lập permission.view, wrong role/org, 404, same-state 200, DTO/envelope, no grant/denial writes và self-disable; xác nhận các ca endpoint mới thất bại trước implement.
- [x] T022 [P] [US2] Thêm integration US2 trong `tests/authorization.integration.test.ts`: global off/on ở nhiều role/tổ chức kể cả System Admin, denials/grants bất biến, giữ/thu hồi inactive và không tái gán sau bật; barrier grant-vs-off, hai state writes, locked/demoted actor hoặc inactive guard theo cả hai thứ tự, fault rollback và self-disable với fixture recovery cô lập.
- [x] T023 [US2] Thêm strict state schema chỉ nhận isActive boolean trong `src/modules/permission/permission.validation.ts` và Request DTO z.infer tương ứng trong `src/modules/permission/permission.request.dto.ts`; không coerce string/number/null, không đổi immutable fields.
- [x] T024 [US2] Thêm find/update state operations trong `src/modules/permission/permission.repository.ts`, chỉ UPDATE isActive; union target+guard permissions lấy strongest mode ngay từ đầu khi trùng, không khóa mọi role sau permission, không sửa grants/denials và giữ raw conflict cho retry.
- [x] T025 [US2] Triển khai setPermissionState trong `src/modules/permission/permission.service.ts` dùng shared transaction/locks, recheck guard sau khóa kể cả same-state, 404 target thiếu, map Permission DTO; cho tự tắt guard của người thao tác theo spec, không bypass/auto-recovery hoặc yêu cầu permission.view phụ.
- [x] T026 [US2] Thêm PATCH /api/permissions/:permissionId/state trong `src/modules/permission/permission.routes.ts` và handler trong `src/modules/permission/permission.controller.ts`; validate params/body, truyền principal, trả 200 đúng envelope, giữ CSRF/no-store.
- [x] T027 [US2] Chạy tests US2 và regression US1 trong `tests/permission-management.test.ts`, kiểm raw query/COMMIT retry bounded và business 403 không retry; ghi kết quả vào `specs/role-permission-management/quickstart.md`.
- [x] T028 [US2] Khi có cho phép, chạy `npm run test:local:authorization` với tests US2 trong `tests/authorization.integration.test.ts` và `npm run test:local:lifecycle` để kiểm protocol locks/denials liên quan; ghi cả hai thứ tự race và snapshots thực vào `specs/role-permission-management/quickstart.md`, không chạy bootstrap để phục hồi môi trường thật.

**Checkpoint**: Global state đúng cho mọi role, giữ nguyên cấu hình và không tự mở lại denial/grant đã thu hồi.

---

## Phase 5: User Story 3 — thêm quyền mới vào danh mục (P2)

**Purpose**: Hoàn thiện luồng POST đã có trong kiến trúc mới: mã duy nhất, active mặc định, chưa được gán và báo lỗi an toàn.

**Independent Test**: Tạo code chưa có, đọc lại danh mục bằng quyền xem tương ứng, thử tạo trùng kể cả code inactive và đối chiếu grant count. Không cần PUT role hoặc các PATCH để tạo mới; dữ liệu inactive được fixture chuẩn bị.

**Tests trước implementation**: Hai task đầu của story viết kiểm thử ở hai file khác nhau; có thể chuẩn bị song song. Chạy ca mới để xác nhận regression trước sửa code; không khởi chạy DB nếu chưa được phép.

- [x] T029 [P] [US3] Viết tests US3 trong `tests/permission-management.test.ts` cho POST /permissions: permission.create và System guard, fields bắt buộc, regex/giới hạn, trim/null/default, aggregate errors, reject isActive/id/roleIds, 201 Permission DTO, duplicate active/inactive 409, không tự tạo grants hoặc chức năng; dùng schema nền tảng T003 thay vì thêm validator trùng.
- [x] T030 [P] [US3] Thêm integration US3 trong `tests/authorization.integration.test.ts` cho create thật, unique code inactive và create cùng code đồng thời bằng barrier; so snapshots grants/denials trước/sau, kiểm rollback/lỗi tạm thời và actor mất guard trước điểm chấp nhận.
- [x] T031 [US3] Hoàn thiện create/duplicate-code classifier trong `src/modules/permission/permission.repository.ts`: chỉ chuyển đúng ràng buộc unique permission.code của Prisma/adapter thành 409; giữ raw serialization/deadlock, kiểm isActive mặc định true và không có persistence operation gán quyền.
- [x] T032 [US3] Hoàn thiện create flow trong `src/modules/permission/permission.service.ts`, `src/modules/permission/permission.controller.ts` dùng Request DTO và common transaction/locks cho permission.create, recheck actor và map Permission DTO; giữ POST route, message tiếng Việt và status 201, không thêm catalog/seed hoặc rewrite phần đã đúng từ foundation.
- [x] T033 [US3] Chạy các ca US3 trong `tests/permission-management.test.ts` và, khi có cho phép, `npm run test:local:authorization` cho `tests/authorization.integration.test.ts`; xác nhận một code duy nhất, loser 409, không auto-grant; ghi kết quả hoặc prerequisite chưa đáp ứng vào `specs/role-permission-management/quickstart.md`.

**Checkpoint**: Tạo quyền không sinh chức năng, không tự cấp quyền và không che lỗi serialization thành duplicate.

---

## Phase 6: User Story 4 — chỉnh sửa tên/mô tả (P2)

**Purpose**: Sửa metadata của quyền active hoặc inactive mà không đổi mã, nhóm, hành động, trạng thái hay hiệu lực cấu hình.

**Independent Test**: Dùng quyền đã gán từ fixture, sửa name/description rồi kiểm danh mục/role detail và khả năng nghiệp vụ giữ nguyên. Không phụ thuộc tạo quyền mới hoặc endpoint đổi trạng thái.

**Tests trước implementation**: Hai task đầu của story viết kiểm thử ở hai file khác nhau; có thể chuẩn bị song song. Chạy ca mới để xác nhận regression trước sửa code; không khởi chạy DB nếu chưa được phép.

- [x] T034 [P] [US4] Viết unit/HTTP tests US4 trong `tests/permission-management.test.ts`: PATCH metadata ít nhất một trường, trim/limits, description null để xóa và omitted giữ nguyên, reject blank/immutable/unknown/isActive, guard role_permission.manage không đòi permission.view, wrong role/org, 404 và allowlist output; xác nhận endpoint mới thất bại trước implement.
- [x] T035 [P] [US4] Thêm integration US4 trong `tests/authorization.integration.test.ts`: sửa quyền active/inactive đã gán, metadata mới xuất hiện ở catalog/role detail, code/module/action/isActive/grants/denials bất biến; race metadata-vs-state với barrier để không ghi đè trạng thái, actor mất thẩm quyền và fault rollback.
- [x] T036 [US4] Thêm metadata PATCH schema strict name?/description? với ít nhất một trường trong `src/modules/permission/permission.validation.ts`, thêm Request DTO type-only z.infer trong `src/modules/permission/permission.request.dto.ts`; dùng helper/giới hạn đã chốt, không nhận code/module/action/isActive.
- [x] T037 [US4] Thêm repository operation cập nhật riêng các cột metadata có trong request trong `src/modules/permission/permission.repository.ts`; tái dùng union locks target+guard, không ghi full record từ snapshot cũ hoặc đổi trạng thái/grants/denials.
- [x] T038 [US4] Triển khai updatePermission trong `src/modules/permission/permission.service.ts`, shared transaction/recheck role_permission.manage, 404 khi thiếu target, cho cả active/inactive và map Permission DTO; không giới hạn chỉ vì permission được SYSTEM_ADMIN gán.
- [x] T039 [US4] Thêm PATCH /api/permissions/:permissionId và handler tương ứng trong `src/modules/permission/permission.routes.ts`, `src/modules/permission/permission.controller.ts`; validate params/body, truyền principal, trả status 200/envelope và giữ route state riêng.
- [x] T040 [US4] Chạy tests metadata và hồi quy status trong `tests/permission-management.test.ts`, kiểm nhiều field paths và không lộ persistence/secret; ghi kết quả vào `specs/role-permission-management/quickstart.md`.
- [x] T041 [US4] Khi có cho phép, chạy `npm run test:local:authorization` cho các ca US4 trong `tests/authorization.integration.test.ts`; kiểm metadata-vs-state ở cả hai thứ tự, unchanged effective rights và rollback thực, ghi bằng chứng vào `specs/role-permission-management/quickstart.md`.

**Checkpoint**: Cả bốn story đều có increment và tiêu chí kiểm chứng riêng; không làm thay đổi semantics authorization ngoài phạm vi.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Đồng bộ tài liệu, rà kiến trúc và tổng hợp bằng chứng cho toàn bộ yêu cầu. Không mở rộng phạm vi sang UI, DB design complaint hoặc deployment.

- [x] T042 [P] Cập nhật ma trận endpoint/guard trong `docs/AUTHORIZATION.md` cho GET /roles và hai PATCH, giải thích role_permission.manage bảo vệ metadata/state, SYSTEM_ADMIN grant chỉ đọc nhưng global state vẫn áp dụng; giữ catalog/bootstrap/tenant rules hiện hữu.
- [x] T043 [P] Cập nhật ownership/kiến trúc và các endpoint mới của module trong `src/modules/README.md`; ghi nhận hai DTO riêng, repository locks và touchUser/touchRole vẫn được module khác sử dụng, giữ auth/roles legacy.
- [x] T044 Rà `src/modules/permission/permission.service.ts`, `src/modules/permission/permission.repository.ts`, `src/modules/permission/permission.controller.ts` và `src/utils/resource-access.ts` theo Constitution Check trong `specs/role-permission-management/plan.md`; xử lý query/DTO/scope/transaction vi phạm, xác nhận không đổi schema, catalog, cache, generated output hoặc complaint.
- [x] T045 Chạy `npm run prisma:validate`, `npm run prisma:generate`, `npm run validate` và `npm run test:unit` sau toàn bộ thay đổi; kiểm đăng ký suite ở `package.json`, ghi lệnh/kết quả thực tế và nguyên nhân blocked/skipped vào `specs/role-permission-management/quickstart.md`, không commit generated Prisma/dist.
- [x] T046 Khi có cho phép cho instance local đã chọn, chạy regression cuối `npm run test:local:authorization` và `npm run test:local:lifecycle` với `tests/authorization.integration.test.ts`, `tests/account-lifecycle.integration.test.ts`, runner `tests/helpers/run-local-tests.ts`; xác nhận cleanup đúng manifest, guard/state/role races và denials không hồi quy; không reset/member DB/Azure hoặc tạo container mới.
- [x] T047 Kiểm tính nhất quán và Spec gate cho `specs/role-permission-management/spec.md`, `specs/role-permission-management/plan.md`, `specs/role-permission-management/tasks.md` bằng quy trình trong `contribute.md` và `.github/scripts/spec-gate.mjs`; dùng base/head đúng, nếu đánh giá working tree thì ghi rõ khác CI/commit, không tuyên bố PASS từ HEAD thiếu tài liệu untracked.
- [x] T048 Thực hiện walkthrough được phép theo `specs/role-permission-management/quickstart.md` và tổng hợp bằng chứng SC-001–006, task/checkpoint thực sự đạt và phần còn chờ; ghi SC-005 chưa nghiệm thu nếu chưa có client/UI/người kiểm thử phù hợp, không coi unit hoặc việc viết báo cáo là nghiệm thu; không tự triển khai UI, push/deploy hoặc phục hồi quyền trên DB vận hành.

**Checkpoint**: Báo cáo phân biệt kết quả tài liệu, backend tests, DB concurrency và nghiệm thu người dùng; chỉ đánh dấu task hoàn thành khi phần việc thực tế đã làm.

---

## Dependencies & Execution Order

### Phase Dependencies

```text
Setup T001–T002
  → Foundational T003–T012
      ├→ US1 T013–T020 (P1, MVP) → US2 T021–T028 (P1)
      ├→ US3 T029–T033 (P2)
      └→ US4 T034–T041 (P2)
  → Polish T042–T048 sau khi đủ bốn story
```

Các nhánh trên thể hiện phụ thuộc logic, không cho phép cùng sửa file. US2 phụ thuộc logic giữ/thu hồi inactive grants ở T016–T017 của US1; checkpoint US2 chỉ được xác nhận sau checkpoint US1. US3 và US4 dùng fixtures có sẵn để kiểm chứng độc lập sau Foundation; không bắt buộc tạo quyền mới để kiểm US1/US2/US4.

Thứ tự triển khai khuyến nghị trên workspace này: Setup → Foundational → US1 → US2 → US3 → US4 → Polish. Sau mỗi checkpoint chạy kiểm chứng tương ứng; nếu DB prerequisite chưa có, không tuyên bố checkpoint concurrency đã đạt.

### Dependencies trong Foundation

- T001 → T002.
- Sau T002: T003, T005 và T006 có thể thực hiện song song.
- T003 → T004; T003–T006 → T007 → T008 → T009 → T010 → T011 → T012.
- Repository không nhập DTO; liên kết ở đây nhằm chốt hợp đồng trước chuyển queries, không biến DTO thành persistence types.
- Không triển khai story trước T012 hoàn tất.

### Dependencies trong từng story

| Story | Viết test song song | Implementation tuần tự    | Kiểm chứng  |
| ----- | ------------------- | ------------------------- | ----------- |
| US1   | T013, T014          | T015 → T016 → T017 → T018 | T019 → T020 |
| US2   | T021, T022          | T023 → T024 → T025 → T026 | T027 → T028 |
| US3   | T029, T030          | T031 → T032               | T033        |
| US4   | T034, T035          | T036 → T037 → T038 → T039 | T040 → T041 |

Mỗi chuỗi implementation bắt đầu sau hai task test của story. Các task kiểm chứng DB phụ thuộc thêm cho phép/instance được chọn. T042/T043 có thể song song sau story completion; tiếp đó T044 → T045 → T046 → T047 → T048. Nếu T046 bị thiếu prerequisite, vẫn có thể làm phần kiểm tài liệu/báo cáo không phụ thuộc nhưng giữ trạng thái DB chưa đạt.

### Parallel Opportunities

- Foundation: T003 (validation), T005 (response DTO), T006 (scope) là ba file riêng; T004 chỉ bắt đầu khi T003 đã chốt schema.
- Mỗi story: unit/HTTP và integration authoring ở hai file riêng, không phụ thuộc phần implementation chưa viết.
- Polish: T042 (authorization matrix) và T043 (module README).
- Không đánh dấu repository/service/controller tasks là song song: chúng vừa có phụ thuộc vừa thường sửa cùng file ở nhiều stories. Không khởi chạy nhiều integration writers chung fixture chỉ vì các test tasks mang [P].

## Parallel Example: User Story 1

```text
Sau T012:
  T013 → tests/permission-management.test.ts
  T014 → tests/authorization.integration.test.ts
Sau khi cả hai xong:
  T015 → T016 → T017 → T018 → T019 → T020
```

Unit kiểm contract; integration kiểm hai tổ chức, denials và các barrier. [P] áp dụng việc viết hai file; chạy DB cần điều kiện riêng.

## Parallel Example: User Story 2

```text
Sau checkpoint US1 (bao gồm T016–T017) và bàn giao các file dùng chung:
  T021 → tests/permission-management.test.ts
  T022 → tests/authorization.integration.test.ts
Sau khi cả hai xong:
  T023 → T024 → T025 → T026 → T027 → T028
```

Không sửa file unit/integration của US1 đồng thời với US2.

## Parallel Example: User Story 3

```text
Sau Foundation và bàn giao các file dùng chung:
  T029 → tests/permission-management.test.ts
  T030 → tests/authorization.integration.test.ts
Sau khi cả hai xong:
  T031 → T032 → T033
```

US3 tái dùng create/schema đã được refactor ở Foundation; không viết lại phần đã đáp ứng hợp đồng chỉ để tạo thay đổi.

## Parallel Example: User Story 4

```text
Sau Foundation và bàn giao các file dùng chung:
  T034 → tests/permission-management.test.ts
  T035 → tests/authorization.integration.test.ts
Sau khi cả hai xong:
  T036 → T037 → T038 → T039 → T040 → T041
```

Race metadata-vs-state dùng fixtures/endpoint state khi US2 đã có; nếu thực hiện US4 trước US2, writer state trong fixture thao tác trực tiếp bằng cùng protocol trên disposable DB để kiểm không ghi đè cột, không đòi endpoint state mới.

## Requirement Coverage

| Requirement | Tasks chính                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| FR-001      | T006, T008–T011, T013–T014, T021–T022, T029–T030, T034–T035                                          |
| FR-002      | T003, T005–T007, T013, T015, T017–T019                                                               |
| FR-003      | T005, T013, T015, T017–T019                                                                          |
| FR-004      | T003–T004, T029–T033                                                                                 |
| FR-005      | T034–T041                                                                                            |
| FR-006      | T014, T016–T020                                                                                      |
| FR-007      | T013–T014, T017, T020                                                                                |
| FR-008      | T021–T028                                                                                            |
| FR-009      | T022, T025, T028                                                                                     |
| FR-010      | T014, T022, T024–T028                                                                                |
| FR-011      | T003–T004, T013–T014, T016–T020, T022                                                                |
| FR-012      | T009, T014, T020, T022, T028                                                                         |
| FR-013      | T008–T009, T011, T014, T016–T017, T020, T022, T024–T025, T027–T028, T030–T033, T035, T037–T038, T041 |
| FR-014      | T003, T005, T009–T011, T013, T021, T029, T034, T044–T045                                             |
| FR-015      | T006–T011, T014, T022, T044, T046                                                                    |
| FR-018      | T053–T056                                                                                            |
| FR-017      | T049–T052                                                                                            |
| FR-016      | T001, T029–T033, T042–T044, T048                                                                     |

| Success Criterion | Bằng chứng cần có                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| SC-001            | T014/T020: live request, hai tổ chức và scope giữ nguyên                                       |
| SC-002            | T022/T028: global off/on, nhiều role gồm SYSTEM_ADMIN, snapshots bất biến                      |
| SC-003            | T029–T033 và T034–T041: create unique + metadata giữ định danh/hiệu lực                        |
| SC-004            | T013/T014/T020 cùng các negative tests của mọi story                                           |
| SC-005            | T048: walkthrough có người kiểm thử và client phù hợp; không suy từ unit tests                 |
| SC-008            | T054/T056: chỉ inactive, size5, hasNext và duyệt không trùng/mất                               |
| SC-007            | T050/T052: search tên/literal/pagination trên unit và PostgreSQL                               |
| SC-006            | T014/T020/T022/T028 và regression cuối T046: denial preservation + kết quả đồng thời nguyên bộ |

## Implementation Strategy

### MVP First — User Story 1

1. Hoàn thành Setup và Foundational (T001–T012).
2. Hoàn thành US1 (T013–T020), dùng quyền/role có sẵn.
3. Xác nhận độc lập list/detail/grant/revoke, SYSTEM_ADMIN read-only, denial preservation và tenant isolation.
4. MVP chỉ được coi đạt concurrency khi có PostgreSQL evidence. Một bản demo US1 chưa có global toggle không có nghĩa toàn bộ tính năng đã hoàn tất.
5. Không tự dừng triển khai đã được người dùng giao toàn bộ ở MVP; checkpoint giúp kiểm chứng increment.

### Incremental Delivery

Tiếp US2 để đổi trạng thái toàn cục; US3 hoàn thiện create; US4 thêm metadata PATCH. Chạy lại nhóm cần thiết sau mỗi thay đổi mới, không mở rộng testing vô hạn khi không có thay đổi/lỗi mới. Sau bốn story thực hiện polish và tổng hợp bằng chứng.

### Parallel Team Strategy

Có thể chia việc theo các nhóm [P] khác file khi có người thực hiện và được giao phù hợp. Trên một workspace, bàn giao source/test dùng chung theo thứ tự story; không tự chia bốn story cho bốn người cùng sửa module.

## Tổng hợp và trạng thái

| Nhóm                      | Số task |
| ------------------------- | ------- |
| Setup                     | 2       |
| Foundational              | 10      |
| US1 — bộ quyền vai trò    | 16      |
| US2 — trạng thái toàn cục | 8       |
| US3 — thêm quyền          | 5       |
| US4 — metadata            | 8       |
| Polish                    | 7       |
| **Tổng**                  | **56**  |

Có **13 task [P]**: 3 foundation, 8 test-authoring ở bốn stories và 2 tài liệu polish. Đây là cơ hội song song có điều kiện, không phải 13 task có thể chạy cùng lúc.

Đã hoàn thành 56/56 task (48 ban đầu và 8 task amendment search/inactive). Kết quả thực tế và giới hạn SC-005 được ghi trong quickstart.md: backend/unit/PostgreSQL đã kiểm chứng; nghiệm thu với người dùng/client quản trị còn chờ. T048 đã hoàn tất báo cáo, không có nghĩa SC-005 đạt. Không có extensions.yml, vì vậy các hooks của tasks/analyze/implement được bỏ qua theo skill. Chưa push/deploy.

## Phase 8: Amendment US1 — tìm quyền theo tên

Phụ thuộc: T048 → T049 → T050 → T051 → T052. Chỉ sửa cùng feature/branch hiện tại; không tác động complaint. Independent Test: search theo tên gồm hoa/thường, khoảng trắng, ký tự %, _, backslash; đối chiếu kết quả PostgreSQL và hasNext sau lọc.

- [x] T049 [US1] Cập nhật FR-017/SC-007 và thiết kế search theo tên trong `specs/role-permission-management/spec.md`, `specs/role-permission-management/plan.md`, `specs/role-permission-management/contracts/role-permission-api.md`; giữ guards và API role list không hỗ trợ search.
- [x] T050 [US1] Viết unit/HTTP tests cho trim/empty/max150, invalid arrays/objects, guard và normalized query trong `tests/permission-management.test.ts`; thêm PostgreSQL name-only, inactive, literal ký tự đặc biệt, phân trang sau lọc và không khớp trong `tests/authorization.integration.test.ts`.
- [x] T051 [US1] Thêm schema/Request DTO riêng cho permission search và role pagination tại `src/modules/permission/permission.validation.ts`, `src/modules/permission/permission.request.dto.ts`; controller/service truyền normalized query, repository thực hiện name contains insensitive và escape literal trước pagination trong `src/modules/permission/permission.repository.ts`; cập nhật `docs/AUTHORIZATION.md` và `specs/role-permission-management/quickstart.md`.
- [x] T052 [US1] Chạy `npm run validate`, `npm run test:unit` và `npm run test:local:authorization` trên disposable local được phép; ghi kết quả thật vào `specs/role-permission-management/quickstart.md`, cập nhật `specs/role-permission-management/tasks.md` và kiểm Spec gate trên working tree.

## Phase 9: Amendment US1 — danh sách 5 quyền chưa bật

Phụ thuộc: T049 → T053 → T054 → T055 → T056. T052 và T056 dùng chung đợt kiểm chứng cuối sau khi cả search và inactive đã triển khai. Chưa bật nghĩa là Permission.isActive=false như quyết định toàn cục đã chốt; không đổi bộ quyền vai trò. Các task có thể được tác giả chuẩn bị cùng search nhưng checkpoint chỉ xác nhận sau kiểm chứng chung.

- [x] T053 [US1] Ghi FR-018/SC-008, guard và hợp đồng GET /api/permissions/inactive?page=1 cố định 5 mục trong `specs/role-permission-management/spec.md`, `specs/role-permission-management/plan.md`, `specs/role-permission-management/contracts/role-permission-api.md`.
- [x] T054 [US1] Thêm unit/HTTP validation page/default5/limit override và guard trong `tests/permission-management.test.ts`; thêm fixture PostgreSQL ít nhất7 inactive và 1 active, duyệt nhiều trang/ngoài cuối, hasNext và đối chiếu không trùng/mất/không lẫn active trong `tests/authorization.integration.test.ts`.
- [x] T055 [US1] Tạo schema/Request DTO query inactive riêng tại `src/modules/permission/permission.validation.ts`, `src/modules/permission/permission.request.dto.ts`; nối GET /permissions/inactive qua controller/service/repository, đặt predicate isActive=false trước pagination và giữ allowlist DTO trong `src/modules/permission/permission.repository.ts`, `src/modules/permission/permission.service.ts`, `src/modules/permission/permission.controller.ts`, `src/modules/permission/permission.routes.ts`.
- [x] T056 [US1] Cập nhật API docs `docs/AUTHORIZATION.md`, quickstart và task status; chạy quality, unit và PostgreSQL authorization trên disposable local được phép, kiểm Spec gate và ghi kết quả thật trong `specs/role-permission-management/quickstart.md`, `specs/role-permission-management/tasks.md`.
