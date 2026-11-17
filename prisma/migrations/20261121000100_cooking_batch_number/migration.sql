BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE "foodprint"."cooking_batches"
ADD COLUMN "batch_number" INTEGER;

COMMIT;
