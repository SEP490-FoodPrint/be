# Implementation Plan: Vô hiệu hóa tài khoản và tạm dừng tiếp nhận công việc

**Branch**: `feat/016-account-deactivation` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: `specs/016-account-deactivation/spec.md`, gồm toàn bộ lựa chọn đã được người dùng xác nhận trong phiên làm rõ.

## Summary

Bổ sung vô hiệu hóa admin trường/nhà cung cấp cùng toàn bộ thành viên khi tổ chức đích không có đơn IN_PROGRESS; vô hiệu hóa riêng cán bộ khi mọi yêu cầu gửi tới người đó đều CLOSED. System Admin có user.manage chủ động bật/gỡ tạm dừng: trường không tạo/gửi đơn mới, NCC không nhận đơn SENT, cán bộ không nhận yêu cầu chưa tiếp nhận. Công việc đã nhận vẫn được xử lý theo quyền hiện hành.

Thiết kế thêm trạng thái tiếp nhận độc lập trên School/Supplier/User cán bộ; giữ DEACTIVATED cho khóa tài khoản. Giữ định danh kỹ thuật xã và bảo đảm một tài khoản cán bộ/xã. Ghi rõ người nhận và thời điểm tiếp nhận báo cáo, không suy diễn từ trạng thái gửi thông báo. Dùng transaction Serializable và giao thức khóa chung, query nằm trong repository.

Luồng tạo/gửi đơn đã có trong supplier-onboarding sẽ được tích hợp guard. Bổ sung hai action tối thiểu nhận đơn và nhận báo cáo để hành vi tạm dừng được thực thi tại điểm ghi thật. Không xây dựng toàn bộ lifecycle giao hàng hoặc điều tra ngộ độc.

## Technical Context

**Language/Version**: Node.js 24.22.1 theo `.nvmrc`; TypeScript 6.0.3 strict; CommonJS, Node16 module resolution.

**Primary Dependencies**: Express 4.21.2, Prisma/client/adapter-pg 7.10.1, Zod 4.6.7, PostgreSQL qua pg, Redis/session/rate-limit hiện có. Không thêm framework hoặc dịch vụ.

**Storage**: PostgreSQL schema foodprint; migration mới cho intakeState, recipientUserId/receivedAt và partial unique cán bộ. Redis giữ phiên/rate-limit, không cache quyết định quyền/trạng thái ghi.

**Testing**: Node test runner qua tsx; HTTP injection; PostgreSQL disposable cho migration, rollback và cạnh tranh; giữ test:unit là bộ không hạ tầng.

**Target Platform**: Backend Linux/Node hiện tại, PostgreSQL local khi phát triển; Azure chỉ qua quy trình deploy được duyệt.

**Project Type**: Web service REST; không sửa frontend, không thêm worker/trigger.

**Performance Goals**: Không thêm SLA/tải giả định ngoài spec. Dùng EXISTS có index, updateMany theo scope trong một transaction; không vòng lặp truy vấn hoặc revoke Redis cho từng tài khoản. Đo thời gian khóa/transaction trong integration để không vượt giới hạn helper hiện có (maxWait 10s, timeout 20s), không coi đây là cam kết độ trễ sản phẩm.

**Constraints**: Effective permissions được đọc lại mỗi request và trong transaction; role không bypass. Mọi ghi liên quan cùng transaction client. Trạng thái tạm dừng không làm mất login hoặc quyền xử lý việc đã nhận. Không DB mutation, seed, introspection hoặc deploy trong bước lập kế hoạch.

**Scale/Scope**: Hai loại tổ chức có một admin và nhiều thành viên; một cán bộ mỗi xã, kể cả inactive. Ba thao tác quản trị (đọc lifecycle, deactivation, thay intake state), hai action nhận tối thiểu, hai write path tạo/gửi hiện có và shared guard cho writer liên quan.

## Constitution Check

Đối chiếu trước Phase 0 và sau Phase 1:

