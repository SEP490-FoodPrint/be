# Implementation Plan: File đính kèm hồ sơ sự cố ATTP (PR-G)

**Branch**: `feat/food-safety-incident-attachments` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

## Summary

Thêm bảng `food_safety_incident_attachments` và nối tiện ích file chứng cứ của PR-F (`src/utils/evidence-files.ts`) vào `food-safety-incident` (báo cáo, tự lập, chuyển ATTP) và `food-safety-inspection` (ghi kết quả); đưa `sha256` file vào payload snapshot v2.

## Technical Context

- TypeScript strict, Express 5, Prisma (CJS), PostgreSQL, multer (memory), Cloudinary (raw, authenticated).
- Public id `foodprint/food-safety-incidents/<userId>/<uuid>.<ext>`; URL xem `private_download_url` hạn 600 giây.

## Constitution Check

- Spec-driven: spec này + migration mới, không sửa migration cũ.
- Controller → validation (Zod) → service (DTO, upload, transaction) → repository (Prisma select/create).
- Không seed, không chạy migration trên Azure; CD triển khai sau khi merge `dev`. Không thêm quyền ⇒ không có bước vận hành azure-dev.

## Design

1. **Migration** `20261212000100_food_safety_incident_attachments`: enum bước, bảng + CHECK + FK tổ hợp tới `food_safety_inspections(incident_id, id)` (đã có UNIQUE từ PR6a, cùng cách `food_safety_report_forwardings.trace_snapshot_id`).
2. **`evidence-files.ts`**: tham số `area` (`complaints` mặc định | `food-safety-incidents`) cho `storeEvidenceFiles`/`withStoredEvidence`; `signedEvidenceUrl` trả `null` khi ký lỗi.
3. **`food-safety-incident`**: validation thêm `files` + tiền xử lý chuỗi multipart; repository `addAttachments`, `findSnapshotEvidence`, select `attachments` trong chi tiết; service kiểm tra quyền trước upload, bọc transaction bằng `withStoredEvidence`, ghi file trước `takeSnapshot`; `buildTraceSnapshot(incident, rows, evidence)` → payload v2; ánh xạ file theo projection.
4. **`food-safety-inspection`**: validation `files` + `findings` chuỗi JSON; repository `addResultAttachments`, select `attachments` của đợt; service ghi file cùng transaction kết quả.
5. **Tài liệu**: `src/modules/README.md`, `docs/AUTHORIZATION.md`, plan v6 đánh dấu PR-G.

## Testing

- Unit: `tests/food-safety-incident-attachments.test.ts` (validation, đường dẫn lưu, luồng service với repository/storage giả, projection, payload v2, route multipart); cập nhật `tests/food-safety-incident.test.ts`, `tests/food-safety-inspection.test.ts`.
- `npm run validate`, `npm run test:unit`, `npm run prisma:validate`. Migration/integration test cần PostgreSQL local (`test:local:*`) nếu được phép; CI chạy.
