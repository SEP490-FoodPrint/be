# Implementation Plan: Nhà cung cấp xem trường đã liên kết và hợp đồng

**Branch**: `feat/supplier-linked-schools` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: `specs/supplier-linked-schools/spec.md`

## Summary

Thêm chức năng chỉ đọc cho quản trị viên nhà cung cấp: danh sách mỗi trường một mục, chi tiết trường và quan hệ đại diện, danh sách/chi tiết hợp đồng ACTIVE hoặc CLOSED, mở/tải tệp SIGNED_CONTRACT và APPENDIX. Phạm vi luôn là nhà cung cấp trong principal hiện tại, gồm liên kết ACTIVE/SUSPENDED/UNLINKED; DRAFT, COMPLIANCE và tài nguyên của bên khác không được cung cấp.

Tạo module `supplier-school` gồm bảy file, năm GET dưới `/api/supplier-schools`. Repository chọn quan hệ đại diện bằng DISTINCT ON trước khi phân trang, áp dụng safe projection và truy vấn metadata tách nội dung tệp; service dùng transaction đọc RepeatableRead và ánh xạ DTO tường minh. Không đổi schema, không triển khai frontend hoặc thay đổi luồng quản lý hợp đồng phía trường.

## Technical Context

**Language/Version**: Node.js 24.22.1 theo .nvmrc, TypeScript 6.0.3 strict; CommonJS, Node16 module resolution.

**Primary Dependencies**: Express 4, Prisma/@prisma/adapter-pg 7.10.1, PostgreSQL qua pg, Zod 4.6.7, Redis/session và middleware xác thực có sẵn; không thêm dependency.

**Storage**: Các model hiện có School, SchoolSupplierRelationship, SupplierContract, SupplierContractItem, Ingredient và SupplierContractDocument trong schema foodprint; nội dung tệp ở ByteA. Chỉ đọc; không migration hoặc seed.

**Testing**: Node test runner với tsx; unit/HTTP injectable, real PostgreSQL trong authorization và supplier-onboarding integration hiện có.

**Target Platform**: Backend Linux/Node hiện tại, PostgreSQL theo môi trường dự án; CI PostgreSQL18. Không thay kết nối PostgreSQL/Redis.

**Project Type**: Web service trong một backend hiện có.

**Performance Goals**: Dữ liệu cấp trang bị chặn bởi limit+1, tối đa 101 trường/hợp đồng; không lấy toàn bộ lịch sử vào bộ nhớ để distinct/sort/page, không tải bytes trong metadata. Không đặt thêm SLA độ trễ chưa có trong spec. SC-006 là chỉ tiêu thao tác người dùng khi có luồng hoàn chỉnh.

**Constraints**: Chỉ admin + ít nhất một quyền liên kết hiệu lực, không SYSTEM bypass; mọi WHERE có scope, một trường một mục; thông báo lỗi tiếng Việt; Date timestamp ISO UTC, ngày hợp đồng YYYY-MM-DD; null giữ nguyên; JSON allowlist và binary exception riêng; không cache quyền hoặc kết quả.

**Scale/Scope**: Ba user stories,16 FR, 6 SC, năm GET và một default grant existing permission; kích thước trang 1–100, mặc định 20; tệp theo dữ liệu PDF/PNG/JPEG đã được luồng upload hiện tại chấp nhận (tối đa10MB/tệp).

## Constitution Check

Gate trước Phase 0: PASS. Đánh giá lại sau Phase 1: PASS với thiết kế bên dưới.

| Nguyên tắc                       | Bằng chứng thiết kế                                                                                                             | Trước nghiên cứu | Sau thiết kế |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------ |
| I. Phân lớp                      | Module bảy file; validation là nguồn Request DTO; controller không import DTO; service không query, repository không import DTO | PASS             | PASS         |
| II. Phân quyền                   | Helper scope admin-only ở resource-access, quyền view/manage OR, principal hiện tại, scope ở mọi truy vấn; giữ API cũ           | PASS             | PASS         |
| III. An toàn DB                  | Tái sử dụng model/index/tệp; không DDL, migration, seed hoặc kết nối DB khi lập plan                                            | PASS             | PASS         |
| IV. Transaction/cache/rate limit | withReadTransaction, cùng tx cho parent/data, không khóa ghi/cache; limiter/session hiện hành                                   | PASS             | PASS         |
| V. Hợp đồng dữ liệu              | DTO allowlist và serialize tường minh; JSON envelope; binary có headers riêng; không lộ bytes trong metadata                    | PASS             | PASS         |
| VI. Spec-driven                  | Nhánh/spec tương ứng, mọi quyết định có FR; tạo tasks ở bước kế tiếp trước code; SC-006 ghi riêng                               | PASS             | PASS         |

Không có ngoại lệ cần chấp thuận. Default grant trong catalog áp dụng role mới; không sửa bootstrap để thay quyền role hiện hữu.

## Project Structure

### Documentation (this feature)

```text
specs/supplier-linked-schools/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/supplier-schools-api.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md                        # Đã tạo bằng speckit-tasks, chưa triển khai
```

