-- dish-standard-portion (đợt dọn dẹp): dữ liệu cũ đã được chuyển sang mốc chuẩn + khẩu phần.
-- Điều kiện đã kiểm tra trước khi chạy: không còn món thiếu standard_quantity/standard_unit,
-- không còn dish_grade_recipes thiếu portion_quantity. Migration tự dừng nếu còn giá trị NULL.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "foodprint"."dishes"
             WHERE "standard_quantity" IS NULL OR "standard_unit" IS NULL) THEN
    RAISE EXCEPTION 'dishes còn món chưa có mốc chuẩn; hãy chuyển dữ liệu trước';
  END IF;
  IF EXISTS (SELECT 1 FROM "foodprint"."dish_grade_recipes" WHERE "portion_quantity" IS NULL) THEN
    RAISE EXCEPTION 'dish_grade_recipes còn khối chưa có khẩu phần; hãy chuyển dữ liệu trước';
  END IF;
END $$;

ALTER TABLE "foodprint"."dishes"
  ALTER COLUMN "standard_quantity" SET NOT NULL,
  ALTER COLUMN "standard_unit" SET NOT NULL,
  DROP CONSTRAINT "dishes_standard_pair_check",
  DROP CONSTRAINT "dishes_standard_quantity_check",
  DROP CONSTRAINT "dishes_standard_unit_check",
  ADD CONSTRAINT "dishes_standard_quantity_check" CHECK ("standard_quantity" > 0),
  ADD CONSTRAINT "dishes_standard_unit_check" CHECK ("standard_unit" IN ('g', 'ml'));

ALTER TABLE "foodprint"."dish_grade_recipes"
  ALTER COLUMN "portion_quantity" SET NOT NULL,
  DROP CONSTRAINT "dish_grade_recipes_portion_quantity_check",
  ADD CONSTRAINT "dish_grade_recipes_portion_quantity_check" CHECK ("portion_quantity" > 0);

DROP TABLE "foodprint"."dish_grade_recipe_lines";

COMMENT ON COLUMN "foodprint"."dish_ingredient_entries"."required_quantity" IS
  'Lượng nguyên liệu/gia vị trong mốc chuẩn của món. Dòng g/ml nhân theo khẩu phần khối; đơn vị đếm giữ nguyên.';
COMMIT;
