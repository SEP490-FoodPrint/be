-- TASK-08: mốc suất Đợt 1 theo khối cho yêu cầu nhập hàng tươi.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "foodprint"."supply_batch1_grade_portions" (
    "school_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "grade_id" UUID NOT NULL,
    "portions" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_batch1_grade_portions_pkey" PRIMARY KEY ("school_id", "delivery_date", "grade_id"),
    CONSTRAINT "supply_batch1_grade_portions_portions_check" CHECK ("portions" >= 0),
    CONSTRAINT "supply_batch1_grade_portions_grade_fkey" FOREIGN KEY ("school_id", "grade_id")
      REFERENCES "foodprint"."school_grades"("school_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

COMMIT;
