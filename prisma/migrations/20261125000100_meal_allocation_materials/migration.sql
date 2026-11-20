BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE foodprint.cooking_batch_dishes ADD COLUMN allocation_recipe_snapshot jsonb;
ALTER TABLE foodprint.meal_allocation_batches
  ALTER COLUMN allocated_portions TYPE numeric(20,2) USING allocated_portions::numeric(20,2),
  ADD COLUMN allocation_version integer NOT NULL DEFAULT 1,
  ADD COLUMN theoretical_portions numeric(24,12),
  DROP CONSTRAINT meal_allocation_batches_allocated_portions_check;
ALTER TABLE foodprint.meal_allocation_batches ADD CONSTRAINT meal_allocation_batches_allocated_portions_check CHECK (
 (allocation_version = 1 AND allocated_portions > 0) OR
 (allocation_version = 2 AND allocated_portions >= 0 AND theoretical_portions > 0));
CREATE TABLE foodprint.meal_allocation_materials (
 meal_allocation_id uuid NOT NULL, cooking_batch_id uuid NOT NULL, dish_id uuid NOT NULL,
 ingredient_lot_id uuid NOT NULL, ingredient_id uuid NOT NULL,
 quantity numeric(24,9) NOT NULL CHECK(quantity > 0),
 quantity_per_portion numeric(24,9) NOT NULL CHECK(quantity_per_portion > 0), unit varchar(30) NOT NULL,
 PRIMARY KEY(meal_allocation_id,cooking_batch_id,dish_id,ingredient_lot_id),
 FOREIGN KEY(meal_allocation_id,cooking_batch_id,dish_id) REFERENCES foodprint.meal_allocation_batches(meal_allocation_id,cooking_batch_id,dish_id) ON DELETE CASCADE,
 FOREIGN KEY(cooking_batch_id,dish_id,ingredient_lot_id) REFERENCES foodprint.cooking_batch_lots(cooking_batch_id,dish_id,ingredient_lot_id) ON DELETE RESTRICT
);
COMMIT;
