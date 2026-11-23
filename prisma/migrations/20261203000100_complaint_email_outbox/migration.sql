-- PR-E: email outbox nhận thêm dòng thông báo cho người gửi khiếu nại
-- (specs/complaint-email-notifications). Dòng hồ sơ đăng ký cũ giữ nguyên.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "foodprint"."complaint_email_event" AS ENUM ('CREATED', 'HANDLER_COMMENT', 'RESOLVED');

ALTER TABLE "foodprint"."email_outbox"
  ALTER COLUMN "registration_id" DROP NOT NULL,
  ADD COLUMN "complaint_id" uuid,
  ADD COLUMN "complaint_event" "foodprint"."complaint_email_event",
  ADD CONSTRAINT "email_outbox_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "foodprint"."complaints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "email_outbox_source_check" CHECK (num_nonnulls("registration_id", "complaint_id") = 1),
  ADD CONSTRAINT "email_outbox_complaint_event_check" CHECK (("complaint_id" IS NULL) = ("complaint_event" IS NULL));

CREATE INDEX "idx_email_outbox_complaint" ON "foodprint"."email_outbox" ("complaint_id");

COMMIT;
