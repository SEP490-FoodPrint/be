# Implementation Plan: Nhà cung cấp tạo đơn từ yêu cầu hoặc tạo độc lập

**Branch**: `feat/supplier-order-creation` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: `specs/supplier-order-creation/spec.md`

## Summary

Thêm management API cho admin/staff nhà cung cấp tạo Delivery theo hai cách: copy toàn bộ yêu cầu đã tiếp nhận, hoặc chọn trường liên kết ACTIVE và nguyên liệu supplier để tạo độc lập. Cả hai có danh sách/chi tiết, mã riêng và idempotency bền vững. Mở rộng Delivery/DeliveryItem để trường/nguyên liệu được lưu trực tiếp và nguồn nullable; không tạo yêu cầu giả. Đồng bộ các đường đọc/kiểm nhận/kho để xử lý standalone an toàn, giữ nguyên nghiệp vụ nguồn cũ.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict, Node24.22.1 theo .nvmrc, CommonJS và Node16 resolution.

**Primary Dependencies**: Express4, Zod4, Prisma7.10.1 với PostgreSQL adapter hiện có; node:crypto UUID/SHA256; không dependency/framework mới.

**Storage**: PostgreSQL foodprint; mở rộng Delivery, DeliveryItem và enum mới; migration có backfill mapping xác định, CHECK/FK/index mới. Redis chỉ tiếp tục hạ tầng auth/rate-limit, không làm kho idempotency.

**Testing**: Node test runner/tsx; unit/HTTP, migration/authorization/lifecycle trên disposable local được chọn và ủy quyền.

**Target Platform**: Backend Node/Linux hiện có; không frontend hoặc deployment trong bước này.

**Project Type**: Express web service với các module phân lớp.

**Performance Goals**: List20 mặc định/100 tối đa, limit+1, scope/filter/pagination tại DB; standalone tối đa100 dòng, batch validate/query không N+1; không đặt SLA độ trễ/tải mới ngoài spec.

**Constraints**: Không fake nguồn hoặc tự cấu hình handlingType; giữ applied migrations, chứng từ/kho cũ; source budget và reject count không áp qua nhóm null; không cache quyền; cùng transaction cho business checks và ghi.

**Scale/Scope**: Hai role, hai cách tạo, năm management endpoint; hai quan hệ nguồn nullable kéo theo audit delivery/warehouse/kitchen/menu/resource scopes. Thay đổi canonical fields là dependency bắt buộc trước mở API.

## Constitution Check

_GATE kiểm tra trước Phase0 và đánh giá lại sau Phase1._

| Nguyên tắc                    | Trước | Sau  | Cách đáp ứng                                                                                                                                                            |
| ----------------------------- | ----- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Phân lớp                   | PASS  | PASS | Supplier-order đủ bảy file; strict Zod + Request DTO infer, Response DTO riêng; service orchestration/mapping; repo Prisma/SQL; refactor query cũ ở đúng vùng chạm sửa. |
| II. Quyền/scope               | PASS  | PASS | Reload AuthPrincipal, hai role rõ ràng, manage tạo; resource permission OR cho đọc, WHERE supplier/school chuẩn, không SYSTEM bypass hoặc cache.                        |
| III. An toàn DB               | PASS  | PASS | Chỉ thiết kế migration mới, không DDL ở bước plan; review/preflight/backfill xác định; không sửa/xóa lịch sử hoặc deploy remote.                                        |
| IV. Transaction/cache/limiter | PASS  | PASS | Serializable, parent/pair/source locks nhất quán; durable idempotency cùng DB tx, không side effect trước commit; giữ Redis fail-closed.                                |
| V. HTTP/projection            | PASS  | PASS | Envelope cũ, DTO allowlist, Decimal/date/null, nullable source rõ ràng; không lộ key/hash/user secret.                                                                  |
| VI. Theo spec                 | PASS  | PASS | Branch/spec cùng slug; đủ research/model/contracts/quickstart, tasks tạo ở bước sau; không thêm luồng giao vận hoặc thay quy tắc kiểm nhận nguồn.                       |

Không có ngoại lệ hiến chương cần phê duyệt. Việc sửa model/migration chỉ thực hiện ở implementation sau tasks; chạy DB cần đúng phạm vi ủy quyền. Plan không thay source/prisma hoặc dữ liệu DB.

