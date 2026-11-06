# Implementation Plan: Cấu hình chế độ nấu của trường

**Branch**: `feat/003-school-cooking-mode` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-school-cooking-mode/spec.md`

## Summary

Bổ sung API đọc/cập nhật `School.cookingMode` cho trường trong phiên. Routes kiểm tra permission, controller validate body bằng Zod, service kiểm tra role/phạm vi và điều phối transaction, repository thực hiện truy vấn Prisma. Tính năng dùng schema hiện có, không tạo migration và giữ nguyên dữ liệu kế hoạch nấu lịch sử.

## Technical Context

**Language/Version**: Node.js 24.22.1, TypeScript strict, CommonJS

**Primary Dependencies**: Express, Zod, Prisma 7.10.1, PostgreSQL

**Storage**: PostgreSQL qua model `School` hiện có; không thay đổi schema

**Testing**: Node test runner qua `tsx --test`, integration authorization trên PostgreSQL disposable của CI

**Target Platform**: Backend Linux container/Node.js; phát triển cục bộ trên Node.js tương thích `.nvmrc`

**Project Type**: REST API service

**Performance Goals**: Mỗi lần đọc dùng một truy vấn trường; mỗi lần ghi dùng transaction authorization hiện có và một cập nhật trường

**Constraints**: Không nhận `schoolId` từ client; chỉ Ban Giám hiệu có quyền; giữ response envelope; không migration/seed/DDL

**Scale/Scope**: Hai endpoint, một permission catalog entry, một module organization và test liên quan

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after design._

| Nguyên tắc                           | Trạng thái | Bằng chứng thiết kế                                                                                                |
| ------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| I. Kiến trúc module phân lớp         | PASS       | Controller chỉ điều phối; Zod là nguồn Request DTO; service dùng Request/Response DTO; repository chứa Prisma.     |
| II. Phân quyền và cô lập tổ chức     | PASS       | Permission + role BGH được kiểm tra; `schoolId` chỉ lấy từ principal; transaction nạp lại actor và scope.          |
| III. An toàn cơ sở dữ liệu           | PASS       | Tái sử dụng trường/enum hiện có; không introspection, DDL, migration, seed hay ghi DB môi trường dùng chung.       |
| IV. Transaction, cache và rate limit | PASS       | PATCH dùng `withSchoolTransaction`; repository nhận cùng transaction client; không thêm cache/rate-limit behavior. |
| V. Hợp đồng HTTP và dữ liệu đầu ra   | PASS       | Giữ envelope, trả Response DTO allowlist chỉ có `cookingMode`.                                                     |
| VI. Phát triển theo spec             | PASS       | Nhánh/spec cùng số 003; spec/plan/tasks nằm cùng PR và không có điểm chưa làm rõ.                                  |

Không có vi phạm cần ghi Complexity Tracking.

## Design

### API contract

- `GET /api/schools/me/cooking-mode`
  - Authenticated, permission `school_cooking_mode.manage`.
  - Service giới hạn role `SCHOOL_MANAGEMENT_BOARD`, org `SCHOOL`, `schoolId` khác null.
  - Success data: `{ "cookingMode": "SEPARATE_BY_LOT" | "COMBINE_LOTS" | null }`.
- `PATCH /api/schools/me/cooking-mode`
  - Cùng điều kiện authorization.
  - Strict body: `{ "cookingMode": "SEPARATE_BY_LOT" | "COMBINE_LOTS" }`.
  - Transaction nạp lại actor/quyền, khóa trường ACTIVE và cập nhật đúng trường trong phiên.

### Layer responsibilities

- `organization.validation.ts`: `z.strictObject`, enum validation, lỗi HTTP 400 có field path.
- `organization.request.dto.ts`: suy ra `CookingModeRequestDTO` từ schema.
- `organization.controller.ts`: nhận body đã chuẩn hóa và gọi service.
- `organization.service.ts`: kiểm tra role/permission, điều phối transaction và trả `CookingModeResponseDTO`.
- `organization.repository.ts`: đọc/cập nhật `School.cookingMode` bằng Prisma; write nhận transaction client.
- `organization.response.dto.ts`: hợp đồng allowlist `{ cookingMode }`.

### Permission rollout

Thêm `school_cooking_mode.manage` vào catalog và role Ban Giám hiệu. PR không tự ghi database. Sau merge, operator chạy `npm run auth:bootstrap -- --azure` chỉ khi được phê duyệt cho môi trường tương ứng.

## Project Structure

### Documentation (this feature)

```text
specs/003-school-cooking-mode/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
src/constants/permission-catalog.ts
src/modules/organization/
├── organization.controller.ts
├── organization.repository.ts
├── organization.request.dto.ts
├── organization.response.dto.ts
├── organization.routes.ts
├── organization.service.ts
└── organization.validation.ts

tests/
├── authorization.integration.test.ts
├── cooking-mode.test.ts
└── organization.test.ts
```

**Structure Decision**: Mở rộng module `organization` hiện có vì cấu hình thuộc School và endpoint dùng `/schools/me`; không tạo module hoặc database client mới.

## Verification Plan

1. Format riêng các file thay đổi bằng Prettier.
2. Chạy `npm run prisma:validate` và `npm run prisma:generate`.
3. Chạy `npm run validate` và `npm run test:unit`.
4. Chạy targeted `tests/cooking-mode.test.ts` và `tests/organization.test.ts`.
5. Chạy Spec gate với base/head/ref giống CI.
6. Dùng GitHub CI để xác nhận PostgreSQL migrations, registration concurrency, authorization tenant isolation, Redis session và supplier onboarding.

## Complexity Tracking

Không có ngoại lệ hoặc vi phạm hiến chương.
