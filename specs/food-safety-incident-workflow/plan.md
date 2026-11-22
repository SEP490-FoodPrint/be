# Implementation Plan: Luồng báo cáo sự cố ATTP (PR5)

**Branch**: `feat/food-safety-incident-workflow` | **Spec**: [spec.md](./spec.md)

## Summary

Migration chuyển `food_safety_incidents` sang enum trạng thái mới (ánh xạ §6.3), thêm nguồn báo cáo, nhận định sơ bộ, hủy, đơn vị nhận và bảng lịch sử trạng thái; module mới `food-safety-incident` thay `inspection` tại `/api/food-safety-incidents`; `reporting.receive` chuyển hồ sơ sang `AUTHORITY_ACKNOWLEDGED`.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL. Tái sử dụng `withSchoolTransaction` (Serializable, nạp lại actor, khóa trường), `allocateBusinessCode("IC")`, cách suy ra đơn vị ATTP của C05 (`schools.location_id` → `commune_food_safety_units.location_id`), `readListPage`.

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/food-safety-incident-workflow/`.
- Module mới đủ lớp; service không dựng truy vấn Prisma; `FOR UPDATE` nằm trong repository.
- List endpoint có `requireResource("food-safety-incident")` + scope trong `resource-access.ts`.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger.
- Mã `FP-IC` đã đăng ký trong `business-code.ts`; cấp trong transaction tạo hồ sơ.
- Không seed/thao tác DB từ xa.

## Data Model

Migration `prisma/migrations/20261129000100_food_safety_incident_workflow/migration.sql`:

- Enum `food_safety_incident_status`, `food_safety_incident_source`, `school_preliminary_assessment`, `food_safety_incident_cancellation_reason`.
- Cột mới trên `food_safety_incidents` (FR-002); `status` chuyển qua cột tạm `status_next` (biểu thức `USING` không nhận subquery), xóa enum `incident_status`; index `school_status` dựng lại, thêm index người báo và đơn vị nhận.
- CHECK: `food_safety_incidents_reporter`, `_source_role`, `_symptomatic_count`, `_cancellation`, `_school_review`, `_recipient`.
- Bảng `food_safety_incident_status_histories` + CHECK `_actor`, `_change`.

Prisma: enum `FoodSafetyIncidentStatus` thay `IncidentStatus`; model `FoodSafetyIncidentStatusHistory`; quan hệ mới trên `Role`, `Class`, `User`, `CommuneFoodSafetyUnit`.

## Thiết kế mã

- `src/modules/food-safety-incident/`: validation, DTO, repository (`list`, `findDetail`, `lockIncident`, `findTarget`, `findActiveClass`, `isCurrentHomeroom`, `findSchoolLocationId`, `findRecipientUnit`, `findUnitOfficer`, `allocateCode`, `create`, `recordHistory`, `markForwarded`, `createForwarding`, `markCancelled`, `findSchoolAllocations`, `addAllocations`), service (`getAll`, `getOne`, `report`, `createDirect`, `forward`, `cancel`, `addAllocations`), controller, routes; xóa `src/modules/inspection/`.
- `resource-access.ts`: resource `inspection` → `food-safety-incident` (FR-005).
- `reporting`: `acknowledgeIncident` trong transaction tiếp nhận (FR-008).
- `retained-sample`, `school-overview`: FR-010.
- `permission-catalog.ts`: `food_safety_incident.report` + grant.

## Kiểm thử

- Unit `tests/food-safety-incident.test.ts` (thêm vào `test:unit`): validation, scope, actions, catalog, report/direct/forward/cancel/allocations với repository giả; cập nhật `reporting-receive`, `intake-access`, `authorization`.
- Integration `tests/authorization.integration.test.ts`: luồng HTTP đầy đủ, đồng thời, phạm vi người báo/ATTP, tổng quan trường.
- `tests/migrations.test.ts`: ánh xạ dữ liệu cũ §6.3 và CHECK mới; cập nhật fixture sự cố trong các test hiện có.

## Rollback

Migration đổi kiểu cột trạng thái nên rollback là migration tiến mới (dựng lại `incident_status`, ánh xạ ngược `PENDING_SCHOOL_REVIEW`/`SUBMITTED_TO_AUTHORITY`/`AUTHORITY_ACKNOWLEDGED` → `OPEN`, `UNDER_INSPECTION` → `INVESTIGATING`, `INSPECTION_COMPLETED` → `RESOLVED`, `CLOSED`/`CANCELLED_BY_SCHOOL` → `CLOSED`), có ủy quyền; không dùng `migrate reset`/`db push`.

## Complexity Tracking

Không có vi phạm hiến chương.
