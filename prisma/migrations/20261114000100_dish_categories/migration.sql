-- Additive schema change; old application versions may continue omitting category.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

CREATE TYPE foodprint.dish_category AS ENUM (
  'RICE_STARCH', 'MAIN_DISH', 'VEGETABLE', 'SOUP', 'DESSERT'
);
ALTER TABLE foodprint.dishes ADD COLUMN category foodprint.dish_category;
COMMENT ON COLUMN foodprint.dishes.category IS
  'Explicit dish group selected by nutrition staff. NULL means not classified. Independent of meal type and recipe ingredient roles.';

-- Reviewed legacy records from read-only Azure inspection on 2026-11-13.
-- Never classify future dishes by name patterns or overwrite a staff classification.
-- The expected-name guard leaves renamed/missing records untouched.
UPDATE foodprint.dishes AS dish
SET category = reviewed.category::foodprint.dish_category
FROM (VALUES
  ('00000056-0000-4000-8000-000000000001'::uuid, 'Thịt kho trứng', 'MAIN_DISH'),
  ('00000056-0000-4000-8000-000000000002'::uuid, 'Rau cải xào tỏi', 'VEGETABLE'),
  ('00000056-0000-4000-8000-000000000003'::uuid, 'Canh bí đỏ thịt băm', 'SOUP'),
  ('00000056-0000-4000-8000-000000000004'::uuid, 'Cơm gạo ST25', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000005'::uuid, 'Chuối tiêu tráng miệng', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000006'::uuid, 'Súp gà ngô non', 'SOUP'),
  ('00000056-0000-4000-8000-000000000007'::uuid, 'Sữa chua học đường', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000008'::uuid, 'Gà rim gừng', 'MAIN_DISH'),
  ('00000056-0000-4000-8000-000000000009'::uuid, 'Rau cải luộc', 'VEGETABLE'),
  ('00000056-0000-4000-8000-000000000010'::uuid, 'Canh bí đỏ hầm', 'SOUP'),
  ('00000056-0000-4000-8000-000000000011'::uuid, 'Cơm trắng ST25', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000012'::uuid, 'Cam ngọt tráng miệng', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000013'::uuid, 'Bánh bao nhân thịt', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000014'::uuid, 'Sữa tươi tiệt trùng', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000015'::uuid, 'Cá basa sốt cà chua', 'MAIN_DISH'),
  ('00000056-0000-4000-8000-000000000016'::uuid, 'Rau cải xào', 'VEGETABLE'),
  ('00000056-0000-4000-8000-000000000017'::uuid, 'Canh bí đỏ', 'SOUP'),
  ('00000056-0000-4000-8000-000000000018'::uuid, 'Cơm gạo ST25 dẻo', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000019'::uuid, 'Chuối tiêu hồng', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000020'::uuid, 'Cháo gà rau củ', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000021'::uuid, 'Sữa chua ít đường', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000022'::uuid, 'Tôm rim nhạt', 'MAIN_DISH'),
  ('00000056-0000-4000-8000-000000000023'::uuid, 'Bí đỏ xào thịt', 'VEGETABLE'),
  ('00000056-0000-4000-8000-000000000024'::uuid, 'Canh rau cải', 'SOUP'),
  ('00000056-0000-4000-8000-000000000025'::uuid, 'Cơm trắng', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000026'::uuid, 'Cam ngọt', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000027'::uuid, 'Bánh bao hấp', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000028'::uuid, 'Sữa tươi học đường', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000029'::uuid, 'Thịt lợn rang mềm', 'MAIN_DISH'),
  ('00000056-0000-4000-8000-000000000030'::uuid, 'Rau cải xào thịt', 'VEGETABLE'),
  ('00000056-0000-4000-8000-000000000031'::uuid, 'Canh chua cá basa', 'SOUP'),
  ('00000056-0000-4000-8000-000000000032'::uuid, 'Cơm ST25', 'RICE_STARCH'),
  ('00000056-0000-4000-8000-000000000033'::uuid, 'Chuối tráng miệng', 'DESSERT'),
  ('00000056-0000-4000-8000-000000000034'::uuid, 'Súp tôm bí đỏ', 'SOUP'),
  ('00000056-0000-4000-8000-000000000035'::uuid, 'Sữa chua', 'DESSERT'),
  ('d616b708-fa29-5dd9-a7d7-7ee09ead8c80'::uuid, 'Cơm rau củ (DEMO)', 'RICE_STARCH'),
  ('9c602f37-cbce-5bae-9b93-d2fd73dc74f8'::uuid, 'Cơm trắng (DEMO)', 'RICE_STARCH'),
  ('5fbb77f6-08a2-5203-85c1-4fc24039b506'::uuid, 'Cháo gạo (DEMO)', 'RICE_STARCH'),
  ('69d5f1e9-f6bb-506e-84ba-4e0785bc713a'::uuid, 'Canh cà rốt (DEMO)', 'SOUP'),
  ('5ac68d25-d414-4798-80c4-5d9aee3567de'::uuid, 'Cơm trắng gạo Tẻ thơm', 'RICE_STARCH'),
  ('c849ffe3-b882-490c-8b57-073ee0f0007d'::uuid, 'Thịt gà kho gừng', 'MAIN_DISH'),
  ('e7c7e25a-7b56-4e91-a637-f447ddd22834'::uuid, 'Thịt heo kho nước dừa (DEMO)', 'MAIN_DISH'),
  ('e7c7e25a-7b56-4e91-a637-f447ddd22835'::uuid, 'Rau muống xào tỏi (DEMO)', 'VEGETABLE'),
  ('e7c7e25a-7b56-4e91-a637-f447ddd22836'::uuid, 'Sữa chua Ba Vì (DEMO)', 'DESSERT'),
  ('e7c7e25a-7b56-4e91-a637-f447ddd22837'::uuid, 'Chuối tiêu tráng miệng (DEMO)', 'DESSERT')
) AS reviewed(id, expected_name, category)
WHERE dish.id = reviewed.id AND dish.name = reviewed.expected_name AND dish.category IS NULL;

-- Generic "Món có đậu phộng" is intentionally not assigned a guessed group.
COMMIT;
