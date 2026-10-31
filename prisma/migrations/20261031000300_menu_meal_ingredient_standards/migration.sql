-- Additive expansion. Existing recipes/batches/history are never rewritten.
-- Do not infer historical approved standards from today's mutable dish template.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE foodprint.menu_day_dish_ingredients (
  menu_day_id uuid NOT NULL,
  dish_id uuid NOT NULL,
  meal_type foodprint.meal_type NOT NULL,
  ingredient_id uuid NOT NULL,
  quantity_per_portion numeric(14,3) NOT NULL CHECK (quantity_per_portion > 0 AND quantity_per_portion <> 'NaN'::numeric),
  unit varchar(30) NOT NULL CHECK (length(btrim(unit)) > 0),
  PRIMARY KEY (menu_day_id, dish_id, meal_type, ingredient_id),
  CONSTRAINT fk_menu_dish_ingredient_menu_dish FOREIGN KEY (menu_day_id, dish_id, meal_type)
    REFERENCES foodprint.menu_day_dishes(menu_day_id, dish_id, meal_type) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_menu_dish_ingredient_ingredient FOREIGN KEY (ingredient_id)
    REFERENCES foodprint.ingredients(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX idx_menu_dish_ingredient_ingredient ON foodprint.menu_day_dish_ingredients(ingredient_id);
CREATE TABLE foodprint.menu_meal_seasonings (
  menu_day_id uuid NOT NULL,
  meal_type foodprint.meal_type NOT NULL,
  ingredient_entry_id uuid NOT NULL,
  quantity_per_portion numeric(14,3) NOT NULL CHECK (quantity_per_portion > 0 AND quantity_per_portion <> 'NaN'::numeric),
  unit varchar(30) NOT NULL CHECK (length(btrim(unit)) > 0),
  PRIMARY KEY (menu_day_id, meal_type, ingredient_entry_id),
  CONSTRAINT fk_menu_meal_seasoning_menu_day FOREIGN KEY (menu_day_id)
    REFERENCES foodprint.menu_days(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_menu_meal_seasoning_entry FOREIGN KEY (ingredient_entry_id)
    REFERENCES foodprint.ingredient_entries(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX idx_menu_meal_seasoning_entry ON foodprint.menu_meal_seasonings(ingredient_entry_id);
CREATE TABLE foodprint.menu_meal_seasoning_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_day_id uuid NOT NULL,
  meal_type foodprint.meal_type NOT NULL,
  ingredient_entry_id uuid NOT NULL,
  ingredient_lot_id uuid NOT NULL,
  planned_portions integer NOT NULL CHECK (planned_portions > 0),
  quantity_used numeric(14,3) NOT NULL CHECK (quantity_used > 0 AND quantity_used <> 'NaN'::numeric),
  unit varchar(30) NOT NULL CHECK (length(btrim(unit)) > 0),
  used_at timestamptz,
  CONSTRAINT fk_menu_meal_seasoning_lot_standard FOREIGN KEY (menu_day_id, meal_type, ingredient_entry_id)
    REFERENCES foodprint.menu_meal_seasonings(menu_day_id, meal_type, ingredient_entry_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT fk_menu_meal_seasoning_lot_lot FOREIGN KEY (ingredient_lot_id)
    REFERENCES foodprint.ingredient_lots(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT uq_menu_meal_seasoning_lot UNIQUE (menu_day_id, meal_type, ingredient_entry_id, ingredient_lot_id)
);
CREATE INDEX idx_menu_meal_seasoning_lot_reserved ON foodprint.menu_meal_seasoning_lots(ingredient_lot_id, used_at);
CREATE UNIQUE INDEX uq_inventory_meal_seasoning_usage ON foodprint.inventory_transactions(reference_id)
  WHERE movement_type = 'COOKING_USAGE' AND reference_type = 'MENU_MEAL_SEASONING';
COMMENT ON TABLE foodprint.menu_day_dish_ingredients IS 'Fixed per-serving main ingredients for each menu-day/dish/meal occurrence; dish_ingredient_entries remains a template.';
COMMENT ON TABLE foodprint.menu_meal_seasonings IS 'Fixed per-serving seasonings for the entire meal, independent of dish count.';
COMMENT ON TABLE foodprint.menu_meal_seasoning_lots IS 'Shared meal seasoning lot reservations; quantity_used is planned, used_at marks inventory consumption after all meal batches complete.';
COMMIT;
