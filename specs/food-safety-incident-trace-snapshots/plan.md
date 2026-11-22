# Implementation Plan: Snapshot truy xuất sự cố ATTP (PR5b)

**Branch**: `feat/food-safety-incident-trace-snapshots` | **Spec**: [spec.md](./spec.md)

## Summary

Thêm bảng snapshot truy xuất bất biến theo phiên bản, cột `trace_completeness` trên hồ sơ và `trace_snapshot_id` trên bản chuyển. Module `food-safety-incident` dựng payload chuẩn hóa từ các suất ăn đã gắn, hash KECCAK-256, tạo snapshot khi chuyển ATTP/tự lập/bổ sung suất ăn, gửi bản chuyển bổ sung và mở API đọc snapshot.

## Technical Context

Express + TypeScript strict (CommonJS), Prisma 7, PostgreSQL. Tái sử dụng `canonicalizeJson`/`computeCanonicalHash` (`src/utils/canonical-hash.ts`), `boardAction` (khóa dòng hồ sơ) và `withSchoolTransaction` của PR5.

## Constitution Check

- Spec-driven: spec/plan/tasks trong `specs/food-safety-incident-trace-snapshots/`.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger.
- Service không dựng truy vấn Prisma: select chuỗi truy xuất, phiên bản kế tiếp, tạo snapshot nằm trong repository; dựng payload/lý do thiếu (logic nghiệp vụ, ánh xạ) trong service.
- Endpoint đọc dùng `requireResource("food-safety-incident")` + scope trong `resource-access.ts`.
- Không quyền mới, không seed, không thao tác DB từ xa.

## Data Model

Migration `prisma/migrations/20261130000100_food_safety_incident_trace_snapshots/migration.sql`:

- Enum `trace_completeness`; `food_safety_incidents.trace_completeness` + CHECK `food_safety_incidents_trace_completeness`.
- Bảng `food_safety_incident_trace_snapshots` + UNIQUE `(incident_id, version)`, `(incident_id, id)`; CHECK `_version`, `_hash`, `_payload`, `_missing`.
- `food_safety_report_forwardings.trace_snapshot_id` + FK tổ hợp `food_safety_report_forwardings_trace_snapshot_fkey`, index một phần `idx_food_safety_forwardings_trace_snapshot`.

Prisma: enum `TraceCompleteness`, model `FoodSafetyIncidentTraceSnapshot`, quan hệ trên `FoodSafetyIncident`, `FoodSafetyReportForwarding`, `User`.

## Thiết kế mã

- Repository: `findTraceSource`, `nextSnapshotVersion`, `createSnapshot` (cập nhật `trace_completeness`), `findSnapshot`, `findActiveUnit`; `findTarget` trả thêm `code`, `schoolId`, đơn vị nhận; `createForwarding` nhận `traceSnapshotId`; chi tiết chọn thêm snapshot tóm tắt và phiên bản trên bản chuyển.
- Service: `buildTraceSnapshot`, `hashTracePayload`, `takeSnapshot`, `supplementRecipient`; `forward`/`createDirect`/`addAllocations` gọi snapshot; `getTraceSnapshot`.
- Validation `foodSafetyIncidentSnapshotParamsSchema`; route `GET /:id/trace-snapshots/:version`.

## Kiểm thử

- Unit `tests/food-safety-incident.test.ts`: payload MISSING/PARTIAL/COMPLETE, khử trùng, hash không phụ thuộc thứ tự, bổ sung sau khi gửi, đọc snapshot (403/404/`hashMatches`).
- Integration `tests/authorization.integration.test.ts` (subtest PR5): v1 khi chuyển, v2 + bản bổ sung sau khi ATTP tiếp nhận, phạm vi đọc snapshot, CHECK.
- `tests/migrations.test.ts`: hồ sơ PR5 có sẵn giữ NULL, CHECK, UNIQUE, FK tổ hợp.

## Rollback

Migration tiến mới (có ủy quyền): bỏ FK/cột `trace_snapshot_id`, bảng snapshot, cột/CHECK `trace_completeness`, enum. Không dùng `migrate reset`/`db push`.

## Complexity Tracking

Không có vi phạm hiến chương.
