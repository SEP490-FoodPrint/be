BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE foodprint.supply_requests
  ADD COLUMN order_type foodprint.ingredient_handling_type NULL,
  ADD COLUMN batch_no   smallint NULL;

-- Backfill loại đơn: theo handling_type của các dòng hàng (chỉ khi mọi dòng cùng một loại).
UPDATE foodprint.supply_requests sr
SET order_type = t.handling_type
FROM (
  SELECT sri.supply_request_id, MIN(ie.handling_type::text)::foodprint.ingredient_handling_type AS handling_type
  FROM foodprint.supply_request_items sri
  JOIN foodprint.ingredient_entries ie ON ie.id = sri.ingredient_entry_id
  GROUP BY sri.supply_request_id
  HAVING COUNT(DISTINCT ie.handling_type) = 1
) t
WHERE t.supply_request_id = sr.id;

-- Backfill đợt cho đơn tươi theo hậu tố mã cũ.
UPDATE foodprint.supply_requests
SET batch_no = (substring(request_no FROM '-D([12])(?:-[0-9]+)?$'))::smallint
WHERE order_type = 'DIRECT_USE'
  AND request_no ~ '-D[12](-[0-9]+)?$';

ALTER TABLE foodprint.supply_requests
  ADD CONSTRAINT ck_supply_requests_batch_by_type CHECK (
    order_type IS NULL
    OR (order_type = 'DRY_STOCK'  AND batch_no IS NULL)
    OR (order_type = 'DIRECT_USE' AND (batch_no IS NULL OR batch_no IN (1, 2)))
  ) NOT VALID;
ALTER TABLE foodprint.supply_requests VALIDATE CONSTRAINT ck_supply_requests_batch_by_type;

CREATE INDEX idx_supply_requests_school_date_type_batch
  ON foodprint.supply_requests (school_id, requested_delivery_date, order_type, batch_no);
COMMIT;
