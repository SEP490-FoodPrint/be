BEGIN;

CREATE TABLE foodprint.ingredient_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category_name varchar(120) NOT NULL,
  category_description text,
  CONSTRAINT ingredient_categories_pkey PRIMARY KEY (id),
  CONSTRAINT chk_ingredient_category_name CHECK (category_name ~ '[^[:space:]]')
);

ALTER TABLE foodprint.ingredients
  ADD COLUMN category_id uuid,
  ADD COLUMN cover_image text,
  ADD COLUMN image_description text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD CONSTRAINT chk_ingredient_images_not_null CHECK (array_position(image_description, NULL) IS NULL);

INSERT INTO foodprint.ingredient_categories (category_name)
SELECT DISTINCT category FROM foodprint.ingredients
WHERE category ~ '[^[:space:]]';

UPDATE foodprint.ingredients i
SET category_id = c.id
FROM foodprint.ingredient_categories c
WHERE i.category = c.category_name;

-- Assert the backfill before dropping its source; no persistent function/trigger.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM foodprint.ingredients i
    LEFT JOIN foodprint.ingredient_categories c ON c.id = i.category_id
    WHERE i.category ~ '[^[:space:]]'
      AND (c.id IS NULL OR c.category_name IS DISTINCT FROM i.category)
  ) THEN
    RAISE EXCEPTION 'Ingredient category backfill incomplete';
  END IF;
END $$;

ALTER TABLE foodprint.ingredients
  ADD CONSTRAINT fk_ingredients_category FOREIGN KEY (category_id)
    REFERENCES foodprint.ingredient_categories(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  DROP COLUMN category;

CREATE INDEX idx_ingredients_category_id ON foodprint.ingredients(category_id);
COMMIT;