| Nguyên tắc                       | Trước nghiên cứu | Sau thiết kế và bằng chứng                                                                                                                                                                                         |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Module phân lớp               | PASS             | account-lifecycle/supply-order/reporting đủ routes, controller, validation, service, repository, request DTO, response DTO. Refactor hẹp create/send đang chứa query; shared guard service không dựng Prisma args. |
| II. Phân quyền/cô lập            | PASS             | SYSTEM_ADMIN+SYSTEM+user.manage; supplier scope và officer recipient từ DB. Quyền receive mới chỉ action hẹp, bootstrap tách vận hành. Không lấy organizationId từ body để cấp scope.                              |
| III. An toàn DB                  | PASS             | Chỉ thiết kế migration bổ sung, không sửa baseline/migration cũ, không chạy DDL/seed. Duplicate/orphan preflight dừng, không xóa/gộp account.                                                                      |
| IV. Transaction/cache/rate limit | PASS             | authorizationTransaction Serializable, retry có giới hạn; khóa parent chung và cùng tx; không cache quyền, không đổi limiter/Redis.                                                                                |
| V. HTTP/DTO                      | PASS             | Zod strict, thông báo tiếng Việt, envelope hiện có, allowlist DTO, ISO Date; giữ hợp đồng create/send cũ.                                                                                                          |
| VI. Spec-driven                  | PASS cho Phase 1 | Spec clarified; branch Git thực tế đúng feat/016-account-deactivation, feature 016. tasks.md sẽ được tạo bằng speckit-tasks trước triển khai/PR hoàn chỉnh.                                                        |

Không có vi phạm cần ngoại lệ. Setup script xuất BRANCH theo feature slug `016-account-deactivation`; tên branch trong tài liệu lấy từ Git thực tế. Bộ spec hiện dùng số 016 vì số 013 đã được cooking-batch-groups sử dụng; đây là đổi định danh cùng tính năng, không thêm phạm vi nghiệp vụ.

## Project Structure

### Documentation (this feature)

```text
specs/016-account-deactivation/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/account-lifecycle-api.md
└── quickstart.md
```

`tasks.md` là đầu ra của bước `$speckit-tasks`, chưa được tạo trong plan.

### Source Code (repository root)

```text
src/modules/account-lifecycle/                 # mới, router action dưới /api/users
  account-lifecycle.routes.ts
  account-lifecycle.controller.ts
  account-lifecycle.validation.ts
  account-lifecycle.service.ts
  account-lifecycle.repository.ts
  account-lifecycle.request.dto.ts
  account-lifecycle.response.dto.ts
  intake-access.service.ts                    # guard nội bộ, không DTO HTTP
  intake-access.repository.ts                 # lock/read trusted scope
src/modules/supply-order/                      # giữ GET, thêm action accept
  supply-order.{routes,controller,validation,service,repository}.ts
  supply-order.request.dto.ts
  supply-order.response.dto.ts
src/modules/reporting/                         # giữ GET, thêm action receive
  reporting.{routes,controller,validation,service,repository}.ts
  reporting.request.dto.ts
  reporting.response.dto.ts
src/modules/supplier-onboarding/               # refactor hẹp create/send được sửa
  supplier-onboarding.repository.ts
  supplier-onboarding.request.dto.ts
  supplier-onboarding.response.dto.ts
  supplier-onboarding.{validation,service,controller}.ts
src/utils/authorization.ts                     # tái sử dụng transaction; không chặn pause chung
src/utils/resource-access.ts                   # giữ scope; bổ sung recipient mapping ổn định
src/constants/permission-catalog.ts
src/routes/index.ts
prisma/schema.prisma
prisma/migrations/<new-reviewed-migration>/migration.sql
src/scripts/check-account-lifecycle-data.ts    # preflight chỉ đọc
src/scripts/check-commune-officers.ts          # nếu cần tách, ưu tiên gộp cùng preflight
src/modules/README.md
docs/AUTHORIZATION.md
database/SCHEMA_BASELINE.md
tests/account-lifecycle.test.ts
tests/intake-access.test.ts
tests/account-lifecycle.integration.test.ts
tests/migrations.test.ts
package.json                                  # đăng ký unit/integration/preflight
```

**Structure Decision**: Dùng module account-lifecycle làm nơi sở hữu trạng thái và luật quản trị; không biến user list thành service tổng hợp nghiệp vụ. Account-lifecycle controller không import DTO, service nhận Request DTO từ schema và map kết quả. Guard nội bộ được các service tạo/gửi/nhận gọi bằng trusted scope; query và SQL lock nằm trong intake-access.repository. Router action được mount cùng prefix users nhưng không thay GET danh sách hiện có. Không tạo client DB/transaction độc lập trong repository.

