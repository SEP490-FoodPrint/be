-- supply-round-sample-planning (PR1, phần bảng/cột) — spec specs/supply-round-sample-planning/spec.md mục 10.
-- Expand-only: chỉ thêm bảng/cột (cột mới có mặc định hoặc cho NULL), đổi một CHECK theo điều kiện
-- rộng hơn và thay partial unique của chuyến giao REQUEST. Không UPDATE/DELETE dữ liệu cũ.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path TO foodprint, public;

-- 10.1 Cấu hình lưu mẫu của trường. Không có dòng nghĩa là dùng mặc định 100 g / 150 ml trong code.
CREATE TABLE school_sample_policies (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  sample_grams numeric(14,3) NOT NULL CHECK (sample_grams > 0 AND sample_grams <> 'NaN'::numeric),
  sample_milliliters numeric(14,3) NOT NULL CHECK (sample_milliliters > 0 AND sample_milliliters <> 'NaN'::numeric),
  updated_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

-- 10.2 Đợt giao (trường, ngày, đợt 1|2).
CREATE TABLE supply_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  delivery_date date NOT NULL,
  batch_no smallint NOT NULL CHECK (batch_no IN (1, 2)),
  status supply_round_status NOT NULL DEFAULT 'COLLECTING',
  not_needed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT supply_rounds_not_needed_check CHECK (
    (status = 'NOT_NEEDED') = (not_needed_at IS NOT NULL) AND (status <> 'NOT_NEEDED' OR batch_no = 2)
  )
);
CREATE UNIQUE INDEX uq_supply_rounds_school_date_batch ON supply_rounds(school_id, delivery_date, batch_no);

