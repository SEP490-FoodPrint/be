# Implementation Plan: Bổ sung API còn thiếu cho frontend

**Branch**: `fix/frontend-api-gaps` | **Spec**: [spec.md](./spec.md)

## Summary

Ba thay đổi nhỏ, chỉ đọc, không đổi schema: bộ lọc trạng thái hiển thị cho người gửi (C03/C05), `receivedAt` trong danh sách báo cáo ATTP và `supplierIntakeState` trong danh sách nhân viên NCC.

## Constitution Check

- Spec-driven: `specs/frontend-api-gaps/{spec,plan,tasks}.md` cùng PR.
- Không migration, không DDL, không quyền mới; phạm vi đọc vẫn lấy từ `listScopes`/`supplierStaffManagementScope`.
- Service quyết định nghiệp vụ, repository nhận danh sách trạng thái đã tính và dựng `where`; Response DTO allowlist.

## Thiết kế

- `complaint-ticket.lifecycle.ts`: hàm thuần `ticketStatusFilter(status, requesterOnly)` trả danh sách trạng thái thật hoặc ném `HttpError(400)`; hằng `REQUESTER_IN_PROGRESS_STATUSES`.
- `feedback.service.ts`: `requesterOnly` khi principal là SCHOOL và `isComplaintSubmitter(role)`; `feedback.repository.ts#list` nhận thêm `statuses` và lọc `status IN (...)`.
- `authority-complaint.service.ts`: `requesterOnly` khi principal là SCHOOL và không phải BGH (đúng nhánh `senderUserId` của `listScopes`); filter repository đổi `status` → `statuses`.
- `reporting`: thêm `receivedAt` vào `listSelect`, Response DTO và ánh xạ.
- `supplier-staff`: repository `supplierIntakeState(scope)` đọc `Supplier.intakeState` theo `scope.supplierId`; service đọc song song với danh sách, `null` → `404`.

## Rủi ro

- Frontend người gửi đang gửi `status=NEW`/`REOPENED` sẽ nhận `400`; frontend hiện chỉ gửi `IN_PROGRESS | RESOLVED | CLOSED`.
- Response thêm trường, không bỏ trường nào nên client cũ không bị ảnh hưởng.
