BEGIN;
-- Expand-only migration: preserve all existing quantities and unit text.
CREATE TABLE foodprint.measurement_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(30) NOT NULL UNIQUE,
 name varchar(100) NOT NULL, symbol varchar(30) NOT NULL UNIQUE, "group" varchar(10) NOT NULL,
 recommended_step numeric(14,3) NOT NULL, status foodprint.entity_status NOT NULL DEFAULT 'ACTIVE',
 created_at timestamptz(6) NOT NULL DEFAULT now(), updated_at timestamptz(6) NOT NULL DEFAULT now(),
 CONSTRAINT measurement_units_step_positive CHECK (recommended_step > 0),
 CONSTRAINT measurement_units_group CHECK ("group" IN ('MASS','VOLUME','COUNT','OTHER'))
);
CREATE TABLE foodprint.measurement_unit_aliases (
 alias varchar(30) PRIMARY KEY, unit_id uuid NOT NULL REFERENCES foodprint.measurement_units(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX measurement_unit_aliases_unit_id_idx ON foodprint.measurement_unit_aliases(unit_id);
ALTER TABLE foodprint.ingredients ADD COLUMN unit_id uuid;
ALTER TABLE foodprint.ingredients ADD CONSTRAINT ingredients_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES foodprint.measurement_units(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX ingredients_unit_id_idx ON foodprint.ingredients(unit_id);
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('kg','Kilôgam','kg','MASS',0.1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'kg',id FROM foodprint.measurement_units WHERE code='kg';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'kilogam',id FROM foodprint.measurement_units WHERE code='kg';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'kilogram',id FROM foodprint.measurement_units WHERE code='kg';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('g','Gam','g','MASS',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'g',id FROM foodprint.measurement_units WHERE code='g';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'gam',id FROM foodprint.measurement_units WHERE code='g';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'gram',id FROM foodprint.measurement_units WHERE code='g';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('mg','Miligam','mg','MASS',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'mg',id FROM foodprint.measurement_units WHERE code='mg';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'miligam',id FROM foodprint.measurement_units WHERE code='mg';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'milligram',id FROM foodprint.measurement_units WHERE code='mg';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('l','Lít','l','VOLUME',0.1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'l',id FROM foodprint.measurement_units WHERE code='l';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'lit',id FROM foodprint.measurement_units WHERE code='l';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'liter',id FROM foodprint.measurement_units WHERE code='l';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'litre',id FROM foodprint.measurement_units WHERE code='l';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'lít',id FROM foodprint.measurement_units WHERE code='l';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('ml','Mililít','ml','VOLUME',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'mililit',id FROM foodprint.measurement_units WHERE code='ml';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'mililít',id FROM foodprint.measurement_units WHERE code='ml';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'milliliter',id FROM foodprint.measurement_units WHERE code='ml';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'millilitre',id FROM foodprint.measurement_units WHERE code='ml';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'ml',id FROM foodprint.measurement_units WHERE code='ml';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('fruit','Quả','quả','COUNT',0.5);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'fruit',id FROM foodprint.measurement_units WHERE code='fruit';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'qua',id FROM foodprint.measurement_units WHERE code='fruit';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'quả',id FROM foodprint.measurement_units WHERE code='fruit';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('piece','Miếng','miếng','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'mieng',id FROM foodprint.measurement_units WHERE code='piece';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'miếng',id FROM foodprint.measurement_units WHERE code='piece';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'piece',id FROM foodprint.measurement_units WHERE code='piece';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('item','Cái','cái','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'cái',id FROM foodprint.measurement_units WHERE code='item';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'item',id FROM foodprint.measurement_units WHERE code='item';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('box','Hộp','hộp','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'box',id FROM foodprint.measurement_units WHERE code='box';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'hộp',id FROM foodprint.measurement_units WHERE code='box';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('bottle','Chai','chai','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'bottle',id FROM foodprint.measurement_units WHERE code='bottle';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'chai',id FROM foodprint.measurement_units WHERE code='bottle';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('portion','Phần','phần','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'phần',id FROM foodprint.measurement_units WHERE code='portion';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'portion',id FROM foodprint.measurement_units WHERE code='portion';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('serving','Suất','suất','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'serving',id FROM foodprint.measurement_units WHERE code='serving';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'suất',id FROM foodprint.measurement_units WHERE code='serving';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('pack','Gói','gói','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'gói',id FROM foodprint.measurement_units WHERE code='pack';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'pack',id FROM foodprint.measurement_units WHERE code='pack';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('bag','Túi','túi','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'bag',id FROM foodprint.measurement_units WHERE code='bag';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'túi',id FROM foodprint.measurement_units WHERE code='bag';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('tin','Lon','lon','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'tin',id FROM foodprint.measurement_units WHERE code='tin';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'lon',id FROM foodprint.measurement_units WHERE code='tin';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('jar','Hũ','hũ','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'hũ',id FROM foodprint.measurement_units WHERE code='jar';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'jar',id FROM foodprint.measurement_units WHERE code='jar';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('bundle','Bó','bó','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'bundle',id FROM foodprint.measurement_units WHERE code='bundle';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'bó',id FROM foodprint.measurement_units WHERE code='bundle';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('egg','Trứng','trứng','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'egg',id FROM foodprint.measurement_units WHERE code='egg';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'trứng',id FROM foodprint.measurement_units WHERE code='egg';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('root','Củ','củ','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'củ',id FROM foodprint.measurement_units WHERE code='root';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'root',id FROM foodprint.measurement_units WHERE code='root';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('cob','Bắp','bắp','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'bắp',id FROM foodprint.measurement_units WHERE code='cob';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'cob',id FROM foodprint.measurement_units WHERE code='cob';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('loaf','Ổ','ổ','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'loaf',id FROM foodprint.measurement_units WHERE code='loaf';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'ổ',id FROM foodprint.measurement_units WHERE code='loaf';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('animal','Con','con','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'animal',id FROM foodprint.measurement_units WHERE code='animal';
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT 'con',id FROM foodprint.measurement_units WHERE code='animal';
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step) VALUES ('canister','Can','can','COUNT',1),('slice','Lát','lát','COUNT',1);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT symbol,id FROM foodprint.measurement_units WHERE code IN ('canister','slice');
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id) SELECT code,id FROM foodprint.measurement_units WHERE code IN ('canister','slice');
WITH existing AS (SELECT DISTINCT lower(trim(normalize(unit,NFC))) AS value FROM (SELECT unit FROM foodprint.cooking_batch_lots UNION ALL SELECT unit FROM foodprint.delivery_items UNION ALL SELECT unit FROM foodprint.dish_ingredient_entries UNION ALL SELECT unit FROM foodprint.menu_day_dish_ingredients UNION ALL SELECT unit FROM foodprint.menu_meal_seasonings UNION ALL SELECT unit FROM foodprint.menu_meal_seasoning_lots UNION ALL SELECT unit FROM foodprint.ingredient_lots UNION ALL SELECT unit FROM foodprint.inventory_transactions UNION ALL SELECT unit FROM foodprint.supply_request_items UNION ALL SELECT unit FROM foodprint.dish_grade_recipe_lines UNION ALL SELECT unit FROM foodprint.meal_allocation_materials UNION ALL SELECT unit FROM foodprint.retained_food_samples UNION ALL SELECT default_unit AS unit FROM foodprint.ingredients) q WHERE unit IS NOT NULL AND trim(unit)<>'')
INSERT INTO foodprint.measurement_units(code,name,symbol,"group",recommended_step)
SELECT 'legacy_' || substr(md5(value),1,23),value,value,'OTHER',0.001 FROM existing e
WHERE NOT EXISTS (SELECT 1 FROM foodprint.measurement_unit_aliases a WHERE a.alias=e.value);
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id)
SELECT symbol,id FROM foodprint.measurement_units ON CONFLICT DO NOTHING;
INSERT INTO foodprint.measurement_unit_aliases(alias,unit_id)
SELECT code,id FROM foodprint.measurement_units ON CONFLICT DO NOTHING;
UPDATE foodprint.ingredients i SET unit_id=a.unit_id FROM foodprint.measurement_unit_aliases a
WHERE a.alias=lower(trim(normalize(i.default_unit,NFC)));

COMMIT;