-- 10.3 Kế hoạch theo món trong một đợt.
CREATE TABLE supply_round_dish_plans (
  supply_round_id uuid NOT NULL REFERENCES supply_rounds(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  dish_id uuid NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  status dish_plan_status NOT NULL DEFAULT 'WAITING_SUPPLIERS',
  plan_version varchar(64),
  failure_message text,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  approved_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (supply_round_id, dish_id),
  CONSTRAINT supply_round_dish_plans_approved_check CHECK ((approved_by_user_id IS NULL) = (approved_at IS NULL))
);
CREATE INDEX idx_supply_round_dish_plans_dish ON supply_round_dish_plans(dish_id);

-- 10.4 Mẻ.
ALTER TABLE cooking_batches
  ADD COLUMN supply_batch_no smallint,
  ADD CONSTRAINT cooking_batches_supply_batch_no_check CHECK (supply_batch_no IS NULL OR supply_batch_no IN (1, 2));

ALTER TABLE cooking_batch_groups
  ADD COLUMN supply_round_id uuid REFERENCES supply_rounds(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX idx_cooking_batch_groups_supply_round ON cooking_batch_groups(supply_round_id);

ALTER TABLE cooking_batch_dishes
  ADD COLUMN sample_quantity numeric(14,3),
  ADD COLUMN sample_ratio numeric(18,9),
  ADD COLUMN sample_unit varchar(30),
  ADD COLUMN standard_quantity_snapshot numeric(14,3),
  ADD CONSTRAINT cooking_batch_dishes_sample_snapshot_check CHECK (
    (sample_quantity IS NULL AND sample_ratio IS NULL AND sample_unit IS NULL AND standard_quantity_snapshot IS NULL)
    OR (sample_quantity > 0 AND sample_ratio > 0 AND sample_unit IN ('g', 'ml') AND standard_quantity_snapshot > 0)
  );

ALTER TABLE cooking_batch_lots
  ADD COLUMN sample_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT cooking_batch_lots_sample_quantity_check CHECK (sample_quantity >= 0 AND sample_quantity <> 'NaN'::numeric),
  DROP CONSTRAINT cooking_batch_lots_quantity_used_check,
  ADD CONSTRAINT cooking_batch_lots_quantity_used_check CHECK (quantity_used >= 0 AND (quantity_used > 0 OR sample_quantity > 0));

ALTER TABLE menu_meal_seasoning_lots
  ADD COLUMN sample_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT menu_meal_seasoning_lots_sample_quantity_check CHECK (sample_quantity >= 0 AND sample_quantity <> 'NaN'::numeric);

-- Phần Đợt 2 gộp vào mẻ Đợt 1, lưu riêng tới khi mẻ lên chính thức (spec 8.2).
CREATE TABLE cooking_batch_round_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cooking_batch_id uuid NOT NULL,
  dish_id uuid NOT NULL,
  supply_round_id uuid NOT NULL REFERENCES supply_rounds(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  planned_portions integer NOT NULL CHECK (planned_portions > 0),
  status round_part_status NOT NULL DEFAULT 'PENDING_APPROVAL',
  approved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  approved_at timestamptz(6),
  merged_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT fk_cooking_batch_round_parts_dish FOREIGN KEY (cooking_batch_id, dish_id)
    REFERENCES cooking_batch_dishes(cooking_batch_id, dish_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT cooking_batch_round_parts_approved_check CHECK ((approved_by_user_id IS NULL) = (approved_at IS NULL)),
  CONSTRAINT cooking_batch_round_parts_status_check CHECK (
    (status = 'PENDING_APPROVAL' AND approved_at IS NULL AND merged_at IS NULL)
    OR (status = 'APPROVED' AND approved_at IS NOT NULL AND merged_at IS NULL)
    OR (status = 'MERGED' AND approved_at IS NOT NULL AND merged_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_cooking_batch_round_parts_batch_dish_round ON cooking_batch_round_parts(cooking_batch_id, dish_id, supply_round_id);
CREATE INDEX idx_cooking_batch_round_parts_round ON cooking_batch_round_parts(supply_round_id);

CREATE TABLE cooking_batch_round_part_lots (
  round_part_id uuid NOT NULL REFERENCES cooking_batch_round_parts(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  ingredient_lot_id uuid NOT NULL REFERENCES ingredient_lots(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  quantity_used numeric(14,3) NOT NULL CHECK (quantity_used > 0 AND quantity_used <> 'NaN'::numeric),
  unit varchar(30) NOT NULL,
  PRIMARY KEY (round_part_id, ingredient_lot_id)
);
CREATE INDEX idx_cooking_batch_round_part_lots_lot ON cooking_batch_round_part_lots(ingredient_lot_id);

-- 10.5 Chuyến giao, đơn và lô.
ALTER TABLE deliveries
  ADD COLUMN preparation_stage delivery_preparation_stage,
  ADD COLUMN replaces_delivery_id uuid REFERENCES deliveries(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD COLUMN top_up_confirmed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD COLUMN top_up_confirmed_at timestamptz(6),
  ADD CONSTRAINT deliveries_replaces_request_check CHECK (
    replaces_delivery_id IS NULL OR (creation_mode = 'REQUEST' AND replaces_delivery_id <> id)
  ),
  ADD CONSTRAINT deliveries_top_up_confirmed_check CHECK ((top_up_confirmed_by_user_id IS NULL) = (top_up_confirmed_at IS NULL));
CREATE INDEX idx_deliveries_replaces ON deliveries(replaces_delivery_id);

-- Một đơn REQUEST chỉ có một chuyến giao còn hiệu lực; chuyến bị từ chối hoặc đã hủy không chặn chuyến thay thế.
-- Tạo index mới trước rồi mới bỏ index cũ (index mới chặt bằng hoặc lỏng hơn nên dữ liệu cũ luôn thỏa).
CREATE UNIQUE INDEX uq_deliveries_request_active ON deliveries(supply_request_id)
  WHERE creation_mode = 'REQUEST' AND status NOT IN ('REJECTED', 'CANCELLED');
DROP INDEX uq_deliveries_request_mode;

ALTER TABLE ingredient_lots
  ADD COLUMN sample_top_up_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT ingredient_lots_sample_top_up_quantity_check CHECK (sample_top_up_quantity >= 0 AND sample_top_up_quantity <> 'NaN'::numeric);

ALTER TABLE delivery_items
  ADD COLUMN sample_top_up_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT delivery_items_sample_top_up_quantity_check CHECK (sample_top_up_quantity >= 0 AND sample_top_up_quantity <> 'NaN'::numeric);

ALTER TABLE supply_request_items
  ADD COLUMN sample_top_up_quantity numeric(14,3) NOT NULL DEFAULT 0,
  ADD CONSTRAINT supply_request_items_sample_top_up_quantity_check CHECK (sample_top_up_quantity >= 0 AND sample_top_up_quantity <> 'NaN'::numeric);

COMMENT ON COLUMN cooking_batch_lots.sample_quantity IS
  'Phần nguyên liệu sống giữ cho lưu mẫu của mẻ; không chia cho lớp. Trừ kho = quantity_used + sample_quantity.';
COMMENT ON COLUMN supply_request_items.sample_top_up_quantity IS
  'Lượng giao thêm cho lưu mẫu đặt từ NCC (hệ thống ghi khi NCC xác nhận lấy thêm). Không dùng để chia mẻ.';
COMMIT;
