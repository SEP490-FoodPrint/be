BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE foodprint.school_dish_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES foodprint.schools(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  name VARCHAR(255) NOT NULL,
  CONSTRAINT school_dish_categories_id_school_id_key UNIQUE (id, school_id),
  CONSTRAINT school_dish_categories_school_id_name_key UNIQUE (school_id, name)
);
ALTER TABLE foodprint.dishes ADD COLUMN category_id UUID;
INSERT INTO foodprint.school_dish_categories (school_id, name)
SELECT school.id, category.name FROM foodprint.schools AS school
CROSS JOIN (VALUES ('Cơm / Tinh bột'), ('Món mặn chính'), ('Món rau / xào'), ('Món canh'), ('Món phụ / Tráng miệng')) AS category(name);
UPDATE foodprint.dishes AS dish
SET category_id = category.id, updated_at = dish.updated_at
FROM foodprint.school_dish_categories AS category
WHERE category.school_id = dish.school_id AND category.name = CASE dish.category::text
  WHEN 'RICE_STARCH' THEN 'Cơm / Tinh bột'
  WHEN 'MAIN_DISH' THEN 'Món mặn chính'
  WHEN 'VEGETABLE' THEN 'Món rau / xào'
  WHEN 'SOUP' THEN 'Món canh'
  WHEN 'DESSERT' THEN 'Món phụ / Tráng miệng'
END;
ALTER TABLE foodprint.dishes ADD CONSTRAINT dishes_category_id_school_id_fkey
  FOREIGN KEY (category_id, school_id) REFERENCES foodprint.school_dish_categories(id, school_id)
  ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX dishes_category_id_school_id_idx ON foodprint.dishes(category_id, school_id);
COMMIT;
