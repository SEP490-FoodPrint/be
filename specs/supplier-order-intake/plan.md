# Implementation Plan: Tiếp nhận yêu cầu nguyên liệu của nhà cung cấp

**Branch**: `feat/supplier-order-intake` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: `specs/supplier-order-intake/spec.md`

## Summary

Hoàn thiện luồng danh sách -> chi tiết -> tiếp nhận cho admin và staff nhà cung cấp trên module `supply-order` hiện có. Bổ sung chi tiết, lọc trạng thái và thông tin trường/ngày giao ở danh sách; ẩn DRAFT; kiểm tra rõ hai role với quyền hiệu lực. Kế thừa POST nhận đơn và quy tắc intake/transaction; bảo toàn API tạo/gửi và nhánh danh sách phía trường.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; Node.js 24.22.1 theo `.nvmrc`, CommonJS/Node16 resolution.

**Primary Dependencies**: Express 4.21.x, Zod 4.6.7, Prisma 7.10.1, adapter PostgreSQL hiện có; không thêm dependency.

**Storage**: PostgreSQL, schema `foodprint`; tái sử dụng SupplyRequest, SupplyRequestItem, School, Supplier, IngredientEntry, Ingredient, User và quyền hiện hành. Không thay schema/migration.

**Testing**: Node test runner qua tsx; unit/HTTP dependency injection, integration auth trên PostgreSQL disposable local.

**Target Platform**: Backend Linux/Node đang có; không xây dựng frontend.

**Project Type**: Express web service.

**Performance Goals**: Danh sách mặc định 20, tối đa 100 mục/trang, lấy limit+1; dùng safe select và truy vấn quan hệ, không N+1. Không thêm SLA độ trễ hoặc mục tiêu tải chưa có trong spec.

**Constraints**: Supplier scope từ AuthPrincipal; quyền luôn hiện hành; Serializable và khóa cùng giao dịch cho ghi; trường hợp nhận lại không ghi; giữ response envelope/receipt hiện có; không cache đọc/phân quyền, không thay rate limiter.

**Scale/Scope**: Hai role, ba thao tác GET list/GET detail/POST accept trên một module; thêm dữ liệu đọc, không thêm trạng thái hay nghiệp vụ từ chối/giao hàng/tồn kho.

## Constitution Check

_GATE trước Phase 0 và kiểm tra lại sau Phase 1._

| Nguyên tắc                       | Trước nghiên cứu | Sau thiết kế | Cách đáp ứng                                                                                                                                     |
| -------------------------------- | ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Phân lớp                      | PASS             | PASS         | Controller gọi validation/service; Request DTO suy ra từ Zod, Response DTO riêng; service ánh xạ allowlist; Prisma args và SQL trong repository. |
| II. Quyền/phạm vi                | PASS             | PASS         | AuthPrincipal, ROLES/ORG_TYPES; quyền view/accept độc lập; listScopes cho danh sách, WHERE scope trong repository; không bypass hoặc cache.      |
| III. An toàn DB                  | PASS             | PASS         | Dùng schema sẵn có, không migration/seed/introspection; integration chỉ trên instance disposable được chọn rõ.                                   |
| IV. Transaction/cache/rate limit | PASS             | PASS         | Giữ authorizationTransaction, giao thức khóa và tx thống nhất; không thêm cache; rate limiter không thay đổi.                                    |
| V. HTTP/projection               | PASS             | PASS         | Giữ sendSuccess/sendError; serialize Date/Decimal; không lộ contractSnapshot hoặc tài khoản; receipt bốn trường giữ nguyên.                      |
| VI. Theo spec                    | PASS             | PASS         | Nhánh và spec cùng slug không số; FR-001–015 có ánh xạ thiết kế; tasks được tạo ở bước kế tiếp trước implement.                                  |

Không có ngoại lệ cần phê duyệt. Lệnh plan không sửa source hoặc thực hiện ghi database.

## Project Structure

### Documentation (this feature)

