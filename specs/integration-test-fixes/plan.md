# Implementation Plan: integration-test-fixes

Spec: [spec.md](spec.md).

| Yêu cầu | File chính                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-001  | `delivery/delivery.repository.ts` (`inspectionWhere`: nhánh dự phòng `createdAt` chỉ áp dụng khi đơn không có `supplyRequestId` hoặc yêu cầu không có `requestedDeliveryDate`)                        |
| FR-002  | `food-safety-incident/food-safety-incident.service.ts` (`takeSnapshot` trả `{ id, version }`, `forwardingReference`), `food-safety-incident.repository.ts` (`createForwarding` ghi `referenceNumber`) |
| FR-003  | `food-safety-inspection/food-safety-inspection.service.ts` (`close` truyền `at`), `food-safety-inspection.repository.ts` (`moveIncident` nhận `resolvedAt`)                                           |
| FR-004  | Repo `fe`: `src/pages/SUPPLIER/SupplierDeliveries/component/DeliveryDetailView.jsx`                                                                                                                   |

Không đổi schema, migration, quyền hay response envelope.

## Kiểm thử

- Unit: `food-safety-incident.test.ts` (số tham chiếu `FP-IC-48213/1` khi chuyển ATTP), `food-safety-inspection.test.ts` (đóng hồ sơ truyền `resolvedAt` bằng thời điểm lịch sử).
- Integration theo sheet: chạy lại toàn bộ MID01–86 và FPR01–38 trên database PostgreSQL tạm.
- `npm run typecheck`, ESLint/Prettier các file đổi; FE `vite build`.
