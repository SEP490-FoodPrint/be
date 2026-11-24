-- dish-standard-portion: mỗi món có một mốc chuẩn (g hoặc ml); khối chỉ khai báo khẩu phần.
-- Định lượng 1 suất của khối = dish_ingredient_entries.required_quantity × portion_quantity / standard_quantity.
-- Giai đoạn này CHƯA chuyển dữ liệu: cột mới nullable, không UPDATE/DELETE dữ liệu cũ,
-- giữ nguyên dish_grade_recipe_lines làm nguồn cho script chuyển dữ liệu sau.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE "foodprint"."dishes"
  ADD COLUMN "standard_quantity" DECIMAL(14,3) NULL,
  ADD COLUMN "standard_unit" VARCHAR(30) NULL,
  ADD CONSTRAINT "dishes_standard_quantity_check"
    CHECK ("standard_quantity" IS NULL OR "standard_quantity" > 0),
  ADD CONSTRAINT "dishes_standard_unit_check"
    CHECK ("standard_unit" IS NULL OR "standard_unit" IN ('g', 'ml')),
  ADD CONSTRAINT "dishes_standard_pair_check"
    CHECK (("standard_quantity" IS NULL) = ("standard_unit" IS NULL));

ALTER TABLE "foodprint"."dish_grade_recipes"
  ADD COLUMN "portion_quantity" DECIMAL(14,3) NULL,
  ADD CONSTRAINT "dish_grade_recipes_portion_quantity_check"
    CHECK ("portion_quantity" IS NULL OR "portion_quantity" > 0);

COMMENT ON COLUMN "foodprint"."dish_ingredient_entries"."required_quantity" IS
  'Lượng nguyên liệu/gia vị trong mốc chuẩn của món (dishes.standard_quantity).';
COMMENT ON TABLE "foodprint"."dish_grade_recipe_lines" IS
  'DEPRECATED (dish-standard-portion): BE không đọc/ghi nữa. Giữ làm nguồn chuyển dữ liệu; drop ở migration sau.';
COMMIT;
