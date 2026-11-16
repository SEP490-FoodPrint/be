# Implementation Plan: Đổi trạng thái ẩn/hiện nguyên liệu nhà cung cấp

**Branch**: `feat/ingredient-change-status` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/ingredient-change-status/spec.md`

## Summary

Thay `POST /api/ingredients/management/:ingredientId/hide` bằng một `PATCH /api/ingredients/management/:ingredientId/status` nhận trạng thái đích ACTIVE hoặc INACTIVE. Tái sử dụng phân quyền, scope supplier, transaction Serializable, khóa supplier/target và ánh xạ IngredientResponse hiện có. Service xử lý no-op sau khi kiểm tra quyền và khóa; repository chỉ ghi status khi cần. Giữ nguyên schema và dữ liệu lịch sử.

Kế hoạch kết thúc ở thiết kế. Triển khai tiếp theo phải có tasks.md từ `$speckit-tasks`; bước này chỉ tạo tài liệu.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict; Node.js 24.22.1 theo .nvmrc; CommonJS, Node16 module resolution.

**Primary Dependencies**: Các dependency hiện có: Express 4.21.x, Zod 4.6.7, Prisma Client/CLI 7.10.1, adapter-pg; không cần thêm package.

**Storage**: PostgreSQL, model Ingredient trong schema foodprint. Dùng EntityStatus và updatedAt hiện có; không thay schema, migration hay seed. Redis tiếp tục phục vụ middleware runtime; không thêm cache cho chức năng này.

**Testing**: Node test runner qua tsx; mở rộng tests/ingredient-management.test.ts và tests/authorization.integration.test.ts. Cập nhật caller route cũ trong tests/supplier-onboarding.integration.test.ts. Dùng wrapper local được quản lý cho kiểm thử ghi PostgreSQL.

**Target Platform**: Backend Node.js hiện tại, phát triển trên Linux, triển khai theo quy trình hiện có.

**Project Type**: Web service REST trong repository backend đơn.

**Performance Goals**: Một nguyên liệu mỗi yêu cầu; không quét danh sách hoặc tải liên kết lịch sử để đổi trạng thái. Dùng khóa theo supplier/target và truy vấn định danh có scope. Không đặt SLO độ trễ mới; helper transaction hiện có giới hạn chờ 10 giây, mỗi transaction 20 giây và tối đa ba lần thử cho xung đột được nhận diện.

**Constraints**: Chỉ Supplier Admin hợp lệ với ingredient.manage, scope từ principal, recheck trong cùng transaction; no-op không UPDATE; trường khác và liên kết lịch sử giữ nguyên; loại bỏ route hide. Không thay global auth, cache, limiter, quyền đọc hoặc điều kiện đối tác.

**Scale/Scope**: Một endpoint thay thế trong module ingredient, không thêm màn hình hoặc thao tác hàng loạt; thay đổi sáu file logic/Request DTO hiện có, giữ Response DTO, cập nhật ba file tests và hai tài liệu sử dụng.

## Constitution Check

GATE trước Phase 0 và kiểm tra lại sau Phase 1:

| Nguyên tắc                       | Trước nghiên cứu                                  | Sau thiết kế                                                                                                                            |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| I. Phân lớp và DTO               | PASS — mở rộng module ingredient hiện có          | PASS — controller validate, service quyết định trạng thái/map DTO, repository giữ mọi query; Request DTO suy từ Zod, Response DTO riêng |
| II. Phân quyền/cô lập            | PASS — kế thừa scope quản trị hiện có             | PASS — recheck actor/quyền/membership/supplier, target WHERE theo supplier; staff/System Admin bị chặn                                  |
| III. An toàn DB                  | PASS — dùng hai trạng thái hiện có                | PASS — không schema/migration/seed; integration chỉ DB local tạm được ủy quyền, không chạy ở bước plan                                  |
| IV. Transaction/cache/rate limit | PASS — tái sử dụng write/authorizationTransaction | PASS — cùng tx cho recheck/lock/read/write, no-op không ghi; không cache mới, giữ limiter                                               |
| V. HTTP và đầu ra                | PASS — giữ response helpers                       | PASS — trả IngredientResponse allowlist và ISO timestamps; 400/401/403/404/503 theo helper hiện có                                      |
| VI. Spec-driven                  | PASS — có spec trên nhánh tính năng từ dev        | PASS — mọi thay đổi thiết kế truy về FR; tasks.md sẽ tạo ở bước tasks trước implementation                                              |

Không có vi phạm cần ngoại lệ. Không còn điểm chưa rõ ngăn thiết kế.

## Project Structure

### Documentation (this feature)

```text
specs/ingredient-change-status/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/requirements.md
├── contracts/ingredient-status-api.md
└── tasks.md                         # tạo bởi $speckit-tasks sau bước plan
```

### Source Code (repository root)

```text
src/modules/ingredient/
├── ingredient.routes.ts
├── ingredient.controller.ts
├── ingredient.validation.ts
├── ingredient.request.dto.ts
├── ingredient.response.dto.ts       # tái sử dụng, không cần đổi shape
├── ingredient.service.ts
└── ingredient.repository.ts
src/utils/
├── authorization.ts                # tái sử dụng
├── resource-access.ts              # tái sử dụng
├── request-validation.ts           # tái sử dụng
└── response.ts                     # tái sử dụng
tests/
├── ingredient-management.test.ts
├── authorization.integration.test.ts
└── supplier-onboarding.integration.test.ts
docs/AUTHORIZATION.md
src/modules/README.md
```

**Structure Decision**: Thay hành vi hide trong chính module ingredient; không thêm module, mapper, client DB hoặc transaction infrastructure. Prisma schema và các migration hiện có là đầu vào tham khảo, không phải file cần sửa.

## Phase 0 — Research

[research.md](research.md) chốt bảy nhóm quyết định: endpoint và trạng thái đích; tái sử dụng model; quyền/transaction; no-op/concurrency; lựa chọn và lịch sử; chuyển hợp đồng; kiểm chứng. Nghiên cứu hoàn tất bằng đọc mã nguồn và một nhánh nghiên cứu read-only về transaction/tests.

## Phase 1 — Design

### 1. Route, validation và DTO

- Xóa đăng ký `POST /:ingredientId/hide`; thêm `PATCH /:ingredientId/status` trong management router sau middleware hiện có. Không alias hoặc redirect.
- Đổi `ingredientHideSchema` thành `ingredientChangeStatusSchema`: z.strictObject với đúng một trường status bắt buộc, enum ACTIVE/INACTIVE, không default, không ép kiểu hoặc chuẩn hóa chữ. Dùng parseRequest/safeParse để gom lỗi tiếng Việt kèm paths.
- Giữ ingredientParamsSchema cho UUID. Thay validateIngredientHide bằng validateIngredientChangeStatus; body thiếu không được biến thành yêu cầu hợp lệ.
- Request DTO `IngredientChangeStatusRequest` suy từ schema bằng z.infer và type-only import. Chỉ service tiêu thụ DTO; controller không import DTO.
- Controller changeStatus validate params/body, lấy principal, gọi service và sendSuccess với message “Đổi trạng thái nguyên liệu thành công”, HTTP 200. Lỗi đi qua asyncHandler/globalErrorHandler.

### 2. Service và repository

Luồng xử lý:

1. Service nhận IngredientParamsRequest, IngredientChangeStatusRequest và AuthPrincipal tin cậy.
2. Gọi write hiện có: xác lập scope ban đầu; authorizationTransaction nạp actor hiện tại, kiểm tra role/quyền/membership, so scope, khóa supplier và xác minh supplier ACTIVE.
3. Trong cùng tx, repository khóa target có id và supplierId, đọc target theo scope. Không tồn tại hoặc ngoài sở hữu: 404.
4. Nếu target.status trùng input.status, trả dto(target), không gọi repository mutation.
5. Nếu khác, gọi `repo.changeStatus(scope, id, status, tx)`. Repository nhận trạng thái bằng type nội bộ literal union hoặc persistence type hiện có, không import Request/Response DTO.
6. Repository updateMany với WHERE id + supplierId + status khác đích, data chỉ status; Prisma tự cập nhật updatedAt. Đọc lại bằng find trong cùng tx; service map allowlist bằng dto hiện có.
7. Chỉ trả thành công khi transaction commit; lỗi an toàn theo helper hiện có. Không thao tác lên danh mục, ảnh, hồ sơ hay giao dịch khác.

Khóa và Serializable hiện có quyết định thứ tự ghi. Không suy ra thứ tự commit từ thời điểm HTTP response. Retry chạy lại cả recheck và so trạng thái; hết retry trả 503, client có thể đọc lại và gửi trạng thái đích. Cạnh tranh chỉnh sửa thông tin không được ghi đè status vì DTO sửa thông tin không chấp nhận status.

### 3. Đọc và bảo toàn dữ liệu

Quản trị tiếp tục thấy cả ACTIVE/INACTIVE. Giữ các bộ lọc ACTIVE ở lựa chọn nguyên liệu và điều kiện supplier/đối tác/entry hiện có. Đặc biệt GET ingredients cho supplier hiện cho phép cả hai trạng thái, không thêm bộ lọc toàn cục. Mở lại không tự kích hoạt entry, supplier, quan hệ hoặc hồ sơ.

Thiết kế dữ liệu và bảng chuyển trạng thái: [data-model.md](data-model.md). Hợp đồng HTTP đầy đủ: [ingredient-status-api.md](contracts/ingredient-status-api.md).

### 4. Chuyển hợp đồng và tài liệu

- Cập nhật docs/AUTHORIZATION.md và src/modules/README.md: route status, input enum, mở lại, no-op, quyền, 404 target; thay mô tả “không cung cấp bật lại”.
- Giữ tài liệu spec 008 như lịch sử; tài liệu hiện hành dẫn contract mới và nêu contract mới thay phần hide của contract cũ.
- Chuyển các caller trong ba file tests sang PATCH status. Client ngoài repo phải đổi POST hide thành PATCH status trong cùng đợt phát hành; dự kiến body INACTIVE cho ẩn, ACTIVE cho hiện.
- Xác minh endpoint hide cũ trả 404 qua notFoundHandler của app với tài khoản hợp lệ và không mutation. Kiểm tra auth middleware có thể từ chối sớm 401/403; không cam kết 404 cho mọi danh tính.

### 5. Validation design

| Yêu cầu            | Kiểm chứng dự kiến                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001–003, FR-010 | HTTP/unit: cùng route cho hai chiều, body bắt buộc, GET đọc lại và shape DTO; integration: mở legacy INACTIVE                                        |
| FR-004             | Unit xác nhận không gọi mutation khi cùng đích; PostgreSQL xác nhận updatedAt không đổi ở cả hai trạng thái                                          |
| FR-005–007         | Cả hai chiều: staff/System Admin/thiếu quyền, supplier không ACTIVE, ngoài scope; actor mất quyền/đổi membership sau principal cũ; no-op vẫn recheck |
| FR-008             | Thiếu/null/sai enum/sai kiểu/thuộc tính thừa/UUID sai: 400, paths tiếng Việt, không lộ dữ liệu đầu vào, không ghi                                    |
| FR-009, FR-011     | Ít nhất ba chu kỳ, so nội dung và liên kết; lựa chọn SCHOOL/main/seasoning biến mất rồi xuất hiện lại khi đủ các điều kiện khác                      |
| FR-012             | PATCH thông tin từ chối status, sửa INACTIVE không mở lại; race status/edit giữ cả hai thay đổi                                                      |
| FR-013             | Rà soát docs hiện hành, tất cả caller runtime/tests; không còn route hide; tài liệu lịch sử được phân biệt                                           |

Mở rộng fixture hiện có để track mutation calls/tx và timestamp; không coi mock timestamp là bằng chứng cho PostgreSQL. Integration kiểm tra cùng đích đồng thời và hai đích cạnh tranh, đọc lại sau commit, rollback khi ghi lỗi. Các scenario selection cần chạy được qua tests/authorization.integration.test.ts với wrapper quản lý DB.

tests/supplier-onboarding.integration.test.ts hiện tự tạo DB, không ghi manifest cleanup của wrapper; chỉ cập nhật caller trong phạm vi này. Không đưa lệnh chạy suite legacy đó vào luồng local mặc định. Các regression lựa chọn cần thiết được bổ sung vào authorization integration; nếu chạy suite legacy riêng phải có instance tạm và quản lý dọn DB được chấp thuận.

Hướng dẫn chạy và kỳ vọng nằm ở [quickstart.md](quickstart.md). Sau implementation chạy validate và test:unit; integration cần instance và ủy quyền ghi DB tạm. Không chạy test hoặc DB mutation trong bước plan.

## Constitution Check — Post-design

Tất cả nguyên tắc I–VI PASS như bảng trên. Không thêm cấu trúc dữ liệu hay phụ thuộc, không mở rộng quyền, giữ transaction dùng chung, response an toàn và scope tổ chức. Bộ thiết kế đủ để tạo tasks.md; backend code chưa thay đổi.
