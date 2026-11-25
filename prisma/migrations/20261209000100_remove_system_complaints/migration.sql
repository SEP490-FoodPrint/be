-- Gỡ khiếu nại gửi System Admin (C06, FP-SC) khỏi phạm vi (specs/remove-system-complaints).
-- Xóa vĩnh viễn dữ liệu FP-SC, bảng con và enum phân loại; quyền system_complaint.* bị xóa khỏi catalog DB.
-- Giữ giá trị 'SYSTEM' của complaint_kind (đổi enum cần dựng lại mọi cột kind có FK tổ hợp),
-- và chặn đơn mới bằng CHECK chk_complaints_kind_not_system.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Khóa các bảng bị xóa dữ liệu để không có đơn/bình luận/email mới chen vào giữa chừng.
LOCK TABLE "foodprint"."complaints", "foodprint"."system_complaints",
  "foodprint"."complaint_comments", "foodprint"."complaint_status_histories",
  "foodprint"."email_outbox" IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM "foodprint"."email_outbox"
WHERE "complaint_id" IN (SELECT "id" FROM "foodprint"."complaints" WHERE "kind" = 'SYSTEM');
DELETE FROM "foodprint"."complaint_comments"
WHERE "complaint_id" IN (SELECT "id" FROM "foodprint"."complaints" WHERE "kind" = 'SYSTEM');
DELETE FROM "foodprint"."complaint_status_histories"
WHERE "complaint_id" IN (SELECT "id" FROM "foodprint"."complaints" WHERE "kind" = 'SYSTEM');
DELETE FROM "foodprint"."system_complaints";
DELETE FROM "foodprint"."complaints" WHERE "kind" = 'SYSTEM';

DROP TABLE "foodprint"."system_complaints";
DROP TYPE "foodprint"."system_complaint_category";

ALTER TABLE "foodprint"."complaints"
  ADD CONSTRAINT "chk_complaints_kind_not_system" CHECK ("kind" <> 'SYSTEM');

-- role_permissions và user_permission_denials xóa theo ON DELETE CASCADE.
DELETE FROM "foodprint"."permissions"
WHERE "code" IN ('system_complaint.submit', 'system_complaint.view', 'system_complaint.respond');

COMMIT;
