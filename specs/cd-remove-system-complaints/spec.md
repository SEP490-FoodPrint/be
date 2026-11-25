# Feature Specification: Triển khai lại migration gỡ khiếu nại System Admin

**Feature Branch**: `fix/cd-remove-system-complaints`

**Created**: 2026-11-25

**Status**: Implemented

**Input**: CD trên `dev` dừng với lỗi "Có migration lỗi/chưa hoàn tất; cần xử lý thủ công trước khi deploy tiếp".

## Bối cảnh

Lần CD ngày 2026-11-25 chạy `20261209000100_remove_system_complaints` ([specs/remove-system-complaints](../remove-system-complaints/spec.md)) trên Azure không hoàn tất: `_prisma_migrations` ghi `finished_at = NULL`, `applied_steps_count = 0`, không có log. Kiểm tra chỉ đọc cho thấy transaction đã rollback trọn vẹn: bảng `system_complaints`, enum `system_complaint_category` và ba quyền `system_complaint.*` còn nguyên, CHECK `chk_complaints_kind_not_system` chưa tồn tại. Migration đặt `lock_timeout = 5s` trong khi API trên Azure vẫn đọc/ghi `complaints`, `email_outbox` và quyền; `ADD CONSTRAINT`/`DROP TABLE` còn phải nâng khóa lên `ACCESS EXCLUSIVE` giữa transaction.

## Clarifications

### Session 2026-11-25

- Người dùng chọn: sửa migration (chưa áp dụng thành công ở Azure) để chờ khóa lâu hơn, rồi operator đánh dấu lần chạy lỗi là rolled-back trên Azure để CD chạy lại.
- Nội dung thay đổi dữ liệu/cấu trúc của migration giữ nguyên; chỉ đổi thời gian chờ và thứ tự lấy khóa.
- DB local đã chạy bản cũ của migration sẽ báo lệch checksum; xử lý bằng `prisma migrate resolve` hoặc dựng lại DB local, không ảnh hưởng Azure.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Migration MUST đặt `lock_timeout = 30s`, `statement_timeout = 5min` và lấy `ACCESS EXCLUSIVE` trên `complaints`, `system_complaints` ngay đầu transaction; các bảng con giữ `SHARE ROW EXCLUSIVE`.
- **FR-002**: Mọi câu lệnh xóa/DROP/CHECK/xóa quyền của migration MUST giữ nguyên.
- **FR-003**: Trước khi CD chạy lại, operator MUST chạy `prisma migrate resolve --rolled-back 20261209000100_remove_system_complaints` trên Azure sau khi đã xác nhận không có thay đổi nào được áp dụng; CD không tự resolve.

## Success Criteria

- **SC-001**: `npm run test:local:migrations` qua; CD trên `dev` áp dụng migration và `db:deploy:check` không còn báo migration lỗi.
