-- Add nullable storage without rewriting existing batches or inspection records.
-- A compatible pre-provisioned column is preserved; incompatible definitions stop.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
DECLARE
  inspection_column record;
BEGIN
  SELECT a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef,
         a.attidentity, a.attgenerated
  INTO inspection_column
  FROM pg_attribute a
  WHERE a.attrelid = 'foodprint.cooking_batches'::regclass
    AND a.attname = 'inspection_data'
    AND NOT a.attisdropped;

  IF NOT FOUND THEN
    ALTER TABLE foodprint.cooking_batches ADD COLUMN inspection_data jsonb;
  ELSIF inspection_column.atttypid <> 'jsonb'::regtype
     OR inspection_column.atttypmod <> -1
     OR inspection_column.attnotnull
     OR inspection_column.atthasdef
     OR inspection_column.attidentity <> ''
     OR inspection_column.attgenerated <> '' THEN
    RAISE EXCEPTION 'inspection_data must be nullable jsonb without a default or generated expression; existing data was not changed';
  END IF;
END
$migration$;

COMMENT ON COLUMN foodprint.cooking_batches.inspection_data IS
  'Optional structured inspection record. Existing batches retain NULL or their previously recorded JSON data.';
COMMIT;
