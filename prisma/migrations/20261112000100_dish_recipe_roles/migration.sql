-- Additive: unknown legacy classifications remain NULL for explicit review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE foodprint.dish_ingredient_entries
  ADD COLUMN ingredient_role varchar(12),
  ADD CONSTRAINT ck_dish_recipe_role CHECK (ingredient_role IN ('MAIN', 'SEASONING'));

COMMENT ON COLUMN foodprint.dish_ingredient_entries.ingredient_role IS
  'Per-dish recipe role MAIN or SEASONING; NULL means legacy line awaiting explicit review. Never infer from stock handling type.';
COMMIT;
