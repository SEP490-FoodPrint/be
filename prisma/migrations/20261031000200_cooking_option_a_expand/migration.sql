-- Option A, phase 1: retain both legacy columns for old Backend instances.
-- Review the read-only data checks and the backfill before merging into dev.
-- There is deliberately no DROP COLUMN in this deployment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE foodprint.cooking_batches IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE foodprint.cooking_batch_lots IN SHARE ROW EXCLUSIVE MODE;

DO $migration$
DECLARE
  conflicts jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(problem)) INTO conflicts
  FROM (
    SELECT id, planned_portions, prepared_portions, status
    FROM foodprint.cooking_batches
    WHERE prepared_portions IS NOT NULL
      AND prepared_portions IS DISTINCT FROM planned_portions
    ORDER BY id LIMIT 100
  ) AS problem;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Option A blocked: historical portion values differ; no values were overwritten'
      USING DETAIL = conflicts::text;
  END IF;

  SELECT jsonb_agg(to_jsonb(problem)) INTO conflicts
  FROM (
    SELECT cooking_batch_id, ingredient_lot_id, planned_quantity, quantity_used
    FROM foodprint.cooking_batch_lots
    WHERE (quantity_used IS NULL AND (planned_quantity IS NULL OR planned_quantity <= 0))
       OR quantity_used <= 0
       OR (quantity_used IS NOT NULL AND planned_quantity IS NOT NULL
           AND quantity_used <> planned_quantity)
    ORDER BY cooking_batch_id, ingredient_lot_id LIMIT 100
  ) AS problem;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Option A blocked: historical ingredient quantities need an approved preservation plan'
      USING DETAIL = conflicts::text;
  END IF;
END
$migration$;

-- Only missing values with a positive, non-conflicting plan are backfilled.
-- This records the allocated plan; it does not post stock usage or change stock.
UPDATE foodprint.cooking_batch_lots
SET quantity_used = planned_quantity
WHERE quantity_used IS NULL AND planned_quantity > 0;

ALTER TABLE foodprint.cooking_batch_lots
  ALTER COLUMN quantity_used SET NOT NULL,
  ALTER COLUMN planned_quantity DROP NOT NULL;

ALTER TABLE foodprint.cooking_batch_lots
  DROP CONSTRAINT cooking_batch_lots_quantity_used_check,
  ADD CONSTRAINT cooking_batch_lots_quantity_used_check CHECK (quantity_used > 0);

ALTER TABLE foodprint.cooking_batches DROP CONSTRAINT chk_cooking_batch_lifecycle;
ALTER TABLE foodprint.cooking_batches ADD CONSTRAINT chk_cooking_batch_lifecycle CHECK (
  (status = 'UNCONFIRMED'
    AND confirmed_at IS NULL AND confirmed_by_user_id IS NULL
    AND completed_at IS NULL AND completed_by_user_id IS NULL
    AND prepared_portions IS NULL)
  OR (status = 'CONFIRMED'
    AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL
    AND completed_at IS NULL AND completed_by_user_id IS NULL
    AND prepared_portions IS NULL AND planned_portions IS NOT NULL AND planned_portions > 0)
  OR (status = 'COMPLETED'
    AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL
    AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL
    AND planned_portions IS NOT NULL AND planned_portions > 0
    AND (prepared_portions IS NULL OR prepared_portions = planned_portions))
);

COMMENT ON COLUMN foodprint.cooking_batches.planned_portions IS
  'Option A: Backend-computed portions from finalized demand; completion uses this confirmed plan.';
COMMENT ON COLUMN foodprint.cooking_batches.prepared_portions IS
  'Deprecated compatibility column retained in phase 1; new Backend does not read or write it.';
COMMENT ON COLUMN foodprint.cooking_batch_lots.planned_quantity IS
  'Deprecated compatibility column retained in phase 1; new Backend does not read or write it.';
COMMENT ON COLUMN foodprint.cooking_batch_lots.quantity_used IS
  'Option A: Backend-computed allocation from recipe and planned portions; reserved before completion, posted to inventory only on completion.';
COMMENT ON COLUMN foodprint.cooking_batches.completed_at IS
  'Time kitchen confirmed completion of the planned portions and ingredient allocations; no actual quantity entry.';

COMMIT;
