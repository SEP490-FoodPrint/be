-- PR5: luồng báo cáo sự cố ATTP (specs/food-safety-incident-workflow).
-- Enum trạng thái mới, nguồn báo cáo, nhận định sơ bộ của BGH, hủy, đơn vị ATTP nhận và lịch sử trạng thái.
-- Dữ liệu cũ được ánh xạ theo docs/complaint_db_design_plan_v3.md §6.3 với source = LEGACY_IMPORT.
-- Không có function/trigger; luồng trạng thái do backend kiểm soát.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "foodprint"."food_safety_incident_status" AS ENUM (
  'PENDING_SCHOOL_REVIEW',
  'SUBMITTED_TO_AUTHORITY',
  'AUTHORITY_ACKNOWLEDGED',
  'UNDER_INSPECTION',
  'INSPECTION_COMPLETED',
  'CLOSED',
  'CANCELLED_BY_SCHOOL'
);
CREATE TYPE "foodprint"."food_safety_incident_source" AS ENUM (
  'PARENT_REPORT',
  'TEACHER_REPORT',
  'SCHOOL_DIRECT',
  'LEGACY_IMPORT'
);
CREATE TYPE "foodprint"."school_preliminary_assessment" AS ENUM (
  'SCHOOL_MEAL_SUSPECTED',
  'OUTSIDE_MEAL',
  'UNDETERMINED'
);
CREATE TYPE "foodprint"."food_safety_incident_cancellation_reason" AS ENUM (
  'DUPLICATE_REPORT',
  'DATA_ENTRY_ERROR'
);

ALTER TABLE "foodprint"."food_safety_incidents"
  ADD COLUMN "source" "foodprint"."food_safety_incident_source" NOT NULL DEFAULT 'LEGACY_IMPORT',
  ADD COLUMN "reported_role_code" VARCHAR(60),
  ADD COLUMN "reported_class_id" UUID,
  ADD COLUMN "reported_symptomatic_count" INTEGER,
  ADD COLUMN "symptom_description" TEXT,
  ADD COLUMN "school_preliminary_assessment" "foodprint"."school_preliminary_assessment",
  ADD COLUMN "school_preliminary_note" TEXT,
  ADD COLUMN "school_reviewed_by_user_id" UUID,
  ADD COLUMN "school_reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN "cancellation_reason" "foodprint"."food_safety_incident_cancellation_reason",
  ADD COLUMN "cancellation_note" TEXT,
  ADD COLUMN "recipient_commune_food_safety_unit_id" UUID,
  ADD COLUMN "status_next" "foodprint"."food_safety_incident_status";

-- §6.3: OPEN có bản chuyển → SUBMITTED_TO_AUTHORITY; OPEN chưa chuyển → PENDING_SCHOOL_REVIEW;
-- INVESTIGATING → UNDER_INSPECTION; RESOLVED → INSPECTION_COMPLETED; CLOSED → CLOSED.
-- Bản chuyển cũ đã được ATTP tiếp nhận: lần gọi tiếp nhận kế tiếp chuyển hồ sơ sang AUTHORITY_ACKNOWLEDGED (service).
UPDATE "foodprint"."food_safety_incidents" i
SET "status_next" = (CASE
    WHEN i."status" = 'OPEN' AND EXISTS (
      SELECT 1 FROM "foodprint"."food_safety_report_forwardings" f
      WHERE f."incident_id" = i."id"
    ) THEN 'SUBMITTED_TO_AUTHORITY'
    WHEN i."status" = 'OPEN' THEN 'PENDING_SCHOOL_REVIEW'
    WHEN i."status" = 'INVESTIGATING' THEN 'UNDER_INSPECTION'
    WHEN i."status" = 'RESOLVED' THEN 'INSPECTION_COMPLETED'
    ELSE 'CLOSED'
  END)::"foodprint"."food_safety_incident_status",
  "recipient_commune_food_safety_unit_id" = (
    SELECT f."recipient_commune_food_safety_unit_id"
    FROM "foodprint"."food_safety_report_forwardings" f
    WHERE f."incident_id" = i."id" AND f."recipient_commune_food_safety_unit_id" IS NOT NULL
    ORDER BY f."created_at" DESC, f."id" DESC
    LIMIT 1
  );

DROP INDEX "foodprint"."idx_food_safety_incidents_school_status";
ALTER TABLE "foodprint"."food_safety_incidents" DROP COLUMN "status";
ALTER TABLE "foodprint"."food_safety_incidents" RENAME COLUMN "status_next" TO "status";
ALTER TABLE "foodprint"."food_safety_incidents" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "foodprint"."food_safety_incidents" ALTER COLUMN "source" DROP DEFAULT;
DROP TYPE "foodprint"."incident_status";

