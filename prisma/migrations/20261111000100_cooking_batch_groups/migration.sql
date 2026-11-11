-- Expand/backfill without changing historical child IDs, codes, inventory or samples.
-- Deploy with the matching backend release; older writers lack required dish/group IDs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path TO foodprint, public;
LOCK TABLE cooking_batches, cooking_batch_lots, retained_food_samples, meal_allocation_batches IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE cooking_batch_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code varchar(100) NOT NULL UNIQUE,
  menu_day_id uuid NOT NULL REFERENCES menu_days(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  meal_type meal_type NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cooking_batch_groups_id_menu_day_id_meal_type_key ON cooking_batch_groups(id, menu_day_id, meal_type);
CREATE INDEX idx_cooking_batch_groups_meal ON cooking_batch_groups(menu_day_id, meal_type, created_at);
ALTER TABLE cooking_batches ADD COLUMN batch_group_id uuid;
INSERT INTO cooking_batch_groups(id, batch_code, menu_day_id, meal_type, created_by_user_id, created_at)
SELECT id, batch_code, menu_day_id, meal_type, created_by_user_id, created_at FROM cooking_batches;
-- Metadata-only backfill preserves the historical business timestamp explicitly.
UPDATE cooking_batches SET batch_group_id = id, updated_at = updated_at;
ALTER TABLE cooking_batches ALTER COLUMN batch_group_id SET NOT NULL;
CREATE UNIQUE INDEX cooking_batches_id_menu_day_id_meal_type_key ON cooking_batches(id, menu_day_id, meal_type);
ALTER TABLE cooking_batches ADD CONSTRAINT fk_cooking_batch_group
FOREIGN KEY(batch_group_id, menu_day_id, meal_type) REFERENCES cooking_batch_groups(id, menu_day_id, meal_type) ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE cooking_batch_dishes (
  cooking_batch_id uuid NOT NULL,
  dish_id uuid NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  menu_day_id uuid NOT NULL,
  meal_type meal_type NOT NULL,
  planned_portions integer CHECK (planned_portions IS NULL OR planned_portions >= 0),
  PRIMARY KEY(cooking_batch_id, dish_id),
  CONSTRAINT cooking_batch_dishes_cooking_batch_id_menu_day_id_meal_typ_fkey
    FOREIGN KEY(cooking_batch_id, menu_day_id, meal_type) REFERENCES cooking_batches(id, menu_day_id, meal_type) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT cooking_batch_dishes_menu_day_id_dish_id_meal_type_fkey
    FOREIGN KEY(menu_day_id, dish_id, meal_type) REFERENCES menu_day_dishes(menu_day_id, dish_id, meal_type) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX idx_cooking_batch_dishes_dish ON cooking_batch_dishes(dish_id);
-- Preserve NULL/zero legacy plans for operator reconciliation; never invent serving counts.
INSERT INTO cooking_batch_dishes(cooking_batch_id, dish_id, menu_day_id, meal_type, planned_portions)
SELECT id, dish_id, menu_day_id, meal_type, planned_portions FROM cooking_batches;

ALTER TABLE cooking_batch_lots ADD COLUMN dish_id uuid;
UPDATE cooking_batch_lots l SET dish_id = b.dish_id FROM cooking_batches b WHERE b.id = l.cooking_batch_id;
ALTER TABLE cooking_batch_lots ALTER COLUMN dish_id SET NOT NULL;
ALTER TABLE cooking_batch_lots DROP CONSTRAINT cooking_batch_lots_pkey;
ALTER TABLE cooking_batch_lots ADD PRIMARY KEY(cooking_batch_id, dish_id, ingredient_lot_id);
ALTER TABLE cooking_batch_lots ADD CONSTRAINT cooking_batch_lots_cooking_batch_id_dish_id_fkey
FOREIGN KEY(cooking_batch_id, dish_id) REFERENCES cooking_batch_dishes(cooking_batch_id, dish_id) ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE meal_allocation_batches ADD COLUMN dish_id uuid;
UPDATE meal_allocation_batches a SET dish_id = b.dish_id FROM cooking_batches b WHERE b.id = a.cooking_batch_id;
ALTER TABLE meal_allocation_batches ALTER COLUMN dish_id SET NOT NULL;
ALTER TABLE meal_allocation_batches DROP CONSTRAINT meal_allocation_batches_pkey;
ALTER TABLE meal_allocation_batches ADD PRIMARY KEY(meal_allocation_id, cooking_batch_id, dish_id);
ALTER TABLE meal_allocation_batches ADD CONSTRAINT meal_allocation_batches_cooking_batch_id_dish_id_fkey
FOREIGN KEY(cooking_batch_id, dish_id) REFERENCES cooking_batch_dishes(cooking_batch_id, dish_id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE retained_food_samples ADD COLUMN dish_id uuid;
UPDATE retained_food_samples s SET dish_id = b.dish_id, updated_at = s.updated_at FROM cooking_batches b WHERE b.id = s.cooking_batch_id;
ALTER TABLE retained_food_samples ALTER COLUMN dish_id SET NOT NULL;
ALTER TABLE retained_food_samples DROP CONSTRAINT retained_food_samples_cooking_batch_id_key;
CREATE UNIQUE INDEX retained_food_samples_cooking_batch_id_dish_id_key ON retained_food_samples(cooking_batch_id, dish_id);
ALTER TABLE retained_food_samples ADD CONSTRAINT retained_food_samples_cooking_batch_id_dish_id_fkey
FOREIGN KEY(cooking_batch_id, dish_id) REFERENCES cooking_batch_dishes(cooking_batch_id, dish_id) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- A grouped child has no single dish. The compatibility field remains for old single-dish children.
ALTER TABLE cooking_batches ALTER COLUMN dish_id DROP NOT NULL;
COMMIT;
