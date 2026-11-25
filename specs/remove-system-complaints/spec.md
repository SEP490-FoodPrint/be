# Feature Specification: Gỡ khiếu nại gửi System Admin (C06)

**Feature Branch**: `refactor/remove-system-complaints`

**Created**: 2026-11-25

**Status**: Implemented

**Input**: "xóa bỏ các api về khiếu nại hệ thống cho system admin giúp tôi, do tôi thấy nó bị out scope"

## Bối cảnh

[specs/system-complaint-management](../system-complaint-management/spec.md) (PR #177) thêm C06: mọi vai trò trừ System Admin gửi khiếu nại `FP-SC` tới System Admin qua `/api/system-complaints`, dùng bảng con `system_complaints` (enum `system_complaint_category`) của bảng cha `complaints` (`kind = SYSTEM`) và ba quyền `system_complaint.submit|view|respond`. Tính năng này nay ngoài phạm vi đồ án.

## Clarifications

### Session 2026-11-25

- Gỡ API hay gỡ cả DB? → Người dùng chọn **gỡ cả bảng**: xóa vĩnh viễn dữ liệu FP-SC (đơn, bình luận, lịch sử, email outbox), DROP `system_complaints` và `system_complaint_category`. Không khôi phục được; CD chạy migration trên azure-dev.
- Quyết định mặc định:
  - Giữ giá trị `SYSTEM` của enum `complaint_kind`: bỏ giá trị enum cần dựng lại mọi cột `kind` có FK tổ hợp `(id, kind)`. Thay vào đó thêm CHECK `chk_complaints_kind_not_system`.
  - Giữ CHECK mã `FP-SC-%` cũ trên `complaints` (migration đã áp dụng không sửa).
  - Chữ viết tắt `SC` chuyển sang danh sách dành riêng, không đăng ký lại cho tính năng khác.
  - Migration xóa ba dòng `permissions` `system_complaint.*`; `role_permissions` và `user_permission_denials` xóa theo `ON DELETE CASCADE`. Lý do: bootstrap không xóa quyền đã bỏ khỏi catalog.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Backend MUST không còn mount `/api/system-complaints` (mọi endpoint trả `404`), không còn module `system-complaint`, resource `system-complaint` và các quyền `system_complaint.*` trong catalog.
- **FR-002**: Migration `20261209000100_remove_system_complaints` MUST xóa `email_outbox`, `complaint_comments`, `complaint_status_histories`, `system_complaints` và `complaints` thuộc đơn `kind = SYSTEM`; DROP bảng `system_complaints` và enum `system_complaint_category`; thêm CHECK `chk_complaints_kind_not_system`; xóa `permissions` có mã `system_complaint.*`. Đơn loại khác MUST giữ nguyên.
- **FR-003**: Prisma schema MUST bỏ model `SystemComplaint`, quan hệ `Complaint.systemComplaint` và enum `SystemComplaintCategory`.
- **FR-004**: `BUSINESS_CODE_TYPES` MUST bỏ `SC` và đưa `SC` vào danh sách dành riêng.
- **FR-005**: Tài liệu (`docs/AUTHORIZATION.md`, `src/modules/README.md`) MUST ghi tính năng đã gỡ. Spec này thay thế `specs/system-complaint-management` (Spec gate không cho sửa spec khác trong PR này).

## Success Criteria _(mandatory)_

- **SC-001**: `npm run validate`, `test:unit`, `test:local:migrations`, `test:local:authorization` pass; test migration kiểm tra dữ liệu FP-SC bị xóa, đơn khác còn, bảng/enum/quyền đã gỡ và CHECK chặn đơn `SYSTEM` mới.

## Phạm vi

- Trong phạm vi: module, route, resource, quyền, schema, migration, test, tài liệu.
- Ngoài phạm vi: bỏ giá trị enum `complaint_kind.SYSTEM`; sửa migration cũ; `docs/complaint_db_design_plan_v3.md` và `docs/complaint_state_diagrams.md` (tài liệu thiết kế lịch sử).
