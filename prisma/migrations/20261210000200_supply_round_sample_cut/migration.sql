-- TASK-10 v8 (.task_specs/TASK-10-v8-sample-cut-batch2-compensation.plan.md mục 20, 23).
-- Expand-only: thêm bảng/cột (có mặc định hoặc cho NULL), nới CHECK và mở rộng kiểu
-- planned_portions từ integer sang numeric(20,2) (mọi giá trị cũ giữ nguyên). Không UPDATE/DELETE dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path TO foodprint, public;

-- V23/V26: mẻ chia theo nguyên liệu, số suất của mẻ có thể lẻ (phân bổ đã dùng numeric(20,2)).
ALTER TABLE cooking_batches
  ALTER COLUMN planned_portions TYPE numeric(20,2) USING planned_portions::numeric(20,2);
ALTER TABLE cooking_batch_dishes
  ALTER COLUMN planned_portions TYPE numeric(20,2) USING planned_portions::numeric(20,2);
ALTER TABLE cooking_batch_round_parts
  ALTER COLUMN planned_portions TYPE numeric(20,2) USING planned_portions::numeric(20,2);
-- Phần Đợt 2 có thể chỉ mang nguyên liệu (phần lẻ/phần bù) mà không thêm suất.
ALTER TABLE cooking_batch_round_parts
  DROP CONSTRAINT IF EXISTS cooking_batch_round_parts_planned_portions_check,
  ADD CONSTRAINT cooking_batch_round_parts_planned_portions_check CHECK (planned_portions >= 0 AND planned_portions <> 'NaN'::numeric);

-- Cách lấy phần lưu mẫu của mẻ theo đợt (NULL cho mẻ thủ công/cũ).
ALTER TABLE cooking_batches
  ADD COLUMN sample_strategy sample_strategy;

-- Nấu chung: phần mẫu đặt ở Đợt 2, gán khi phần Đợt 2 gộp vào mẻ.
ALTER TABLE cooking_batch_round_part_lots
  ADD COLUMN sample_quantity numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE cooking_batch_round_part_lots
  DROP CONSTRAINT IF EXISTS cooking_batch_round_part_lots_quantity_used_check,
  ADD CONSTRAINT cooking_batch_round_part_lots_quantity_used_check CHECK (
    quantity_used >= 0 AND quantity_used <> 'NaN'::numeric AND (quantity_used > 0 OR sample_quantity > 0)
  ),
  ADD CONSTRAINT cooking_batch_round_part_lots_sample_quantity_check CHECK (sample_quantity >= 0 AND sample_quantity <> 'NaN'::numeric);

-- V4: dòng tách chỉ để kho xem; requested_quantity vẫn là tổng NCC thấy.
ALTER TABLE supply_request_items
  ADD COLUMN carry_over_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN sample_compensation_quantity numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE supply_request_items
  ADD CONSTRAINT supply_request_items_carry_over_quantity_check CHECK (carry_over_quantity >= 0 AND carry_over_quantity <> 'NaN'::numeric),
  ADD CONSTRAINT supply_request_items_sample_compensation_quantity_check CHECK (sample_compensation_quantity >= 0 AND sample_compensation_quantity <> 'NaN'::numeric);

-- V1: phần lưu mẫu đã cắt ở Đợt 1, theo nguyên liệu, để bù ở Đợt 2.
CREATE TABLE supply_round_compensations (
  supply_round_id uuid NOT NULL REFERENCES supply_rounds(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  ingredient_entry_id uuid NOT NULL REFERENCES ingredient_entries(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  kind supply_compensation_kind NOT NULL,
  sample_quantity numeric(14,3) NOT NULL CHECK (sample_quantity > 0 AND sample_quantity <> 'NaN'::numeric),
  unit varchar(30) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (supply_round_id, ingredient_entry_id)
);

-- V35: phần lô Đợt 1 không ghép được (lệch tỉ lệ), giữ cho Đợt 2 của cùng món/bữa.
CREATE TABLE supply_round_leftovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_round_id uuid NOT NULL REFERENCES supply_rounds(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  menu_day_id uuid NOT NULL REFERENCES menu_days(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  meal_type meal_type NOT NULL,
  dish_id uuid NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ingredient_lot_id uuid NOT NULL REFERENCES ingredient_lots(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  unit varchar(30) NOT NULL,
  released_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX idx_supply_round_leftovers_round ON supply_round_leftovers(supply_round_id);
CREATE INDEX idx_supply_round_leftovers_lot ON supply_round_leftovers(ingredient_lot_id);

COMMIT;