## Phase 0 — Research (hoàn tất)

Đã đối chiếu schema, migration admin uniqueness, scope, authentication/session, permission catalog và write paths. [research.md](research.md) ghi từng Decision/Rationale/Alternatives considered:

1. Trạng thái tạm dừng riêng; không đổi status login hoặc EntityStatus.
2. Một officer/xã và recipient/receipt rõ ràng, giữ bảng xã làm mapping kỹ thuật.
3. Tích hợp create/send thực có; chỉ thêm hai action nhận tối thiểu, không full CRUD.
4. Reuse quyền nhận đơn, thêm food_safety_report.receive giới hạn cho officer, không dùng quyền đọc để ghi.
5. Serializable và khóa parent chung, không chỉ pair advisory lock.
6. Trạng thái DB là căn cứ khóa phiên; không phụ thuộc Redis cleanup.
7. Unit/HTTP và race/migration integration riêng, không thao tác DB hiện tại.

## Phase 1 — Design (hoàn tất)

### Dữ liệu và vận hành

Theo [data-model.md](data-model.md): trường intakeState mặc định ACTIVE, CHECK đúng từng owner, partial unique officer không lọc theo account status, nullable recipient/receipt và index bổ sung. Không thay bảng đơn vị xã thành tổ chức nhiều tài khoản.

Migration có preflight chỉ đọc để phát hiện duplicate officer, recipient nội bộ không xác định, membership lệch. Không gán receipt lịch sử từ forwardedAt hoặc NotificationStatus. Giữ receipt null nếu chưa có bằng chứng; việc xác nhận dữ liệu vận hành cũ cần operator duyệt riêng. Khi dữ liệu không đáp ứng preflight, không deploy thay vì tạo/xóa/gộp tài khoản. Legacy internal forwarding chưa ánh xạ vẫn phải được xét blocker theo xã để không có lỗ hổng khóa.

### Hợp đồng và phân quyền

[contracts/account-lifecycle-api.md](contracts/account-lifecycle-api.md) xác định body/response, quyền/scope, trạng thái lỗi, idempotency và tương thích:

- GET `/api/users/:userId/lifecycle`.
- POST `/api/users/:userId/deactivate`.
- PATCH `/api/users/:userId/intake-state`.
- POST `/api/supply-requests/:id/accept`.
- POST `/api/food-safety-reports/:id/receive`.
- Tích hợp hai route create/send hiện có, không đăng ký route trùng.

Grant catalog mới cho officer chỉ food_safety_report.receive. Không thay grant của role khác hoặc bật lại permission inactive khi bootstrap; database vận hành cần operator/bootstrap đã được ủy quyền. Không tự chạy bootstrap trên Azure hoặc startup.

### Atomicity và enforcement

Tất cả mutation nạp actor/quyền hiện hành, resolve target từ scope tin cậy, khóa School → Supplier → User → Role actor (ID tăng dần), khóa order/report sau các khóa này, đọc lại và ghi trong cùng Serializable transaction. Helper hiện có xử lý tối đa ba lượt conflict; repository không mở transaction riêng. Luồng create/send phải lấy parent locks trước pair advisory lock; rà soát mọi caller lockSupplier để không tạo chu trình khóa với đường được sửa.

Vô hiệu hóa cascade dùng updateMany theo tổ chức thực tế và checks EXISTS đúng trạng thái đã chốt. Membership writer và writer chuyển IN_PROGRESS/forward report phải dùng guard; các luồng chưa có HTTP được thử bằng trusted integration adapter, không tạo API fake. Chỉ thêm check intake vào hành động tạo/gửi/nhận mới, không vào authenticate, withSchoolTransaction hoặc mọi thao tác đọc/hoàn tất nói chung.

Chuyển IN_PROGRESS không bị chặn bởi PAUSED vì là công việc đã nhận, nhưng bị chặn nếu admin/account liên quan DEACTIVATED. Nhận đơn/nhận report lặp trả lại kết quả đã có mà không thay timestamps hoặc người nhận. Resume không tự tạo/gửi/nhận và không kích hoạt tài khoản.

