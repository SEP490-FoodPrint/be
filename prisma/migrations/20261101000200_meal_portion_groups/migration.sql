-- Expand only: no historical menus, demands, batches or stock are rewritten.
-- Legacy meals without groups retain their existing whole-meal calculation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE foodprint.menu_meal_portion_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_day_id uuid NOT NULL REFERENCES foodprint.menu_days(id) ON DELETE CASCADE,
  meal_type foodprint.meal_type NOT NULL,
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_portion_group_meal UNIQUE (id, menu_day_id, meal_type),
  CONSTRAINT uq_portion_group_name UNIQUE (menu_day_id, meal_type, name)
);
CREATE UNIQUE INDEX uq_menu_meal_default_group ON foodprint.menu_meal_portion_groups(menu_day_id,meal_type) WHERE is_default;

CREATE TABLE foodprint.menu_meal_portion_group_dishes (
  portion_group_id uuid NOT NULL,
  menu_day_id uuid NOT NULL,
  meal_type foodprint.meal_type NOT NULL,
  dish_id uuid NOT NULL,
  PRIMARY KEY (portion_group_id,dish_id),
  CONSTRAINT fk_portion_group_dish_group FOREIGN KEY (portion_group_id,menu_day_id,meal_type)
    REFERENCES foodprint.menu_meal_portion_groups(id,menu_day_id,meal_type) ON DELETE CASCADE,
  CONSTRAINT fk_portion_group_dish_menu FOREIGN KEY (menu_day_id,dish_id,meal_type)
    REFERENCES foodprint.menu_day_dishes(menu_day_id,dish_id,meal_type) ON DELETE RESTRICT
);
CREATE INDEX idx_portion_group_dish_meal ON foodprint.menu_meal_portion_group_dishes(menu_day_id,meal_type,dish_id);

CREATE TABLE foodprint.menu_meal_portion_group_avoidances (
  portion_group_id uuid NOT NULL REFERENCES foodprint.menu_meal_portion_groups(id) ON DELETE CASCADE,
  ingredient_entry_id uuid NOT NULL REFERENCES foodprint.ingredient_entries(id) ON DELETE RESTRICT,
  PRIMARY KEY (portion_group_id,ingredient_entry_id)
);
CREATE INDEX idx_portion_group_avoidance_entry ON foodprint.menu_meal_portion_group_avoidances(ingredient_entry_id);

CREATE TABLE foodprint.daily_meal_portion_groups (
  daily_meal_portion_id uuid NOT NULL REFERENCES foodprint.daily_meal_portions(id) ON DELETE RESTRICT,
  portion_group_id uuid NOT NULL REFERENCES foodprint.menu_meal_portion_groups(id) ON DELETE RESTRICT,
  portion_count integer NOT NULL CHECK (portion_count >= 0),
  confirmed_by_user_id uuid NOT NULL REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (daily_meal_portion_id,portion_group_id)
);
CREATE INDEX idx_daily_meal_portion_group ON foodprint.daily_meal_portion_groups(portion_group_id);
COMMIT;
