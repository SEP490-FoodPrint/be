-- Bỏ "bước khuyến nghị" của đơn vị đo: số lượng nhập không còn bị gợi ý/làm tròn theo bước.
BEGIN;
ALTER TABLE foodprint.measurement_units DROP CONSTRAINT IF EXISTS measurement_units_step_positive;
ALTER TABLE foodprint.measurement_units DROP COLUMN recommended_step;
COMMIT;
