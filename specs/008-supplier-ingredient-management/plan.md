# Implementation Plan: Quản lý nguyên liệu của nhà cung cấp

**Branch**: `feat/008-supplier-ingredient-management` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: `specs/008-supplier-ingredient-management/spec.md`

## Summary

Hoàn thiện module ingredient để Ingredient Supplier Admin có quyền hiệu lực ingredient.manage xem, thêm, sửa và ẩn nguyên liệu của chính nhà cung cấp. Staff bị chặn kể cả được gán quyền. Bổ sung ảnh và quan hệ danh mục dùng chung; chuyển đổi phân loại cũ mà không mất lịch sử.

Tách nhóm quản trị tại /api/ingredients/management khỏi GET /api/ingredients hiện có. Dùng repository, strict Zod validation, hai DTO riêng và transaction chung. Các consumer cũ vẫn trả category dạng chuỗi suy ra từ quan hệ; chỉ hợp đồng quản trị mới trả categoryId và đối tượng category.

## Technical Context

**Language/Version**: TypeScript 6.0.3 strict, Node.js 24.22.1 theo .nvmrc, CommonJS/Node16.

**Primary Dependencies**: Express 4.21, Prisma 7.10.1 với adapter PostgreSQL/client cjs, Zod 4.6.7; không thêm dependency.

**Storage**: PostgreSQL schema foodprint; một migration mới, TEXT ảnh bìa và TEXT[] ảnh mô tả. Redis giữ rate limiter, không thêm cache.

**Testing**: Node test runner qua tsx; unit/HTTP repository giả lập; integration migration/authorization/concurrency trên disposable PostgreSQL local được chọn tường minh.

**Target Platform**: Backend Linux hiện có; không frontend hoặc dịch vụ tải ảnh mới.

**Project Type**: REST web service theo module.

**Performance Goals**: Giữ phân trang mặc định 20, tối đa 100, lấy thêm một dòng để xác định hasNext; join danh mục, tránh N+1. Không đặt SLA mới ngoài spec.

**Constraints**: Phạm vi supplier từ principal tin cậy; kiểm tra lại actor trong transaction; giữ unique tên theo supplier, envelope, quyền đọc cũ; không seed/reset/deploy khi lập kế hoạch. Giữ giới hạn JSON hiện có 100 KiB; ảnh là tham chiếu tối đa 2048 ký tự, không thêm hạn mức số ảnh nghiệp vụ.

**Scale/Scope**: Một module ingredient, sáu endpoint quản trị, một bảng danh mục đúng ba cột; cập nhật tối thiểu menu, supplier-onboarding và fixture liên quan.

## Constitution Check

| Nguyên tắc                    | Trước Phase 0 | Sau Phase 1 | Cách đáp ứng                                                                                                                               |
| ----------------------------- | ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Phân lớp                   | PASS          | PASS        | Controller không import DTO; validation strict Zod; Request DTO infer; service quyết định nghiệp vụ/map output; repository giữ query/lock. |
| II. Phân quyền                | PASS          | PASS        | Admin + permission + supplier ACTIVE, scope qua resource-access; recheck actor cùng transaction; không bypass.                             |
| III. An toàn DB               | PASS          | PASS        | Migration mới bất biến sau deploy; backfill dữ liệu thật; không thao tác DB ở bước plan; test DB tạm local.                                |
| IV. Transaction/cache/limiter | PASS          | PASS        | authorizationTransaction, mọi repository call cùng tx; không cache mới, không đổi limiter.                                                 |
| V. HTTP/output                | PASS          | PASS        | Giữ envelope, ISO timestamps, projection allowlist và category legacy dạng chuỗi.                                                          |
| VI. Spec-driven               | PASS          | PASS        | Nhánh đồng bộ số 008; tasks.md được tạo bằng speckit-tasks trước triển khai.                                                               |

Không có vi phạm cần miễn trừ. PR chỉ đủ điều kiện spec gate sau khi có tasks.md; không tuyên bố plan riêng đã đủ điều kiện merge. Không có extensions.yml khi chạy nên bỏ qua before_plan/after_plan hooks.

## Project Structure

### Documentation (this feature)

```text
specs/008-supplier-ingredient-management/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/ingredient-management.md
├── checklists/requirements.md
└── tasks.md  # sinh sau bằng speckit-tasks
```

### Source Code (repository root)

```text
prisma/schema.prisma
prisma/migrations/<timestamp>_supplier_ingredient_management/migration.sql
src/modules/ingredient/
  ingredient.routes.ts
  ingredient.controller.ts
  ingredient.validation.ts
  ingredient.service.ts
  ingredient.repository.ts       # mới
  ingredient.request.dto.ts      # mới
  ingredient.response.dto.ts     # mới
src/utils/resource-access.ts
src/modules/menu/menu.service.ts
src/modules/supplier-onboarding/supplier-onboarding.service.ts
docs/AUTHORIZATION.md
src/modules/README.md
database/SCHEMA_BASELINE.md
tests/ingredient-management.test.ts  # mới, đăng ký test:unit
tests/modules.test.ts
tests/migrations.test.ts
tests/authorization.integration.test.ts
tests/supplier-onboarding.integration.test.ts
package.json
```

**Structure Decision**: Giữ module ingredient; danh mục chỉ đọc thuộc module này, không xây module quản trị System Admin. Thay đổi consumer legacy chỉ gồm query quan hệ và mapping tương thích, không tái cấu trúc toàn bộ menu/supplier-onboarding.

## Phase 0 — Research

Đã giải quyết các quyết định về quyền, transaction, ảnh, backfill và tương thích trong [research.md](research.md), dựa trên mã nguồn và hợp đồng repository.

## Phase 1 — Design

Thiết kế gồm [data-model.md](data-model.md), [contract](contracts/ingredient-management.md) và [quickstart.md](quickstart.md).

Trình tự triển khai cho bước tasks:

1. Tạo migration mới, cập nhật Prisma; kiểm thử nâng cấp từ schema ngay trước migration với dữ liệu category cũ trước khi drop cột.
2. Hoàn thiện validation/repository/DTO/service. Service dùng authorizationTransaction; repository nhận cùng tx cho mọi đọc/ghi và query khóa; nạp actor bằng loadPrincipal(id, tx), kiểm tra lại role/quyền/membership và supplier ACTIVE.
3. Thêm helper scope quản trị tại resource-access; controller/routes nối sáu endpoint, giữ API đọc cũ và injection seam hoặc cập nhật test fixture đúng contract.
4. Sửa consumer category và fixture; giữ output/filter cũ, lọc ACTIVE cho lựa chọn mới, không lọc mất lịch sử.
5. Bổ sung unit/HTTP, migration và authorization/concurrency tests; cập nhật endpoint matrix và schema deployment status; chạy quality checks.

Lỗi P2002/P2003 phải được chuyển thành HttpError trong callback/repository adapter trước khi wrapper databaseOperation chuyển lỗi lạ thành 503. Service không dựng Prisma where/select/include.

Rủi ro: consumer legacy trả nguyên record phải chuyển select/map để không vô tình lộ trường mới. Migration bỏ cột không tương thích ứng dụng cũ: triển khai có cửa sổ bảo trì, không rolling hai phiên bản schema; chỉ deploy theo nhiệm vụ được phép/CD đã duyệt.

## Complexity Tracking

Không có ngoại lệ constitution. Không thêm cache, upload, permission catalog mới, xóa nguyên liệu hoặc khôi phục hiển thị.
