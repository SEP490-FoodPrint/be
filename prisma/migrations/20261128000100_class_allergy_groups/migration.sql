-- Class allergies become numbered groups: each group is a set of ingredients and one student count
-- (e.g. group 1 = {A}: 1 student, group 2 = {B}: 1, group 3 = {A, B}: 1 -> 3 allergic students).
-- Existing data used one shared list with one shared count, so every existing row becomes group 1.
-- Daily allergy portions keep their own snapshot of the group composition for that meal and reference
-- ingredient_entries directly, so editing a class's groups never rewrites or blocks past declarations.
BEGIN;

ALTER TABLE foodprint.daily_allergy_portions
  DROP CONSTRAINT fk_daily_allergy_class_entry;

ALTER TABLE foodprint.class_allergies
  ADD COLUMN group_no smallint NOT NULL DEFAULT 1
    CONSTRAINT class_allergies_group_no_check CHECK (group_no BETWEEN 1 AND 50);
ALTER TABLE foodprint.class_allergies ALTER COLUMN group_no DROP DEFAULT;
ALTER TABLE foodprint.class_allergies DROP CONSTRAINT class_allergies_pkey;
ALTER TABLE foodprint.class_allergies
  ADD CONSTRAINT class_allergies_pkey PRIMARY KEY (class_id, group_no, ingredient_entry_id);
CREATE INDEX idx_class_allergies_ingredient_entry
  ON foodprint.class_allergies (ingredient_entry_id);

ALTER TABLE foodprint.daily_allergy_portions
  ADD COLUMN group_no smallint NOT NULL DEFAULT 1
    CONSTRAINT daily_allergy_portions_group_no_check CHECK (group_no BETWEEN 1 AND 50);
ALTER TABLE foodprint.daily_allergy_portions ALTER COLUMN group_no DROP DEFAULT;
ALTER TABLE foodprint.daily_allergy_portions DROP CONSTRAINT daily_allergy_portions_pkey;
ALTER TABLE foodprint.daily_allergy_portions
  ADD CONSTRAINT daily_allergy_portions_pkey
    PRIMARY KEY (daily_meal_portion_id, class_id, group_no, ingredient_entry_id);
ALTER TABLE foodprint.daily_allergy_portions
  ADD CONSTRAINT fk_daily_allergy_ingredient_entry
    FOREIGN KEY (ingredient_entry_id) REFERENCES foodprint.ingredient_entries(id) ON DELETE RESTRICT;
DROP INDEX IF EXISTS foodprint.idx_daily_allergy_portions_class_entry;
CREATE INDEX idx_daily_allergy_portions_class_entry
  ON foodprint.daily_allergy_portions (class_id, ingredient_entry_id);

COMMENT ON TABLE foodprint.class_allergies IS
'Class allergy groups. Rows sharing (class_id, group_no) form one group: the set of ingredients a group of students must avoid together, with affected_count = number of students in that group (same on every row of the group). No Student entity.';
COMMENT ON TABLE foodprint.daily_allergy_portions IS
'Daily allergy portions per class allergy group for one DailyMealPortion. Rows sharing group_no snapshot the group composition that day; portion_count is the number of portions for that group (same on every row of the group).';

COMMIT;
