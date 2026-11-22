# Implementation Plan: Đợt kiểm tra ATTP và kết luận theo NCC (PR6a)

**Branch**: `feat/food-safety-inspections` | **Spec**: [spec.md](./spec.md)

## Summary

Thêm bảng đợt kiểm tra và kết luận theo NCC; module mới `food-safety-inspection` (gắn cùng mount `/api/food-safety-incidents`) cho cán bộ ATTP đơn vị nhận lập đợt, ghi kết quả một lần, đóng hồ sơ; chi tiết hồ sơ hiển thị đợt kiểm tra theo người xem.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL. Tái sử dụng `authorizationTransaction` + `loadPrincipal` (nạp lại actor), khóa dòng hồ sơ `FOR UPDATE`, lịch sử `food_safety_incident_status_histories`, payload snapshot PR5b (`payload.suppliers`).

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/food-safety-inspections/`.
- Module mới đủ lớp; service không dựng truy vấn Prisma; `FOR UPDATE`, `groupBy`, `updateMany` có điều kiện nằm trong repository.
- Ghi chỉ qua `requirePermission("food_safety_inspection.manage")` + kiểm tra lại trong transaction; đọc qua resource `food-safety-incident` sẵn có.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger.
- Không seed/thao tác DB từ xa.

## Data Model

Migration `prisma/migrations/20261201000100_food_safety_inspections/migration.sql`:

- Enum `food_safety_inspection_status`, `food_safety_inspection_conclusion`, `food_safety_supplier_finding`.
- `food_safety_inspections` + CHECK `_team_description`, `_result`; UNIQUE `(incident_id, id)` (cho FK tổ hợp `evidence_inspection_id` ở PR6b); index `(incident_id, status)`.
- `food_safety_inspection_supplier_findings` PK `(inspection_id, supplier_id)`, index `(supplier_id, finding)`.

## Thiết kế mã

- `src/modules/food-safety-inspection/`: validation (nhất quán kết luận chung ⇔ có NCC `AT_FAULT`), DTO, repository, service (`getSupplierOptions`, `plan`, `recordResult`, `close`), controller, routes; mount trong `src/routes/index.ts`.
- `food-safety-incident`: `detailSelect.inspections`, projection REPORTER/FULL, `allowedIncidentActions` thêm `PLAN_INSPECTION`/`CLOSE` cho cán bộ đơn vị nhận.
- `permission-catalog.ts`: `food_safety_inspection.manage` + grant.

## Kiểm thử

- Unit `tests/food-safety-inspection.test.ts` (thêm vào `test:unit`): validation, catalog/actions, NCC từ snapshot, plan/result/close với repository giả.
- Integration `tests/authorization.integration.test.ts` (subtest PR5): luồng HTTP lập 2 đợt → ghi kết quả (đồng thời) → đóng; phạm vi; projection người báo.
- `tests/migrations.test.ts`: CHECK kết quả, PK findings.

## Rollback

Migration tiến mới (có ủy quyền): xóa hai bảng và enum. Không dùng `migrate reset`/`db push`.

## Complexity Tracking

Không có vi phạm hiến chương.
