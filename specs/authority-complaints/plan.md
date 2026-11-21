# Implementation Plan: Khiếu nại leo thang lên ATTP (C05, PR4)

**Branch**: `feat/authority-complaints` | **Spec**: [spec.md](./spec.md)

## Summary

Migration thêm địa bàn cho đơn vị ATTP và bảng con `authority_complaints`; module mới `authority-complaint` (`/api/authority-complaints`) dùng lõi `complaint-ticket`; thao tác `ESCALATE` trong lifecycle; API gắn địa bàn trong module `authority`.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL. Tái sử dụng `withSchoolTransaction`, `authorizationTransaction` + `loadPrincipal`, `complaintTicketRepository.transition/addComment/allocateCode/recordCreated`, `mapTicketFields`, `mapTicketComment`. Job tự đóng PR1 không lọc kind nên áp dụng cho C05.

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/authority-complaints/`.
- Module mới đủ lớp; service không dựng truy vấn Prisma; khóa `FOR UPDATE` nằm trong repository.
- List endpoint có `requireResource("authority-complaint")` + scope trong `resource-access.ts`.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger.
- Mã `FP-AC-NNNNN` đăng ký một lần trong `business-code.ts`.
- Không seed/thao tác DB từ xa.

## Data Model

Migration `prisma/migrations/20261128000100_authority_complaints/migration.sql`:

- `ALTER TABLE commune_food_safety_units ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE RESTRICT`; `CREATE UNIQUE INDEX uq_commune_food_safety_units_location_id ... WHERE location_id IS NOT NULL`.
- `authority_complaints` như FR-001; index `idx_authority_complaints_school`, `idx_authority_complaints_recipient`.

Prisma: model `AuthorityComplaint`; quan hệ `Complaint.authorityComplaint`, `MealComplaint.authorityEscalation`, `School.authorityComplaints`, `CommuneFoodSafetyUnit.location/authorityComplaints`, `Location.communeFoodSafetyUnits`.

## Thiết kế mã

- `complaint-ticket.lifecycle.ts`: `TicketAction` thêm `ESCALATE` (`CLOSED`/`ESCALATED`), `allowedTicketActions(..., { canEscalate })`, `authorityComplaintTitle(code)`; `mapTicketFields` nhận tùy chọn `canEscalate`.
- `feedback`: select `senderRoleCode` + `mealComplaint.authorityEscalation {id, code}`; DTO thêm `escalatedAuthorityComplaint`; `canEscalate` cho người gửi phụ huynh có `authority_complaint.submit`.
- `resource-access.ts`: resource `authority-complaint` (FR-005).
- `src/modules/authority-complaint/`: validation, DTO, repository (`list`, `findOne`, `findTicketTarget`, `lockMealComplaint`, `findEscalationSource`, `findRecipientUnit`, `create`), service (`escalate`, `getAll`, `getOne`, `accept`, `comment`, `resolve`, `satisfy`, `reopen`), controller, routes.
- `src/modules/authority/` (mount `/api/commune-food-safety-units`): thêm `authority.repository.ts`, `authority.request.dto.ts`, `authority.response.dto.ts`; service `assignLocation`; route `PUT /:id/location` với `requirePermission("authority.manage")`.
- `permission-catalog.ts`: 4 quyền + grant.

## Kiểm thử

- Unit `tests/authority-complaint.test.ts` (thêm vào `test:unit`): validation, scope, viewer/allowedActions, escalate (thứ tự, 404/409), assignLocation, catalog.
- Integration `tests/authorization.integration.test.ts`: luồng HTTP C03 → C05 → ATTP → hài lòng, BGH chỉ đọc, đồng thời, gắn địa bàn.
- `tests/migrations.test.ts`: CHECK/FK/UNIQUE của bảng con và unique địa bàn.

## Rollback

Migration chỉ thêm cột/bảng. Rollback thủ công (có ủy quyền) khi chưa có C05: `DROP TABLE authority_complaints; DROP INDEX uq_commune_food_safety_units_location_id; ALTER TABLE commune_food_safety_units DROP COLUMN location_id;` rồi `migrate resolve --rolled-back`.

## Complexity Tracking

Không có vi phạm hiến chương.