### Source Code (repository root)

```text
src/modules/supplier-school/
├── supplier-school.routes.ts
├── supplier-school.controller.ts
├── supplier-school.validation.ts
├── supplier-school.request.dto.ts
├── supplier-school.response.dto.ts
├── supplier-school.service.ts
└── supplier-school.repository.ts
src/utils/resource-access.ts
src/constants/permission-catalog.ts
src/routes/index.ts
src/modules/README.md
docs/AUTHORIZATION.md
package.json
tests/supplier-school.test.ts
tests/authorization.test.ts
tests/authorization.integration.test.ts
tests/supplier-onboarding.integration.test.ts
```

**Structure Decision**: Module phía nhà cung cấp riêng để giữ nguyên school-supplier/supplier-onboarding và quyền các vai trò đang dùng. Tests được gắn vào các lệnh CI hiện có; không đổi workflow hoặc runner.

## Phase 0 — Research

Hoàn thành tại [research.md](research.md). Các kết luận quan trọng: truy vấn đại diện trước phân trang; scope mới không kế thừa quyền rộng của school-supplier; đọc hợp đồng theo cặp và mọi đợt lịch sử; bytes chỉ chọn khi mở tệp; cần default view grant cho role mới và bước operator riêng cho role hiện hữu.

## Phase 1 — Design

### Authorization và tích hợp

- Thêm resource `supplier-school` trong RESOURCE_PERMISSIONS và listScopes, helper `supplierSchoolReadScope` trả `{ supplierId }` sau kiểm tra role/org/membership và `assertPermission` OR hai quyền hiện có.
- Router factory nhận authHandler/service injectable, kiểm tra authenticate và scope trước validation. Mỗi service operation kiểm tra lại scope từ AuthPrincipal, kể cả khi gọi trực tiếp.
- Thêm default `supplier_relationship.view` cho INGREDIENT_SUPPLIER_ADMIN trong catalog. Không thêm grant cho staff, không đổi quyền manage, không thay bootstrap hoặc tự khởi tạo dữ liệu.
- Mount router và cập nhật README module/ma trận docs ở giai đoạn implement. Mọi request đọc dùng quyền hiện tại do auth middleware tải; không tái sử dụng dữ liệu quyền từ lần xem trước.

### Truy vấn và trách nhiệm phân lớp

| Tầng         | Trách nhiệm                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation   | z.strictObject; UUID chuẩn hóa; page1/limit 20/max100/offset tối đa2147483647; query lạ bị400; nội dung tệp chỉ disposition inline hoặc attachment, mặc định inline              |
| Request DTO  | z.infer với type-only schema imports; chỉ service tiêu thụ                                                                                                                       |
| Controller   | Validate params/query, gọi service, sendSuccess cho JSON; lấy đủ nội dung trước khi đặt headers và gửi binary; asyncHandler xử lý lỗi                                            |
| Service      | Xác lập scope; withReadTransaction cho từng operation; parent không tìm thấy404; phân trang limit+1; mapping allowlist, null/date; kiểm tra dữ liệu tệp trước khi trả binary DTO |
| Repository   | Toàn bộ SQL/Prisma, select/where/order/skip/take, cùng tx, scope bắt buộc; kết quả persistence riêng, không Request/Response DTO                                                 |
| Response DTO | Hợp đồng JSON và DTO nội dung riêng; không nhập bởi controller/repository; service map từng trường, không spread record                                                          |

Danh sách trường: CTE DISTINCT ON school_id lọc supplier_id; chọn ACTIVE/SUSPENDED trước UNLINKED, linked_at DESC/id ASC. Sau khi chọn đại diện mới join trường, sort linked_at DESC/school_id ASC, OFFSET/LIMIT limit+1. Projection tường minh chỉ trường của FR-006. Chi tiết dùng cùng logic với schoolId đã validate và projection FR-007.

Hợp đồng: repository kiểm tra tồn tại trường có một quan hệ bất kỳ của đúng cặp rồi tìm hợp đồng ACTIVE/CLOSED, createdAt DESC/id ASC; không lọc relationshipId theo đại diện và không lọc trạng thái/ngày. Repository trả metadata tệp SIGNED_CONTRACT/APPENDIX cùng ingredients id/name, không content/sha256/snapshot/user/certification. Query contract và document luôn áp cả schoolId+supplierId; document thêm contractId/documentId/kind. Không lấy toàn bộ các hợp đồng ngoài page.

Parent check và đọc dữ liệu cùng tx RepeatableRead, không dùng advisory/row lock. Không bọc parent404 trong readListPage có catch-all; tạo pagination từ kết quả đã giới hạn trong service, để HttpError404 giữ nguyên qua withReadTransaction.

### Giao diện và lỗi

Năm endpoint và schema chính thức nằm ở [contracts/supplier-schools-api.md](contracts/supplier-schools-api.md). Chi tiết trường và danh sách hợp đồng là hai lần đọc độc lập; trường chưa có hợp đồng vẫn200, contracts.items rỗng. Mỗi lần mở contract/tệp tự kiểm tra scope, không dựa vào việc client đã gọi parent trước đó.

