-- PR6a: đợt kiểm tra ATTP và kết luận theo NCC (specs/food-safety-inspections).
-- Kết quả ghi một lần (Q26); không có function/trigger, luồng trạng thái do backend kiểm soát.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "foodprint"."food_safety_inspection_status" AS ENUM ('PLANNED', 'COMPLETED');
CREATE TYPE "foodprint"."food_safety_inspection_conclusion" AS ENUM (
  'SUPPLIER_AT_FAULT',
  'SCHOOL_AT_FAULT',
  'MIXED_FAULT',
  'NOT_FOOD_RELATED',
  'INCONCLUSIVE'
);
CREATE TYPE "foodprint"."food_safety_supplier_finding" AS ENUM ('AT_FAULT', 'CLEARED', 'INCONCLUSIVE');

CREATE TABLE "foodprint"."food_safety_inspections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "team_description" TEXT NOT NULL,
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "foodprint"."food_safety_inspection_status" NOT NULL DEFAULT 'PLANNED',
    "result_summary" TEXT,
    "overall_conclusion" "foodprint"."food_safety_inspection_conclusion",
    "recorded_by_user_id" UUID,
    "completed_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_safety_inspections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "food_safety_inspections_team_description" CHECK (length(btrim("team_description")) > 0),
    -- PLANNED ⇒ chưa có kết quả; COMPLETED ⇒ đủ 4 cột kết quả.
    CONSTRAINT "food_safety_inspections_result" CHECK (
      CASE "status"
        WHEN 'PLANNED' THEN "result_summary" IS NULL AND "overall_conclusion" IS NULL
          AND "recorded_by_user_id" IS NULL AND "completed_at" IS NULL
        ELSE "result_summary" IS NOT NULL AND length(btrim("result_summary")) > 0
          AND "overall_conclusion" IS NOT NULL AND "recorded_by_user_id" IS NOT NULL
          AND "completed_at" IS NOT NULL
      END
    )
);

CREATE UNIQUE INDEX "food_safety_inspections_incident_id_id_key" ON "foodprint"."food_safety_inspections"("incident_id", "id");
CREATE INDEX "idx_food_safety_inspections_incident" ON "foodprint"."food_safety_inspections"("incident_id", "status");

ALTER TABLE "foodprint"."food_safety_inspections"
  ADD CONSTRAINT "food_safety_inspections_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "foodprint"."food_safety_incidents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_inspections_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_inspections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "foodprint"."food_safety_inspection_supplier_findings" (
    "inspection_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "finding" "foodprint"."food_safety_supplier_finding" NOT NULL,
    "evidence_note" TEXT,

    CONSTRAINT "food_safety_inspection_supplier_findings_pkey" PRIMARY KEY ("inspection_id", "supplier_id")
);

CREATE INDEX "idx_food_safety_inspection_findings_supplier" ON "foodprint"."food_safety_inspection_supplier_findings"("supplier_id", "finding");

ALTER TABLE "foodprint"."food_safety_inspection_supplier_findings"
  ADD CONSTRAINT "food_safety_inspection_supplier_findings_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "foodprint"."food_safety_inspections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_inspection_supplier_findings_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "foodprint"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
