# Implementation Plan: Phân công giáo viên chủ nhiệm

**Branch**: `feat/002-class-homeroom-assignment` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-class-homeroom-assignment/spec.md`

## Summary

Tích hợp API phân công GVCN đã được phát triển trên feature branch vào baseline `dev`: bổ sung lịch sử phân công trong Prisma, permission `class_assignment.manage`, bốn endpoint lớp và test school isolation. Không thay đổi chức năng tạo tài khoản hoặc các module actor khác.

## Technical Context

**Language/Version**: TypeScript 6, Node.js 24

**Primary Dependencies**: Express 4, Prisma 7, Zod 4

**Storage**: PostgreSQL qua Prisma

**Testing**: Node test runner qua `tsx --test`

**Target Platform**: FoodPrint backend service

**Project Type**: Modular web API

**Performance Goals**: Truy vấn bounded theo school và academic year; không scan chéo tổ chức

**Constraints**: School isolation bắt buộc; mutation dùng transaction; giữ response envelope hiện tại

**Scale/Scope**: Module `class`, permission catalog, Prisma schema/migration và test liên quan

## Constitution Check

- Module boundary: thay đổi nằm trong `src/modules/class`; controller, validation và service giữ đúng trách nhiệm hiện tại của module.
- Authorization: principal đã xác thực quyết định school scope; API quản lý yêu cầu `class_assignment.manage`.
- Database safety: thêm migration versioned, không chạy migration hoặc ghi dữ liệu remote trong quá trình tích hợp.
- Transaction: đổi/gỡ phân công đóng bản ghi cũ và tạo/cập nhật bản ghi liên quan trong transaction.
- HTTP contract: dùng response helper hiện tại và chỉ trả safe projection.
- Spec-driven: branch và thư mục spec cùng số `002`, không còn clarification mở.

Không có vi phạm constitution cần exception.

## Project Structure

### Documentation

```text
specs/002-class-homeroom-assignment/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code

```text
prisma/
├── schema.prisma
└── migrations/20261104000100_class_homeroom_assignments/migration.sql
src/
├── constants/permission-catalog.ts
└── modules/class/
    ├── academic-year.ts
    ├── class.controller.ts
    ├── class.repository.ts
    ├── class.request.dto.ts
    ├── class.response.dto.ts
    ├── class.routes.ts
    ├── class.service.ts
    └── class.validation.ts
tests/
└── class-assignment.test.ts
```

**Structure Decision**: Tái sử dụng module `class` và schema hiện hữu; không tạo module hoặc bảng cấu hình không cần thiết.

## Complexity Tracking

Không có exception.