### Ánh xạ yêu cầu và kiểm thử

| Yêu cầu            | Thiết kế/kiểm chứng bắt buộc                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| FR-001/002         | Ba role đích, role+permission+scope runtime; revoked permission trong transaction; không bypass                                |
| FR-003/004         | Matrix mọi SupplyRequestStatus; chỉ IN_PROGRESS chặn; cả school/supplier, mọi đối tác                                          |
| FR-005/006/008/013 | Cascade đủ mọi status, đúng org; officer riêng; rollback lỗi giữa chừng; giữ data/grants/denials                               |
| FR-007             | OPEN/INVESTIGATING/RESOLVED chặn; CLOSED không chặn; recipient đúng, legacy fallback, PENDING/FAILED và nhiều forwarding       |
| FR-009             | Login/refresh/me/business với phiên cũ sau DEACTIVATED; PAUSED vẫn đăng nhập/đọc                                               |
| FR-010/019         | Race thật suspension vs create/send/accept/receive, deactivation vs IN_PROGRESS/forward, membership phantom, permission revoke |
| FR-011/012         | Strict validation, lỗi tiếng Việt, envelope, idempotency, không lộ record/secrets hoặc partial success                         |
| FR-014–018         | Bật/gỡ chủ động; giới hạn đúng owner; đơn/yêu cầu cũ chưa nhận vẫn chặn; việc đã nhận tiếp tục; resume không tự chạy           |
| SC-001–008         | Các tình huống nghiệm thu trong quickstart; kết quả trạng thái và phạm vi khớp 100% dữ liệu kiểm thử                           |

### Chất lượng và release

- Unit mới được đưa vào test:unit. Dùng test:authorization hiện có hoặc integration script mới có harness tương đương tạo DB local tạm; CI Backend quality phải chạy suite mới cùng migration/authorization.
- Migration tests kiểm tra default/check/unique, nâng cấp dữ liệu hợp lệ, từ chối duplicate/orphan và bảo toàn baseline. Không sửa CHECK hoặc manifest của migration đã áp dụng.
- Chạy prisma:validate/generate, lint, format check, typecheck, build và unit sau implement; test DB chỉ khi có target local disposable được chọn rõ. Không sửa kết nối nên không tự chạy DB/Redis check trong plan.
- Điều kiện release: mọi write route thực có dùng guard; hai action nhận có kiểm thử HTTP; race thật vượt qua; dữ liệu cũ đủ điều kiện migration; quyền receive được operator provision; không tuyên bố hoàn tất toàn lifecycle đơn/điều tra chưa thuộc spec.
- Bước tiếp theo: `$speckit-tasks` tạo dependency-ordered tasks. Chưa viết implementation hoặc tasks trong workflow plan.

## Complexity Tracking

Không có vi phạm hiến chương cần ngoại lệ. Enum/CHECK/partial index và hai trường nhận báo cáo phục vụ trực tiếp yêu cầu đã chốt; giữ mô hình kỹ thuật hiện có, không thêm tổ chức cán bộ hoặc hệ thống audit mới.

## Lưu ý bootstrap quyền nhận báo cáo

Bootstrap hiện bảo toàn grants của role non-System đã tồn tại: tạo permission `food_safety_report.receive` trong catalog không tự gán quyền đó cho role cán bộ cũ. Sau bootstrap được phép, System Admin phải chủ động cấp quyền mới cho role qua chức năng quản trị; role cán bộ được tạo mới nhận grant mặc định. Không tự chạy bootstrap hoặc tự bật permission inactive trong ứng dụng hay CD.

## Điều chỉnh triển khai sau regression FR-002/FR-019

Các khóa của feature bổ sung Role actor sau User và trước resource. Thay denial cập nhật version User; thay grant cập nhật version Role bằng no-op SQL không đổi dữ liệu nghiệp vụ. `src/modules/permission/permission.repository.ts` chứa hai version-write này; `permission.service.ts` gọi trong transaction hiện có. Không thêm schema hoặc sửa migration. Kiểm thử PostgreSQL phải chứng minh permission/status/membership đổi sau lần đọc đầu tiên làm action thất bại khi recheck/retry.
