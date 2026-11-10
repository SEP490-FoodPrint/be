# Implementation Plan

## Constitution Check

- Module phân lớp routes/controller/validation/service/repository/request DTO/response DTO.
- Principal và resource scope lấy từ DB/session, không tin organization/user từ client.
- Không thay schema hoặc migration; transaction dùng shared Prisma client.
- Response là allowlist DTO, date serialize ISO; lỗi theo convention hiện có.
- Spec và code cùng branch `feat/012-meal-complaint-management`.

## Backend

1. Bổ sung grant catalog cho GVCN và owner scope trong `listScopes.feedback`.
2. Hoàn thiện repository, DTO, validation, service, controller và routes.
3. Bổ sung allocation projection cho API my-class.
4. Viết unit tests cho role, tenant, ownership, transition và server-derived fields.

## Frontend

1. Tạo ComplaintService theo contract.
2. Thay stub MealFeedback bằng list/detail/create/respond theo role.
3. Bổ sung routes/menu phù hợp, responsive desktop/tablet/mobile.

## Database

Không có schema/migration. Catalog grant chỉ có hiệu lực khi operator chạy bootstrap đã được duyệt; task này không ghi database/Azure.
