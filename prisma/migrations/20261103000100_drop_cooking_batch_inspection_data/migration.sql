-- Drop inspection_data column from cooking_batches table (Decision 1246/QD-BYT 3-step inspection removed).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE foodprint.cooking_batches DROP COLUMN IF EXISTS inspection_data;

COMMIT;