401 cho phiên không hợp lệ;403 cho tài khoản/vai trò/quyền sai theo auth hiện hành;400 cho input không hợp lệ;404 chung cho đối tượng không tồn tại/ngoài phạm vi/bản nháp/tệp COMPLIANCE;503 sanitize cho lỗi hạ tầng hoặc nội dung tệp không đọc được. Tệp thành công là bytes, các lỗi vẫn JSON envelope.

Binary trả tên UTF-8 an toàn, MIME hợp lệ đã lưu, disposition, Content-Length theo bytes, nosniff, CSP sandbox, private/no-store. JSON endpoints cũng đặt private/no-store để tránh tái dùng dữ liệu trên client sau thay đổi quyền. Không ghi header chứa tên tệp chưa mã hóa hoặc trả URL công khai.

### Mô hình dữ liệu và vòng đời

[data-model.md](data-model.md) ghi fields, kiểu/null, quan hệ và projections. Không thêm model/column/index/constraint. Tính năng không có state transition; ACTIVE/SUSPENDED/UNLINKED và DRAFT/ACTIVE/CLOSED là trạng thái được đọc, không thay đổi.

### Kiểm thử và rollout

- Unit/HTTP mới: validation, scope, DTO, headers, lỗi, snapshot orchestration, rỗng, không gọi write và phân trang. Đăng ký tests/supplier-school.test.ts trong test:unit.
- PostgreSQL/HTTP trong supplier-onboarding integration: kiểm chứng SQL chọn đại diện, tie/order/trang, trường dùng chung và lịch sử, hợp đồng cũ/legacy, tệp gốc/appendix/COMPLIANCE/nháp, bảo toàn API phía trường.
- Authorization tests: default grant mới, bootstrap fresh/preserve existing, role và membership hiện tại, OR permissions/denials/inactive grants, không SYSTEM/staff bypass; bổ sung supplier-school vào nhóm resource admin-only của test duyệt Object.entries(listScopes) hiện có, không nới assertion chung cho các resource khác. Real-login requests sau đổi quyền/khóa/chuyển tổ chức nằm trong authorization.integration.
- Kiểm chứng triển khai: npm run validate, npm run test:unit và npm run test:local:authorization trên instance disposable đã được chọn và được phép. Không chạy các lệnh DB chỉ vì đang lập kế hoạch.
- Rollout role hiện hữu: operator cấp existing view permission bằng quy trình quản lý role đã duyệt, giữ grants và denial/inactive flags hiện tại. Không coi chạy lại bootstrap là bước cấp quyền. Xem điều kiện API replace role trong quickstart.
- SC-006 để chưa nghiệm thu cho đến khi có luồng người dùng hoàn chỉnh; không mở rộng backend plan thành dự án frontend.

## Requirement Traceability

| Yêu cầu    | Thiết kế                                                   | Kiểm chứng chính                                |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------- |
| FR-001–002 | Scope helper, auth mỗi request, catalog default/read grant | Unit + real authorization                       |
| FR-003–004 | DISTINCT ON trước page, đại diện theo trạng thái/time/id   | PostgreSQL fixture nhiều đợt và tie             |
| FR-005–006 | Pagination strict và school list allowlist                 | Validation/HTTP + PostgreSQL pages              |
| FR-007     | School detail projection, read-only                        | DTO/null/scope và INACTIVE                      |
| FR-008–010 | Pair contract scope, ACTIVE/CLOSED, lịch sử, page độc lập  | Onboarding integration future/expired/legacy    |
| FR-011–012 | Nested document predicate và metadata/bytes tách riêng     | Tệp gốc/APPENDIX/cross-pair/DRAFT/COMPLIANCE    |
| FR-013–014 | Error envelope, safe projection, no-store                  | HTTP status/body/headers + no-field-leak        |
| FR-015–016 | Chỉ GET, snapshot đọc, rỗng và lỗi tệp riêng               | No-write/unit + API trường regression           |
| SC-001–005 | Các kiểm chứng trên                                        | Unit + PostgreSQL thực, có bộ dữ liệu đối chiếu |
| SC-006     | Thử luồng tìm trường→mở tệp dưới 1 phút                    | Nghiệm thu sản phẩm sau khi có giao diện        |

## Complexity Tracking

Không có vi phạm Constitution Check. SQL tham số hóa trong repository là cần thiết để biểu diễn hai thứ tự riêng: chọn đại diện và phân trang trường; không thêm tầng dữ liệu, dependency hay cấu trúc lưu trữ.

## Kết quả giai đoạn lập kế hoạch

Phase 0 và Phase 1 hoàn tất; hook before_plan/after_plan không được cấu hình. Đã tạo [tasks.md](tasks.md) bằng `$speckit-tasks`: 40 task, gồm ba story và kiểm chứng liên quan; chưa sửa source hoặc thực thi DB. Bộ tài liệu sẵn sàng cho `$speckit-analyze` trước implement.
