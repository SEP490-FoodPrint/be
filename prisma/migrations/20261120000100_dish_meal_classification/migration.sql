BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Keep legacy dish classification unknown and preserve existing recipes/history.
-- This enum is separate from the meal_type enum used by menus and cooking.
CREATE TYPE "foodprint"."dish_meal_type" AS ENUM ('LUNCH', 'AFTERNOON', 'BOTH');

ALTER TABLE "foodprint"."dishes"
ADD COLUMN "meal_type" "foodprint"."dish_meal_type";

COMMIT;