## Project Structure

### Documentation (this feature)

```text
specs/supplier-order-creation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/supplier-orders.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md                          # Tạo sau bằng speckit-tasks
```

### Source Code (repository root)

```text
src/modules/supplier-order/            # Module management mới
├── supplier-order.routes.ts
├── supplier-order.controller.ts
├── supplier-order.validation.ts
├── supplier-order.request.dto.ts
├── supplier-order.response.dto.ts
├── supplier-order.service.ts
└── supplier-order.repository.ts
src/modules/account-lifecycle/intake-access.service.ts
src/modules/account-lifecycle/intake-access.repository.ts
src/modules/delivery/delivery.{service,repository,response.dto}.ts
src/modules/warehouse/warehouse.{service,repository}.ts
src/modules/kitchen/kitchen.{service,repository}.ts
src/modules/menu/menu.{service,repository}.ts
src/utils/resource-access.ts
src/routes/index.ts
prisma/schema.prisma
prisma/migrations/<new-reviewed-migration>/migration.sql
tests/supplier-order-creation.test.ts
tests/supplier-order-creation.integration.test.ts
tests/delivery-inspections.test.ts
tests/modules.test.ts
tests/authorization.test.ts
tests/authorization.integration.test.ts
tests/account-lifecycle.integration.test.ts
tests/migrations.test.ts
tests/kitchen-nutrition-lists.test.ts
tests/kitchen-nutrition-wire.integration.test.ts
docs/AUTHORIZATION.md
src/modules/README.md
database/SCHEMA_BASELINE.md
package.json
```

**Structure Decision**: Supplier-order sở hữu management APIs, persistence chung Delivery; delivery giữ API cũ/inspection. Các scope xuyên kho/bếp/menu được cập nhật theo canonical relations, không mở API khác. Giữ tương thích dữ liệu/response có nguồn; nullability mới được ghi rõ cho standalone.

## Phase 0 — Research

Đã hoàn thành [research.md](research.md): source-required hiện hành; canonical school/ingredient/entry; migration legacy; idempotency; permissions; locks; hậu quả nullable nguồn với kiểm nhận và kho. Hai research agent rà soát chỉ đọc, không ghi source hoặc chạy DB. Không còn câu hỏi kỹ thuật chưa giải quyết trước thiết kế.

## Phase 1 — Design

### Dữ liệu và migration trước endpoint

Theo [data-model.md](data-model.md): schoolId/ingredientId trực tiếp bắt buộc, entryId có thể chưa có khi tạo standalone, nguồn nullable, mode và key/hash, indexes/CHECK. Backfill có provenance từ nguồn hiện có, dừng khi dữ liệu mâu thuẫn. Legacy nhiều delivery/request được giữ, không áp unique toàn cục hoặc đổi mã/trạng thái/quantities. Fixture/writer trực tiếp thêm canonical fields sau generate; không auto tạo entry hoặc source giả.

### Tạo từ yêu cầu

Strict REQUEST body chỉ nguồn + metadata; supplierId từ actor. Trong Serializable tx, kiểm tra role/manage và guard START_ORDER_PROCESSING, khóa theo protocol, đối chiếu nguồn/tất cả dòng/nguồn chưa có Delivery, copy Decimal/unit đầy đủ; create CREATED và chuyển ACCEPTED -> IN_PROGRESS cùng tx. Q2 một đơn áp cho API mới, service từ chối cả nguồn đã có phiếu legacy; migration không xóa lịch sử để ép quota.

### Tạo độc lập

Strict STANDALONE body chọn trường từ options quan hệ ACTIVE và items thuộc supplier. Thêm intake operation SUPPLIER_CREATE_STANDALONE_DELIVERY, khóa/reload actor và hai đơn vị/admin/quan hệ/nguyên liệu; yêu cầu cung ứng mới không đi vòng pause. Trường body là target không phải trusted scope. Không cần yêu cầu/phiếu cũ, không tạo catalog trường, không sửa yêu cầu cũ. Đơn thiếu entry trường vẫn ở CREATED hợp lệ.

### Idempotency và mã

Idempotency-Key UUID bắt buộc; same actor+supplier+key/hash replay200 không đổi updatedAt, khác hash409. Key khác cho ý định standalone khác hợp lệ; REQUEST vẫn bị chặn bởi quota nguồn. Unique/index + transaction retry bảo vệ cross-process. Mã DG-UUID do hệ thống sinh, không cần bảng sequence và không nhận từ client.

