# Implementation Plan: Gỡ khiếu nại gửi System Admin (C06)

**Branch**: `refactor/remove-system-complaints` | **Spec**: [spec.md](./spec.md)

## Summary

Xóa module `system-complaint` cùng route, resource, quyền và test; thêm migration xóa dữ liệu FP-SC, DROP bảng con và enum phân loại, chặn `kind = SYSTEM` bằng CHECK và xóa quyền khỏi DB.

## Constitution Check

- Spec-driven: `specs/remove-system-complaints/{spec,plan,tasks}.md` cùng PR.
- Migration mới, không sửa migration cũ; CHECK trong SQL; không function/trigger.
- Migration xóa dữ liệu được người dùng chấp thuận rõ ràng (Clarifications); chỉ CD áp dụng trên azure-dev.

## Thiết kế

- Migration chạy trong một transaction, `LOCK TABLE … SHARE ROW EXCLUSIVE` trên các bảng bị xóa dữ liệu, xóa theo thứ tự con → cha (FK `RESTRICT`), rồi DROP, thêm CHECK, xóa quyền.
- Type `ComplaintKindValue` và `ComplaintEmailKind` giữ `SYSTEM` vì Prisma vẫn sinh giá trị này từ enum DB.
- `complaint-ticket.lifecycle.ts`: bỏ hằng phân loại và tiêu đề C06.
- `tests/complaint-email.test.ts`: ca `HANDLER_COMMENT` chuyển sang đơn C05.
- `tests/migrations.test.ts`: test C06 cũ tiếp tục áp dụng các migration tới migration gỡ và kiểm tra kết quả.
- `tests/authorization.integration.test.ts`: bỏ ca C06. Ràng buộc `email_outbox` cho khiếu nại vẫn được test ở `migrations.test.ts`.

## Rủi ro

- Mất dữ liệu FP-SC trên azure-dev là có chủ đích và không khôi phục được.
- Frontend còn gọi `/api/system-complaints` sẽ nhận `404`; cần bỏ màn tương ứng.