CREATE INDEX "idx_food_safety_incidents_school_status" ON "foodprint"."food_safety_incidents"("school_id", "status");
CREATE INDEX "idx_food_safety_incidents_reporter" ON "foodprint"."food_safety_incidents"("reported_by_user_id", "created_at") WHERE "reported_by_user_id" IS NOT NULL;
CREATE INDEX "idx_food_safety_incidents_recipient" ON "foodprint"."food_safety_incidents"("recipient_commune_food_safety_unit_id") WHERE "recipient_commune_food_safety_unit_id" IS NOT NULL;

ALTER TABLE "foodprint"."food_safety_incidents"
  ADD CONSTRAINT "food_safety_incidents_reported_role_code_fkey" FOREIGN KEY ("reported_role_code") REFERENCES "foodprint"."roles"("code") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_incidents_reported_class_id_fkey" FOREIGN KEY ("reported_class_id") REFERENCES "foodprint"."classes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_incidents_school_reviewed_by_user_id_fkey" FOREIGN KEY ("school_reviewed_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_incidents_recipient_unit_fkey" FOREIGN KEY ("recipient_commune_food_safety_unit_id") REFERENCES "foodprint"."commune_food_safety_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  -- Hồ sơ mới (không phải dữ liệu cũ) luôn có người báo, vai trò, số người có triệu chứng và mã nghiệp vụ.
  ADD CONSTRAINT "food_safety_incidents_reporter" CHECK (
    "source" = 'LEGACY_IMPORT'
    OR ("reported_by_user_id" IS NOT NULL AND "reported_role_code" IS NOT NULL
        AND "reported_symptomatic_count" IS NOT NULL AND "code" IS NOT NULL)
  ),
  -- Q20: vai trò người báo theo nguồn; GVCN luôn gắn lớp.
  ADD CONSTRAINT "food_safety_incidents_source_role" CHECK (
    ("source" <> 'PARENT_REPORT' OR "reported_role_code" = 'PARENTS_COMMITTEE')
    AND ("source" <> 'TEACHER_REPORT' OR ("reported_role_code" = 'HOMEROOM_TEACHER' AND "reported_class_id" IS NOT NULL))
    AND ("source" <> 'SCHOOL_DIRECT' OR "reported_role_code" = 'SCHOOL_MANAGEMENT_BOARD')
  ),
  ADD CONSTRAINT "food_safety_incidents_symptomatic_count" CHECK (
    "reported_symptomatic_count" IS NULL OR "reported_symptomatic_count" >= 1
  ),
  -- Q4: chỉ hủy khi trùng/nhập sai, luôn kèm ghi chú.
  ADD CONSTRAINT "food_safety_incidents_cancellation" CHECK (
    ("status" = 'CANCELLED_BY_SCHOOL') = ("cancellation_reason" IS NOT NULL)
    AND ("cancellation_reason" IS NULL) = ("cancellation_note" IS NULL)
  ),
  ADD CONSTRAINT "food_safety_incidents_school_review" CHECK (
    ("school_preliminary_assessment" IS NULL) = ("school_reviewed_by_user_id" IS NULL)
    AND ("school_reviewed_by_user_id" IS NULL) = ("school_reviewed_at" IS NULL)
    AND ("school_preliminary_note" IS NULL OR "school_preliminary_assessment" IS NOT NULL)
  ),
  -- Đơn vị nhận chỉ có từ khi chuyển ATTP; nhận định sơ bộ bắt buộc trước khi chuyển (trừ dữ liệu cũ).
  ADD CONSTRAINT "food_safety_incidents_recipient" CHECK (
    CASE WHEN "status" IN ('PENDING_SCHOOL_REVIEW', 'CANCELLED_BY_SCHOOL')
      THEN "recipient_commune_food_safety_unit_id" IS NULL
      ELSE "source" = 'LEGACY_IMPORT'
        OR ("recipient_commune_food_safety_unit_id" IS NOT NULL AND "school_preliminary_assessment" IS NOT NULL)
    END
  );

CREATE TABLE "foodprint"."food_safety_incident_status_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "from_status" "foodprint"."food_safety_incident_status",
    "to_status" "foodprint"."food_safety_incident_status" NOT NULL,
    "actor_user_id" UUID,
    "actor_role_code" VARCHAR(60),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_safety_incident_status_histories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "food_safety_incident_status_histories_actor" CHECK (
      ("actor_user_id" IS NULL) = ("actor_role_code" IS NULL)
    ),
    CONSTRAINT "food_safety_incident_status_histories_change" CHECK (
      "from_status" IS DISTINCT FROM "to_status"
    )
);

CREATE INDEX "idx_food_safety_incident_status_histories_incident" ON "foodprint"."food_safety_incident_status_histories"("incident_id", "created_at", "id");

ALTER TABLE "foodprint"."food_safety_incident_status_histories"
  ADD CONSTRAINT "food_safety_incident_status_histories_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "foodprint"."food_safety_incidents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_incident_status_histories_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_incident_status_histories_actor_role_code_fkey" FOREIGN KEY ("actor_role_code") REFERENCES "foodprint"."roles"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
