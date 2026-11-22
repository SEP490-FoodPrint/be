# Implementation Plan: Chế tài NCC theo sự cố ATTP (PR6b)

**Branch**: `feat/supplier-enforcement` | **Spec**: [spec.md](./spec.md)

## Summary

Thêm bảng yêu cầu chế tài, hạn chế hiệu lực, tài khoản bị khóa và lịch sử trạng thái tài khoản; module mới `supplier-enforcement` cho cán bộ ATTP đơn vị nhận đề nghị (`PAUSE_INTAKE`/`LOCK_ACCOUNT`/`RESTORE`) và System Admin duyệt = thực thi (khóa NCC, tạm dừng tiếp nhận, `LOCKED` tài khoản, thu hồi phiên sau commit), gỡ hạn chế không vượt sự cố khác; chặn tạo/mở khóa tài khoản NCC và mở lại tiếp nhận khi còn hạn chế.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL 18 (Azure 18.6, CI `postgres:18`). Tái sử dụng `authorizationTransaction` (Serializable, retry khi xung đột) + `loadPrincipal`/`assertSystemManager`, khóa dòng `FOR UPDATE`, `authSessions.revokeUser` (Redis generation marker), dữ liệu PR6a (`food_safety_inspections`, findings) và PR5b (snapshot NCC).

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/supplier-enforcement/`.
- Module mới đủ lớp; service không dựng truy vấn Prisma; `FOR UPDATE`, `updateMany` có điều kiện nằm trong repository.
- Ghi: `requirePermission` + kiểm tra lại trong transaction; đọc qua resource `supplier-enforcement` trong `resource-access.ts`.
- Migration mới, không sửa migration cũ; CHECK/partial unique trong SQL; không function/trigger.
- Không seed/thao tác DB từ xa.

## Data Model

Migration `prisma/migrations/20261202000100_supplier_enforcement/migration.sql`:

- Enum `supplier_enforcement_action_type`, `supplier_enforcement_decision_status`, `supplier_enforcement_execution_status`, `supplier_restriction_type`.
- `supplier_enforcement_actions`: CHECK `_lock_evidence`, `_reason`, `_decision`, `_execution`; FK tổ hợp `(incident_id, evidence_inspection_id)`; UNIQUE `(id, supplier_id, incident_id)`; partial unique `uq_supplier_enforcement_actions_pending`; index hàng chờ, theo NCC.
- `supplier_restrictions`: CHECK `_source`, `_lifted`; FK tổ hợp `(source_action_id|lifted_by_action_id, supplier_id, incident_id)`; `uq_supplier_restrictions_active … NULLS NOT DISTINCT WHERE is_active` (Prisma khai báo `@@unique(..., where: raw("is_active"))`, `migrate diff` không phân biệt `NULLS NOT DISTINCT`).
- `supplier_restriction_locked_accounts` PK `(restriction_id, user_id)`, CHECK `previous_status = 'ACTIVE'`.
- `account_status_histories` CHECK `_change`, `_reason`.

## Thiết kế mã

- `src/modules/supplier-enforcement/`: validation, DTO, repository, service (`request`, `list`, `getOne`, `approve`, `reject`, `retry`), controller, routes (`createSupplierEnforcementRouter` tại `/api/supplier-enforcement-actions`, `createIncidentEnforcementRouter` cùng mount `/api/food-safety-incidents`).
- Thứ tự khóa khi duyệt: dòng `suppliers` → dòng yêu cầu (cùng thứ tự `supplier-staff` khóa NCC trước tài khoản) để tuần tự hóa với quản lý nhân viên NCC và các lần duyệt khác của cùng NCC.
- Thu hồi phiên chạy sau commit, lỗi → `markExecution(APPLIED → FAILED)`; `retry` thu hồi lại tài khoản còn `LOCKED` của hạn chế do yêu cầu tạo.
- `resource-access.ts`: resource `supplier-enforcement`; `permission-catalog.ts`: 2 quyền + grant.
- `supplier-staff` (`hasAccountLock`) và `account-lifecycle` (`hasActiveRestriction`): guard 409.

## Kiểm thử

- Unit `tests/supplier-enforcement.test.ts` (thêm vào `test:unit`): catalog, validation, scope, quy tắc đề nghị, duyệt/từ chối, `LOCK` lỗi thu hồi → retry, `RESTORE` đa sự cố với repository giả có trạng thái; guard trong `tests/account-lifecycle.test.ts`, `tests/supplier-staff-management.test.ts`.
- Integration `tests/authorization.integration.test.ts` (subtest PR5): luồng HTTP hai hồ sơ, duyệt đồng thời, phiên bị thu hồi, `RESTORE` lần lượt, lịch sử, CHECK qua Prisma.
- `tests/migrations.test.ts`: CHECK, FK tổ hợp, partial unique, `NULLS NOT DISTINCT`.

## Rollback

Migration tiến mới (có ủy quyền): xóa 4 bảng và enum (sau khi mở khóa tài khoản/tiếp nhận còn bị hạn chế). Không dùng `migrate reset`/`db push`.

## Complexity Tracking

Không có vi phạm hiến chương.
