-- File đính kèm khiếu nại + loại vấn đề C02 (specs/complaint-attachments, plan v6 Q29–Q34).
-- Bảng `complaint_attachments` chỉ thêm (append-only): backend không có thao tác sửa/xóa.
-- `comment_id` NULL = file gửi lúc tạo đơn / Chuyển ATTP; khác NULL = file của bình luận.
-- `issue_type` NULL cho dòng C02 cũ; CHECK NOT VALID buộc dòng mới phải có giá trị.
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

CREATE TYPE "foodprint"."ingredient_issue_type" AS ENUM (
  'SPOILED_OR_NOT_FRESH',
  'QUANTITY_MISMATCH',
  'WRONG_SPECIFICATION',
  'EXPIRED_OR_MISSING_LABEL',
  'LATE_DELIVERY',
  'OTHER'
);

ALTER TABLE "foodprint"."ingredient_quality_feedback"
  ADD COLUMN "issue_type" "foodprint"."ingredient_issue_type";
ALTER TABLE "foodprint"."ingredient_quality_feedback"
  ADD CONSTRAINT "ingredient_quality_feedback_issue_type_required"
  CHECK ("issue_type" IS NOT NULL) NOT VALID;

CREATE TABLE "foodprint"."complaint_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_id" UUID NOT NULL,
    "comment_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploader_side" "foodprint"."complaint_comment_side" NOT NULL,
    "storage_public_id" TEXT NOT NULL,
    "mime_type" VARCHAR(32) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "complaint_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaint_attachments_mime_type"
      CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    CONSTRAINT "complaint_attachments_size_range"
      CHECK ("size_bytes" BETWEEN 1 AND 5242880),
    CONSTRAINT "complaint_attachments_sha256_format"
      CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "complaint_attachments_filename_present"
      CHECK (length(btrim("original_filename")) > 0),
    CONSTRAINT "complaint_attachments_public_id_present"
      CHECK (length(btrim("storage_public_id")) > 0),
    -- File cấp đơn chỉ do người gửi đính kèm (tạo đơn / Chuyển ATTP).
    CONSTRAINT "complaint_attachments_root_requester"
      CHECK ("comment_id" IS NOT NULL OR "uploader_side" = 'REQUESTER')
);

CREATE UNIQUE INDEX "complaint_attachments_storage_public_id_key" ON "foodprint"."complaint_attachments"("storage_public_id");
CREATE INDEX "idx_complaint_attachments_complaint" ON "foodprint"."complaint_attachments"("complaint_id", "created_at", "id");
CREATE INDEX "idx_complaint_attachments_comment" ON "foodprint"."complaint_attachments"("comment_id");

ALTER TABLE "foodprint"."complaint_attachments"
  ADD CONSTRAINT "complaint_attachments_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "foodprint"."complaints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "foodprint"."complaint_attachments"
  ADD CONSTRAINT "complaint_attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "foodprint"."complaint_comments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "foodprint"."complaint_attachments"
  ADD CONSTRAINT "complaint_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
