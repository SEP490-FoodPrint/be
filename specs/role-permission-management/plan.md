# Implementation Plan: System Admin quản lý quyền và bộ quyền vai trò

**Branch**: `feat/role-permission-management` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/role-permission-management/spec.md`

## Summary

Mở rộng module permission để System Admin xem vai trò, thêm quyền, sửa tên/mô tả, tạm ngừng/kích hoạt quyền toàn hệ thống và lưu bộ quyền của mọi vai trò trừ SYSTEM_ADMIN. Bộ quyền SYSTEM_ADMIN chỉ đọc; trạng thái toàn cục vẫn chi phối quyền hiệu lực của chính System Admin.

Dùng schema hiện có, không migration/catalog/grant mới. Giữ permission.view và permission.create cho các thao tác hiện hành; tái dùng role_permission.manage cho sửa metadata/trạng thái và bộ quyền; GET /api/roles mới dùng role.view. Refactor module theo validation → service → repository và hai DTO riêng. Ghi trong Serializable transaction, khóa/recheck actor và permission mục tiêu; lưu grant bằng chênh lệch để giữ quyền inactive đã gán và mọi denial.

Complaint nằm ở nhánh riêng và tạm dừng; không có tài liệu hoặc thay đổi complaint trong kế hoạch này.

## Technical Context

**Language/Version**: Node.js 24.22.1 theo .nvmrc; TypeScript 6.0.3 strict; CommonJS, Node16 module resolution; relative imports extensionless như runtime hiện tại.

**Primary Dependencies**: Express 4.21.x, Prisma 7.10.1 với client cjs hiện có, Zod 4.6.7; helper authorizationTransaction, request-validation, directory-validation, list-query và resource-access của repository. Không thêm package/framework.

**Storage**: PostgreSQL, schema foodprint; các model Role, Permission, RolePermission, UserPermissionDenial và User hiện có. Redis giữ nhiệm vụ session/rate limit hiện hữu; không thêm cache phân quyền hoặc thay connection config.

**Testing**: Node test runner qua tsx; unit/HTTP với repository giả lập; integration trong authorization.integration.test.ts qua runner local/disposable DB hiện có. Không tạo container PostgreSQL mới.

**Target Platform**: Backend Express chạy trên môi trường Node/Linux hiện có; URL /api, giữ cookie/bearer session và CSRF.

**Project Type**: Backend web service, không có phần UI trong phạm vi.

**Performance Goals**: Danh sách chỉ đọc limit+1 bản ghi mỗi trang, mặc định 20/tối đa 100; một bộ quyền tối đa 1.000 ID. Không thêm SLO thời gian/throughput chưa được yêu cầu. Ưu tiên kết quả đầy đủ, quyền đổi từ request kế tiếp và bounded retry khi có cạnh tranh.

**Constraints**: SYSTEM_ADMIN grants chỉ đọc; mọi thao tác vẫn kiểm guard; không bỏ qua denials; không query Prisma trong service; không DTO trong controller/repository; tất cả recheck/read/write cùng transaction; không DDL/introspection/seed hoặc sửa dữ liệu môi trường trong bước lập kế hoạch.

**Scale/Scope**: Danh mục role/permission dùng chung toàn hệ thống; thay grants tác động mọi tài khoản mang role trong mọi tổ chức, nhưng scope tài nguyên nghiệp vụ không đổi. Một module được mở rộng, bốn endpoint mới; GET /permissions mở rộng search, các endpoint hiện có giữ envelope.

## Constitution Check

Gate trước Phase 0: **PASS**. Đã đọc constitution 2.0.0 và AGENTS.md; hai quyết định người dùng trong spec không còn câu hỏi chờ trả lời.

| Nguyên tắc                        | Thiết kế đáp ứng                                                                                                                                                                                                | Sau Phase 1 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| I — Phân lớp                      | Controller validate; DTO request z.infer; service authorization/transaction/mapping; repository query/locks. Refactor cả user permissions/denials thuộc module đang mở rộng để không để lại query trong service | PASS        |
| II — Phân quyền/cô lập            | Principal hiện hành; SYSTEM_ADMIN + SYSTEM + guard; scope catalog toàn cục tường minh qua resource-access; SYSTEM_ADMIN grant writes 403; tenant denials giữ scope; không auth cache/bypass                     | PASS        |
| III — DB safety                   | Dùng trường isActive và quan hệ sẵn có, không schema/migration/seed; integration chỉ trên disposable local instance khi có cho phép riêng                                                                       | PASS        |
| IV — Transaction/cache/rate limit | Shared Serializable wrapper, cùng tx và thứ tự locks; giữ Redis fail closed/session/rate limit; không dùng cache helper cho quyền                                                                               | PASS        |
| V — HTTP/output                   | Giữ response helpers/envelopes; DTO allowlist; lỗi Việt Nam và paths; không secrets; không đổi role/org codes                                                                                                   | PASS        |
| VI — Spec-driven                  | Cùng nhánh/spec role-permission-management, không complaint; plan/research/model/contract/quickstart ở Phase 1, tasks.md đã tạo bằng speckit-tasks trước code                                                   | PASS        |

Gate sau Phase 1: **PASS về thiết kế**, không có ngoại lệ. Kết quả này không thay thế typecheck/build/unit/DB integration của bước implement.

## Project Structure

### Documentation (this feature)

```text
specs/role-permission-management/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/role-permission-api.md
├── quickstart.md
└── tasks.md                         # Phase 2: đã tạo bằng speckit-tasks
```

### Source Code (repository root)

```text
src/
├── modules/permission/
│   ├── permission.routes.ts
│   ├── permission.controller.ts
│   ├── permission.validation.ts
│   ├── permission.request.dto.ts    # mới
│   ├── permission.response.dto.ts   # mới
│   ├── permission.service.ts
│   └── permission.repository.ts
└── utils/resource-access.ts
tests/
├── permission-management.test.ts    # mới; đăng ký test:unit
├── authorization.test.ts            # regression validator/guard/retry/bootstrap
└── authorization.integration.test.ts
docs/AUTHORIZATION.md
src/modules/README.md
package.json                         # chỉ đăng ký suite unit mới
```

**Structure Decision**: Mở rộng module permission thay vì tạo module role trùng trách nhiệm. src/routes/index.ts đã mount router này tại /api; thêm routes vào module, kiểm tra registration nhưng không tạo alias /v1. /api/auth/roles và auth/session giữ nguyên. permissionConcurrencyRepository.touchUser/touchRole tiếp tục được export vì module khác đang sử dụng.

## Phase 0 — Research đã hoàn tất

Xem [research.md](research.md). Hai hướng nghiên cứu chỉ đọc đã đối chiếu concurrency và contracts/catalog. Kết luận:

1. Toàn bộ mô hình dữ liệu cần thiết đã có.
2. Không cần mã quyền, bootstrap hoặc dependency mới.
3. Các truy vấn legacy của module permission cần chuyển sang repository.
4. Inactive grants được giữ bằng tập chênh lệch; không tái gán mới inactive.
5. Retry cần giữ lỗi DB thô đến shared wrapper, kể cả actor lookup và COMMIT.

Không còn quyết định kỹ thuật chưa giải quyết.

## Phase 1 — Thiết kế

### Luồng đọc và scope

GET /api/roles mới dùng guard role.view + System Admin; trả id/code/name/type/ editable. GET /permissions dùng permission.view, bao gồm inactive. GET /roles chỉ nhận page/limit; GET /permissions nhận thêm search tìm substring theo name không phân biệt hoa/thường. Từ khóa trim, tối đa 150 ký tự, rỗng thành không lọc; repository escape %, _ và backslash để contains có nghĩa literal, mode insensitive, áp lọc trước limit+1/offset. Giữ scope, thứ tự code/id và inactive. Role query dùng schema/Request DTO riêng để không nhận search rồi bỏ qua.

GET /roles/:roleId/permissions giữ role_permission.manage và shape hiện tại, bao gồm inactive đã gán. Ghép danh mục và bộ quyền để biết quyền chưa gán, không thêm cờ assigned dư thừa. Xem quyền người dùng/denials giữ semantics cũ và scope tổ chức.

### Luồng ghi và transaction

Service nhận AuthPrincipal tin cậy cùng Request DTO chuẩn hóa, định nghĩa transaction qua authorizationTransaction; repository nhận chính tx đó. Tư cách actor được đọc bằng identitySelect + principalFromIdentity trong repository, không qua wrapper đổi lỗi sớm. Kiểm tra identity/guard lại sau khi khóa, trước ghi; role/org đổi trong lúc chờ thì từ chối hoặc retry để đọc trạng thái mới.

Thứ tự khóa system write: actor User UPDATE → union Role theo UUID, actor SHARE/target của PUT UPDATE → union Permission theo UUID, guard SHARE/target của PATCH UPDATE. Dùng mode mạnh nhất ngay từ đầu khi trùng row, không nâng cấp khóa sau. PUT khóa C∪R và guard, kiểm tập và đọc lại dưới cùng tx. Status write không quay lại khóa mọi role bị ảnh hưởng.

Refactor denial writes theo thứ tự parent school/supplier → users → roles → permissions đang được các module liên quan sử dụng, bảo toàn scope/guards. Giữ export touchUser/touchRole và tạo MVCC version khi denial/grants thật sự đổi. Các lỗi retry giữ nguyên đến shared wrapper; không tăng attempts/timeouts hoặc thêm transaction riêng trong repository.

- Create: active mặc định, không gán grant; unique code thành 409, không nuốt conflict.
- Metadata PATCH: name/description, ít nhất một trường, không đổi isActive hoặc ý nghĩa mã.
- State PATCH: boolean isActive, lặp cùng trạng thái 200; bảo toàn grants/denials.
- PUT bộ quyền: thêm R−C active, giữ C∩R kể cả inactive, xóa C−R; SYSTEM_ADMIN luôn 403.
- Tự tắt role_permission.manage có thể thành công cho request hiện tại; request sau bị 403. Không thêm cơ chế tự phục hồi hoặc chống tự khóa khác với spec.

Các thao tác nghiệp vụ sau commit đọc quyền mới; không mở rộng kế hoạch thành hủy tác vụ đã được chấp nhận ở module khác.

### Validation và hợp đồng đầu ra

Migrate validators permission sang Zod strictObject/safeParse qua parseRequest. Request DTO type-only z.infer, giữ nguyên giới hạn và normalization hiện hành, field paths cho nhiều lỗi. PATCH từ chối trường lạ/immutable; UUID normalize trước kiểm trùng. Pagination tái dùng schema chung.

Response DTO map trong service theo allowlist, không spread bản ghi DB. Giữ response shapes hiện tại; trạng thái lỗi và payload chi tiết nằm trong [contract](contracts/role-permission-api.md). Không trả persistence timestamp hoặc trường tài khoản mới.

### Tài liệu và vận hành

Cập nhật ma trận docs/AUTHORIZATION.md cho role list, metadata/state guards và global effect tới SYSTEM_ADMIN; cập nhật modules/README.md về ownership. Không sửa catalog/bootstrap, không seed qua startup/CD. [quickstart.md](quickstart.md) hướng dẫn validation sau implement; khôi phục vận hành khi tự tắt guard nằm ngoài phạm vi.

## Validation Strategy và truy vết

| Yêu cầu            | Kiểm chứng cần có sau implement                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–003         | Unit/HTTP guard SYSTEM/role/permission, trusted scope, pagination/order, inactive hiển thị, editable của SYSTEM_ADMIN                    |
| FR-004–005         | Create unique + no grants, metadata allowlist/null/trim/multi-errors, immutable fields, mapping an toàn                                  |
| FR-006–007, FR-011 | PUT empty/full/diff, inactive keep/remove/new reject, 1.000/1.001 IDs, duplicate sau normalize, System target luôn 403                   |
| FR-008–010, FR-012 | Global status ở nhiều role/tổ chức và System Admin; request kế tiếp dùng quyền mới; grants/denials bất biến; same-state; self-disable    |
| FR-013             | Barrier PostgreSQL cho cả hai thứ tự thắng; actor khóa/đổi role/guard inactive, hai PUT, grant vs status; rollback và retry query/COMMIT |
| FR-014–016         | Error envelope/field paths, safe DB failures, authority vẫn cấm dù có guard, hồi quy tổ chức/denials và code mới không tạo chức năng     |

Unit suite mới đăng ký test:unit; giữ các suite authorization/auth-session/modules/supplier-staff đang có. Integration mở rộng file authorization hiện hữu để dùng runner và manifest cleanup sẵn có; không tạo runner/container mới. Kiểm đếm/assert exact row snapshots để chứng minh không đổi grants/denials; không chỉ dựa HTTP status.

Sau implement cần npm run validate (lint/format/typecheck/build), npm run test:unit, Prisma validate/generate theo CI, và npm run test:local:authorization trên instance được chọn khi có cho phép ghi test riêng. Chạy lifecycle regression nếu thay đổi protocol khóa liên quan. Không thay PostgreSQL/Redis connection nên không có thay đổi connection cần db:check/redis:check riêng; integration auth vẫn cần Redis local.

Trong lần lập kế hoạch chỉ kiểm tài liệu, liên kết và định dạng; chưa chạy các lệnh kiểm chứng backend/DB trên và chưa tuyên bố SC nào đã đạt thực nghiệm. SC-005 cần walkthrough có UI/client tương ứng; không suy khả năng thao tác của người dùng từ unit tests.

## Rủi ro và giới hạn thực tế

- Quyền toàn cục có thể tắt guard của chính System Admin theo quyết định người dùng; không có bypass hoặc auto-recovery.
- PUT là full replacement; một lần lưu muộn có thể thay bộ quyền đã lưu trước đó, nhưng không để kết quả chắp vá. Chưa có cảnh báo stale editor.
- Khóa permission và role phối hợp với writers/readers hiện hữu; integration barrier là điều kiện xác nhận FR-013, mocks không thay thế PostgreSQL thực.
- Refactor có chạm API denials cũ vì cùng module; phải giữ regression và exports dùng ở module khác.
- Khả năng chạy DB test phụ thuộc cho phép trên instance disposable local; cấu hình/credentials tự nó không phải cho phép ghi.

## Complexity Tracking

Không có vi phạm hiến chương hoặc ngoại lệ kiến trúc cần ghi nhận.

## Kết quả workflow

Phase 0 và Phase 1 hoàn tất về tài liệu. Không có extensions.yml nên không có before_plan/after_plan hooks để chạy. Đã sửa phụ thuộc US1 → US2 và chạy lại `$speckit-analyze` không còn findings. `$speckit-implement` đã hoàn thành 48/48 tasks; quality, 739 unit, 63 authorization, 16 supplier onboarding và 29 lifecycle tests PASS. Bằng chứng tại [quickstart.md](quickstart.md); SC-005 chờ nghiệm thu người dùng/client phù hợp. Không migration hoặc deploy dữ liệu vận hành.

## Amendment — tìm quyền theo tên

Yêu cầu ngày 2026-11-17 mở rộng GET /api/permissions bằng search theo FR-017/SC-007; không thêm endpoint/guard hoặc thay schema. T049–T052 trong tasks.md triển khai amendment. Kiểm unit/HTTP normalization và PostgreSQL fixture cho literal wildcard, phân trang sau lọc, name-only và guards.

## Amendment — danh sách quyền chưa bật

GET /api/permissions/inactive?page=1 trả Permission DTO với isActive=false, guard SYSTEM_ADMIN/SYSTEM + permission.view; mỗi trang cố định 5, chỉ nhận page. Schema strict page → bổ sung limit=5 → tái dùng paginationSchema để giữ chuẩn kiểm tra offset, Request DTO suy ra riêng. Controller gọi service, repository đặt isActive=false trước listWindow, order code/id. Giữ response envelope và pagination {page,limit:5,hasNext}. Không tìm theo role hoặc grant chưa gán, không schema/migration. T053–T056 trong tasks.md kiểm chứng FR-018/SC-008.

## Kết quả hai amendment

Đã hoàn thành T049–T056; tổng 56/56 tasks. Search và inactive API đã qua 25 unit module,743 unit toàn repo, 65 authorization và 16 onboarding tests; npm run validate PASS. Chi tiết tại quickstart.md. Không đổi scope complaint, schema hoặc guards; SC-005 vẫn chờ nghiệm thu người dùng/client.