```text
specs/supplier-order-intake/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/supply-requests.md
├── checklists/requirements.md
└── tasks.md                    # Tạo bằng speckit-tasks sau plan
```

### Source Code (repository root)

```text
src/modules/supply-order/
├── supply-order.routes.ts
├── supply-order.controller.ts
├── supply-order.validation.ts
├── supply-order.request.dto.ts
├── supply-order.response.dto.ts
├── supply-order.service.ts
└── supply-order.repository.ts
src/modules/account-lifecycle/intake-access.service.ts
src/utils/resource-access.ts     # Tái sử dụng, không đổi scope SCHOOL/SYSTEM
src/routes/index.ts              # Giữ mount hiện có
tests/supply-order-intake.test.ts
tests/intake-access.test.ts
tests/modules.test.ts
tests/authorization.integration.test.ts
docs/AUTHORIZATION.md
src/modules/README.md
```

**Structure Decision**: Tập trung mở rộng module hiện có và điều chỉnh guard chung đúng operation tiếp nhận. Không tạo mapper hoặc client DB riêng. Các helper transaction/authorization và repository khóa đã có được giữ lại.

## Phase 0 — Research

Đã hoàn thành [research.md](research.md): xác định khoảng trống, scope riêng SUPPLIER, DRAFT 404, kiểu dữ liệu chi tiết, transaction và ma trận kiểm chứng. Không còn câu hỏi kỹ thuật chưa giải quyết.

## Phase 1 — Design

### Đọc danh sách và chi tiết

1. Validation mở rộng query với status optional cho năm trạng thái ngoài DRAFT. Giữ chuẩn hóa page/limit và giới hạn offset hiện hành; từ chối trường lạ. Params chi tiết dùng UUID schema chung; query chi tiết phải rỗng.
2. Nhánh SUPPLIER kiểm tra hai role, permission và membership; gọi listScopes để xác lập scope. Nhánh SCHOOL/SYSTEM giữ hành vi và DTO cũ; status trên hai nhánh này bị từ chối để giữ hợp đồng query trước đó.
3. Repository áp scope cùng tập trạng thái đã gửi và status tùy chọn, giữ id asc, limit+1. Chỉ nhánh supplier bổ sung select School id/name, ngày giao và thời điểm gửi. Chi tiết mới chỉ dành cho supplier, select đầy đủ dòng nguyên liệu và không loại nguyên liệu/entry inactive.
4. Services trả DTO supplier riêng mở rộng DTO list cũ; chi tiết có DTO riêng. Không trả persistence row hoặc Prisma Decimal. Hợp đồng cụ thể tại [contracts/supply-requests.md](contracts/supply-requests.md).

### Tiếp nhận và nhất quán

1. Kiểm tra đúng hai role supplier và accept permission trước tx; guard xác minh lại các điều kiện actor sau reload trong tx, trước cả nhánh trả receipt.
2. Trong guard `SUPPLIER_ACCEPT_ORDER`, DRAFT trả 404; các trạng thái hoàn thành/hủy trả 409; không sửa nhánh guard create/send/receive. Trường hợp ACCEPTED/IN_PROGRESS trả receipt hiện có sau kiểm tra quyền/scope, trước kiểm tra tạm dừng nhận mới.
3. Giữ thứ tự khóa và Serializable retry hiện hành; update SENT -> ACCEPTED có điều kiện supplierId và ghi actor/time nguyên tử. Sử dụng cùng tx cho tất cả reads/writes; map receipt bốn trường như cũ.
4. Quyền bị thu hồi, membership thay đổi, pause hoặc deactivation cạnh tranh phải được kiểm tra theo giao thức hiện có. Không thêm cơ chế hủy đơn mới; kiểm tra xung đột trạng thái để lần nhận thất bại không ghi dở dang.

### Kiểm chứng và tài liệu

