-- C05: khiếu nại leo thang lên ATTP (specs/authority-complaints).
-- Thêm địa bàn phường/xã cho đơn vị ATTP (Q10) và bảng con `authority_complaints`.
-- Bảng cha `complaints` đã có CHECK mã `FP-AC-%` cho kind AUTHORITY và `ESCALATED` chỉ cho MEAL từ PR1.
-- Không có function/trigger; cấp phường/xã của Location và luồng ticket do backend kiểm soát.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "foodprint"."commune_food_safety_units" ADD COLUMN "location_id" UUID;

ALTER TABLE "foodprint"."commune_food_safety_units"
  ADD CONSTRAINT "commune_food_safety_units_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "foodprint"."locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Mỗi phường/xã gắn tối đa một đơn vị ATTP.
CREATE UNIQUE INDEX "uq_commune_food_safety_units_location_id" ON "foodprint"."commune_food_safety_units"("location_id") WHERE "location_id" IS NOT NULL;

CREATE TABLE "foodprint"."authority_complaints" (
    "id" UUID NOT NULL,
    "kind" "foodprint"."complaint_kind" NOT NULL DEFAULT 'AUTHORITY',
    "school_id" UUID NOT NULL,
    "recipient_commune_food_safety_unit_id" UUID NOT NULL,
    "escalated_from_meal_complaint_id" UUID NOT NULL,

    CONSTRAINT "authority_complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authority_complaints_kind" CHECK ("kind" = 'AUTHORITY')
);

-- Prisma cần unique (id, kind) cho quan hệ 1-1 với bảng cha.
CREATE UNIQUE INDEX "uq_authority_complaints_id_kind" ON "foodprint"."authority_complaints"("id", "kind");
-- Mỗi C03 sinh tối đa một C05.
CREATE UNIQUE INDEX "uq_authority_complaints_escalated_from" ON "foodprint"."authority_complaints"("escalated_from_meal_complaint_id");
CREATE INDEX "idx_authority_complaints_school" ON "foodprint"."authority_complaints"("school_id");
CREATE INDEX "idx_authority_complaints_recipient" ON "foodprint"."authority_complaints"("recipient_commune_food_safety_unit_id");

ALTER TABLE "foodprint"."authority_complaints"
  ADD CONSTRAINT "authority_complaints_id_kind_fkey" FOREIGN KEY ("id", "kind") REFERENCES "foodprint"."complaints"("id", "kind") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "foodprint"."authority_complaints"
  ADD CONSTRAINT "authority_complaints_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "foodprint"."schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "foodprint"."authority_complaints"
  ADD CONSTRAINT "authority_complaints_recipient_unit_fkey" FOREIGN KEY ("recipient_commune_food_safety_unit_id") REFERENCES "foodprint"."commune_food_safety_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "foodprint"."authority_complaints"
  ADD CONSTRAINT "authority_complaints_escalated_from_fkey" FOREIGN KEY ("escalated_from_meal_complaint_id") REFERENCES "foodprint"."meal_complaints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
