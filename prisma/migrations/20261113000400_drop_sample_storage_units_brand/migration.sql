BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE foodprint.sample_storage_units DROP COLUMN IF EXISTS brand;

COMMIT;