- Unit/HTTP: hai role, view/accept độc lập, sai role/org, scope giả mạo, filter/limits/UUID, DRAFT 404, chi tiết inactive/null/Decimal/date, safe projection, receipt thử lại, repository failures.
- Repository tests chứng minh WHERE luôn giữ supplier scope + trạng thái, pagination và nested select; kiểm thử service chứng minh mapping allowlist và cùng tx.
- Regression SCHOOL/SYSTEM GET và tạo/gửi đơn giữ nguyên; guard của operation khác không đổi.
- PostgreSQL integration: hai tài khoản nhận đồng thời, receipt sau retry, pause/deactivate/thu quyền/membership race và rollback; dùng harness hiện có, chỉ chạy khi có instance disposable được chọn và ủy quyền rõ.
- Cập nhật endpoint matrix và module README. Chạy `npm run validate`, `npm run test:unit` sau triển khai, ghi kết quả thực cùng các prerequisite chưa đáp ứng.

## Dependency and Execution Order

1. Hợp đồng/DTO và validation.
2. Repository scope/select/detail dựa trên hợp đồng; guard role/DRAFT có thể triển khai độc lập với repository.
3. Service mapping và orchestration sau repository/guard; controller/routes sau service.
4. Unit/HTTP và regression, rồi PostgreSQL race; cập nhật tài liệu và quality checks.

Khi phân công song song ở bước implement, giao trọn bộ file cho một người: (A) validation + hai DTO + repository; (B) intake-access.service + intake-access tests; (C) module service/controller/routes sau hợp đồng A + supply-order tests. Người tích hợp giữ tests/modules, authorization.integration và docs. Không đồng thời sửa cùng file. Đây là cách tổ chức dự kiến; tasks sẽ ghi chi tiết dependency.

## Requirement Coverage

| Yêu cầu    | Thiết kế và kiểm chứng                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| FR-001–003 | Hai role, quyền độc lập, membership và repository WHERE; negative auth/tenant tests.    |
| FR-004–005 | Supplier list/filter/page, nested School select; giữ SCHOOL/SYSTEM regression.          |
| FR-006–007 | Detail DTO, full items, ID người nhận/null, date/Decimal mapping và projection tests.   |
| FR-008–011 | Guard riêng operation, DRAFT 404, SENT transition, receipt retry và lifecycle matrix.   |
| FR-012–013 | Shared tx/locks, reload actor, conditional update; concurrency/permission/intake tests. |
| FR-014–015 | Shared validation/errors/envelope, không lộ dữ liệu, giữ API và regression cũ.          |

## Complexity Tracking

Không có vi phạm hiến chương hoặc thành phần hạ tầng mới cần giải trình.

## Implementation handoff (T003–T005)

- Repository giữ `list(query, scope)` cho legacy; thêm `listForSupplier(query, scope)` và `findDetailForSupplier(id, supplierId)`. query repository là internal type gồm page/limit/status optional, không import Request DTO. Export `SupplierOrderListRow`, `SupplierOrderDetailRow`; giữ AcceptedOrderRow và accept/findForSupplier.
- Response DTO thêm `SupplierOrderListResponseDTO` và `SupplierOrderDetailResponseDTO`, giữ `SupplyOrderListResponseDTO` và receipt; Request DTO thêm `SupplyOrderDetailParamsRequestDTO`. Validators thêm `validateSupplyOrderDetailParams`, `validateSupplyOrderDetailQuery`; list status chỉ supplier, service từ chối status trên legacy branch.
- Root giữ docs, tasks/quickstart, modules/authorization/supplier-onboarding regression và integration files. Lane A giữ validation/hai DTO/repository; B giữ intake guard + guard tests; C giữ service/controller/routes + supply-order tests. Không chồng file.
- Role check của supplier accept diễn ra trước tx và trong guard trước/sau reload; role check sau guard tại service phòng vệ dependency injection. Giữ quyền view/accept độc lập và lock protocol.
- Unit hiện đã đăng ký; không thêm dependency/schema. PostgreSQL integration đã được người dùng ủy quyền và kiểm chứng trên container PostgreSQL 18 tạm riêng theo T032; kết quả tại quickstart.md.
