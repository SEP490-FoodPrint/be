# Implementation Plan: Phân Nhóm Bộ Phận Duyệt Nguyên Liệu Đầu Vào (Delivery Inspection Tiers)

**Branch**: `feat/delivery-inspection-tiers` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/delivery-inspection-tiers/spec.md`

## Summary

Triển khai tính năng phân nhóm bộ phận kiểm tra nguyên liệu đầu vào theo trường (PRIMARY, REQUIRED, OPTIONAL). Ban Giám Hiệu cấu hình cho 3 role của trường (Bếp, Kho, Dinh dưỡng); Ban Phụ huynh cố định là OPTIONAL. Khi xe đến, role PRIMARY xác nhận và tạo snapshot cho đợt giao. Quy trình hoàn tất khi PRIMARY + mọi REQUIRED duyệt APPROVE. Quyết định REJECT của OPTIONAL không làm hỏng đợt giao và không tính vào cap3.

## Technical Context

**Language/Version**: Node.js 24.22.1, TypeScript strict, CommonJS
**Primary Dependencies**: Express, Zod, Prisma 7.10.1, PostgreSQL
**Storage**: 
- Enum `DeliveryInspectionTier` (`PRIMARY`, `REQUIRED`, `OPTIONAL`).
- Bảng `school_delivery_inspection_roles` (cấu hình theo trường, partial unique index 1 PRIMARY).
- Bảng `delivery_inspection_roles` (snapshot theo đợt giao, partial unique index 1 PRIMARY).
**Testing**: Node test runner qua `tsx --test`, unit tests T1–T15, update existing tests.
**Target Platform**: Backend Express CommonJS
**Project Type**: REST API service
**Constraints**: 
- Tuân thủ constitution: không chạy migration/seed ngoài quy định.
- Giữ nguyên envelope, không N+1 queries.
- Chỉ BGH có quyền cấu hình; `schoolId` lấy từ principal.
- Hỗ trợ các đợt giao legacy (không có snapshot) bằng fallback 4 role REQUIRED.

## Constitution Check

| Nguyên tắc | Trạng thái | Bằng chứng thiết kế |
|---|---|---|
| I. Kiến trúc module phân lớp | PASS | Controller chỉ điều phối; Zod schema strict; DTO tách biệt request/response; repository sở hữu Prisma queries. |
| II. Phân quyền và cô lập tổ chức | PASS | Permission `school_delivery_inspection.manage`; kiểm tra BGH; `schoolId` lấy từ session; recheck trong transaction. |
| III. An toàn cơ sở dữ liệu | PASS | Tạo migration file mới `20261123000100_delivery_inspection_tiers/migration.sql`; không sửa migration cũ; không db push; apply local có kiểm soát. |
| IV. Transaction, cache và rate limit | PASS | `withSchoolTransaction` cho cấu hình; transaction nội bộ cho arrival (markArrived + snapshot) và decide. |
| V. Hợp đồng HTTP và dữ liệu đầu ra | PASS | Giữ nguyên response envelope `sendSuccess`/`sendError`, map trường cho phép trong response DTO. |
| VI. Phát triển theo spec | PASS | Nhánh `feat/delivery-inspection-tiers`; spec/plan/tasks đầy đủ; không có điểm chưa làm rõ. |

## Design

### Database Design

```prisma
enum DeliveryInspectionTier {
  PRIMARY
  REQUIRED
  OPTIONAL

  @@map("delivery_inspection_tier")
  @@schema("foodprint")
}

model SchoolDeliveryInspectionRole {
  schoolId        String                 @map("school_id") @db.Uuid
  roleId          String                 @map("role_id") @db.Uuid
  tier            DeliveryInspectionTier
  updatedByUserId String                 @map("updated_by_user_id") @db.Uuid
  createdAt       DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime               @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)
  School          School                 @relation("school_delivery_inspection_roles_school_id__schools", fields: [schoolId], references: [id], onDelete: Restrict, onUpdate: NoAction)
  Role            Role                   @relation("school_delivery_inspection_roles_role_id__roles", fields: [roleId], references: [id], onDelete: Restrict, onUpdate: NoAction)
  updatedByUser   User                   @relation("school_delivery_inspection_roles_updated_by__users", fields: [updatedByUserId], references: [id], onDelete: Restrict, onUpdate: NoAction)

  @@id([schoolId, roleId])
  @@unique([schoolId], map: "uq_school_delivery_inspection_primary", where: raw("(tier = 'PRIMARY'::delivery_inspection_tier)"))
  @@map("school_delivery_inspection_roles")
  @@schema("foodprint")
}

model DeliveryInspectionRole {
  deliveryId String                 @map("delivery_id") @db.Uuid
  roleId     String                 @map("role_id") @db.Uuid
  tier       DeliveryInspectionTier
  createdAt  DateTime               @default(now()) @map("created_at") @db.Timestamptz(6)
  Delivery   Delivery               @relation("delivery_inspection_roles_delivery_id__deliveries", fields: [deliveryId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  Role       Role                   @relation("delivery_inspection_roles_role_id__roles", fields: [roleId], references: [id], onDelete: Restrict, onUpdate: NoAction)

  @@id([deliveryId, roleId])
  @@unique([deliveryId], map: "uq_delivery_inspection_primary", where: raw("(tier = 'PRIMARY'::delivery_inspection_tier)"))
  @@map("delivery_inspection_roles")
  @@schema("foodprint")
}
```

### API Contracts

1. `GET /api/schools/me/delivery-inspection-roles`
   - Auth: Bearer token, `school_delivery_inspection.manage`, `SCHOOL_MANAGEMENT_BOARD`
   - Response:
     ```json
     {
       "configured": false,
       "roles": [
         { "roleCode": "SCHOOL_KITCHEN_STAFF", "roleName": "Nhân viên Bếp / Bếp trưởng", "tier": "PRIMARY", "tierLabel": "Người duyệt chính", "editable": true },
         { "roleCode": "INGREDIENT_MANAGEMENT_DEPARTMENT", "roleName": "Bộ phận Quản lý Kho & Nguyên liệu", "tier": "REQUIRED", "tierLabel": "Bắt buộc duyệt", "editable": true },
         { "roleCode": "SCHOOL_NUTRITION_OFFICER", "roleName": "Nhân viên Dinh dưỡng", "tier": "REQUIRED", "tierLabel": "Bắt buộc duyệt", "editable": true },
         { "roleCode": "PARENTS_COMMITTEE", "roleName": "Ban Đại diện Phụ huynh", "tier": "OPTIONAL", "tierLabel": "Tùy chọn", "editable": false }
       ],
       "updatedAt": null
     }
     ```

2. `PUT /api/schools/me/delivery-inspection-roles`
   - Auth: Bearer token, `school_delivery_inspection.manage`, `SCHOOL_MANAGEMENT_BOARD`
   - Request Body:
     ```json
     {
       "roles": [
         { "roleCode": "SCHOOL_KITCHEN_STAFF", "tier": "PRIMARY" },
         { "roleCode": "INGREDIENT_MANAGEMENT_DEPARTMENT", "tier": "REQUIRED" },
         { "roleCode": "SCHOOL_NUTRITION_OFFICER", "tier": "OPTIONAL" }
       ]
     }
     ```
   - Response: Cấu trúc tương tự GET với `configured: true`.
