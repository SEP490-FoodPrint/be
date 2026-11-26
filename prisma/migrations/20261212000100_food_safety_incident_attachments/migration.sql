-- File đính kèm hồ sơ sự cố ATTP (specs/food-safety-incident-attachments, plan v6 §5.3, Q29–Q31, Q35).
-- Bảng chỉ thêm (append-only): backend không có thao tác sửa/xóa.
-- stage REPORT = lúc báo cáo / BGH tự lập; SCHOOL_REVIEW = lúc BGH xác minh và chuyển ATTP;
-- INSPECTION_RESULT = lúc ATTP ghi kết quả đợt kiểm tra (bắt buộc có inspection_id cùng hồ sơ).
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

CREATE TYPE "foodprint"."food_safety_incident_attachment_stage" AS ENUM (
  'REPORT',
  'SCHOOL_REVIEW',
  'INSPECTION_RESULT'
);

CREATE TABLE "foodprint"."food_safety_incident_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "stage" "foodprint"."food_safety_incident_attachment_stage" NOT NULL,
    "inspection_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_public_id" TEXT NOT NULL,
    "mime_type" VARCHAR(32) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "food_safety_incident_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "food_safety_incident_attachments_mime_type"
      CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    CONSTRAINT "food_safety_incident_attachments_size_range"
      CHECK ("size_bytes" BETWEEN 1 AND 5242880),
    CONSTRAINT "food_safety_incident_attachments_sha256_format"
      CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "food_safety_incident_attachments_filename_present"
      CHECK (length(btrim("original_filename")) > 0),
    CONSTRAINT "food_safety_incident_attachments_public_id_present"
      CHECK (length(btrim("storage_public_id")) > 0),
    -- Chỉ file kết quả kiểm tra gắn với một đợt kiểm tra.
    CONSTRAINT "food_safety_incident_attachments_inspection_stage"
      CHECK (("stage" = 'INSPECTION_RESULT') = ("inspection_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "food_safety_incident_attachments_storage_public_id_key" ON "foodprint"."food_safety_incident_attachments"("storage_public_id");
CREATE INDEX "idx_food_safety_incident_attachments_incident" ON "foodprint"."food_safety_incident_attachments"("incident_id", "created_at", "id");

ALTER TABLE "foodprint"."food_safety_incident_attachments"
  ADD CONSTRAINT "food_safety_incident_attachments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "foodprint"."food_safety_incidents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
-- FK tổ hợp: đợt kiểm tra phải thuộc cùng hồ sơ.
ALTER TABLE "foodprint"."food_safety_incident_attachments"
  ADD CONSTRAINT "food_safety_incident_attachments_inspection_fkey" FOREIGN KEY ("incident_id", "inspection_id") REFERENCES "foodprint"."food_safety_inspections"("incident_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "foodprint"."food_safety_incident_attachments"
  ADD CONSTRAINT "food_safety_incident_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