### Read scope và downstream

Mọi list management/options kiểm tra resource permission và explicit supplier scope, repository xây query. Reads legacy scope school trực tiếp thay vì source.schoolId; backfill bảo đảm giá trị cũ không đổi. Inspect source-based giữ budget/count/cancel; standalone không gọi query source bằng null. Tất cả receipt vẫn bốn chữ ký, lots/date/unit/ownership đúng và receipt đúng một lần. Trước standalone receipt, lookup IngredientEntry đúng cặp trường/nguyên liệu; thiếu thì409, không đoán handlingType; đủ thì gắn entry trong cùng receipt tx. Kitchen/menu dùng entry chuẩn cho lot đã nhận, warehouse tên nguyên liệu lấy direct relation. Không mở endpoint tạo lot/ARRIVED mới, không tự cho phiếu CREATED kiểm nhận.

### Rà soát toàn bộ điểm ảnh hưởng

`resource-access.ts` có đường school scope qua source ở warehouse/delivery/inventory/quality-feedback/traceability: cập nhật đầy đủ, không chỉ delivery. Các repo/service kitchen/menu/warehouse và fixture/query projection tương ứng phải nhận source nullable. Query/helper mới dùng trong service phải nằm repository; vùng delivery legacy đang chứa select/args được dời đúng lớp khi sửa. Repo inspection bỏ import Request DTO, nhận internal query type.

## Execution Order and File Ownership

1. Migration/schema/preflight và unit contract; generate client, cập nhật fixture/writer canonical fields.
2. Scope/projections/downstream nullable safety và guard standalone trước khi mở POST.
3. Supplier-order repository -> service -> controller/routes; durable replay và options.
4. Integration receipt/legacy/catalog mapping, concurrency/permission/link/pause races và migration compatibility.
5. Tài liệu, validate/unit và báo cáo kiểm chứng, không deploy tự động.

Khi chia song song: A giữ prisma/migration + supplier-order validation/hai DTO/repository; B giữ intake guard và tests guard/lifecycle; C giữ supplier-order service/controller/routes + tests riêng sau handoff A/B. Người tích hợp giữ resource-access và delivery/warehouse/kitchen/menu/test hồi quy cùng routes index/docs. Do canonical field thay đổi nhiều fixture, chỉ một owner sửa mỗi fixture/test file tại một thời điểm. Schema và hợp đồng hoàn tất trước các consumer compile; không chia đơn thuần theo story nếu cùng file.

## Verification and Requirement Coverage

| Phạm vi    | Bằng chứng cần có                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–003 | Hai role, manage/denial, trusted supplier, linked ACTIVE school, outsider404; link/pause/auth races.                                                            |
| FR-004–007 | Create both modes, copied whole REQUEST, standalone without source/history, code/metadata/nulls, source quota và legacy-many migration.                         |
| FR-008     | Pagination/safe DTO, legacy value regression, school scopes mọi resource downstream.                                                                            |
| FR-009–010 | Rollback sau header/item/source update, same-key replay/different-payload conflict, source race hai actor, restart-independent persistence.                     |
| FR-011–013 | No old-request mutation, inspection source budget/count giữ, standalone reject không lan nhóm null, entry-before-receipt, lots usable đúng school/kitchen/menu. |
| SC-001–005 | HTTP và PostgreSQL hành trình hai role/cả hai cách; số lượng Decimal, không fake nguồn, lịch sử bảo toàn.                                                       |

Kiểm tra migration fresh và populated legacy trước review; unit file mới phải đăng ký test:unit. Sau implementation chạy prisma:validate/generate, npm run validate và npm run test:unit. PostgreSQL integration/migrations chỉ khi instance disposable được chọn và ủy quyền; không giả PASS khi chưa chạy. Hướng dẫn tại [quickstart.md](quickstart.md).

## Complexity Tracking

Không có vi phạm hiến chương. Phạm vi downstream lớn là hệ quả bắt buộc của bỏ nguồn; đã giới hạn ở an toàn nullability, school/ingredient mapping và giữ nghiệp vụ kiểm nhận có nguồn, không thêm workflow vận chuyển.
