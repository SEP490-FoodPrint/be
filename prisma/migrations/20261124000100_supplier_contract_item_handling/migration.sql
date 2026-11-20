BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Loại nguyên liệu theo hồ sơ hợp đồng (Lưu kho / Dùng ngay). Dòng cũ giữ NULL:
-- người phụ trách chọn loại trước khi kích hoạt, không gán mặc định.
ALTER TABLE foodprint.supplier_contract_items
  ADD COLUMN handling_type foodprint.ingredient_handling_type NULL;

COMMIT;
