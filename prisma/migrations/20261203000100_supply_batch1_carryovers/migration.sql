-- Phần lẻ Đợt 1 (làm tròn xuống) chuyển sang Đợt 2 cùng ngày, theo nguyên liệu trong danh mục trường.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "foodprint"."supply_batch1_carryovers" (
    "school_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "ingredient_entry_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supply_batch1_carryovers_pkey" PRIMARY KEY ("school_id", "delivery_date", "ingredient_entry_id"),
    CONSTRAINT "supply_batch1_carryovers_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "supply_batch1_carryovers_entry_fkey" FOREIGN KEY ("ingredient_entry_id")
      REFERENCES "foodprint"."ingredient_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

COMMIT;
