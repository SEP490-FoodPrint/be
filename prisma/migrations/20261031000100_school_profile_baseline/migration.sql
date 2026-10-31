-- Version the School profile columns already provisioned on Azure.
-- Keep existing addresses when upgrading databases built from 0_init.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'foodprint' AND table_name = 'schools' AND column_name = 'address'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'foodprint' AND table_name = 'schools' AND column_name = 'address_line'
    ) THEN
      RAISE EXCEPTION 'schools has both address and address_line; review the data before migration';
    END IF;
    ALTER TABLE foodprint.schools RENAME COLUMN address TO address_line;
  END IF;
END $$;

ALTER TABLE foodprint.schools
  ADD COLUMN IF NOT EXISTS address_line text,
  ADD COLUMN IF NOT EXISTS location_id uuid,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS boarding_scale varchar(100);

DO $$
DECLARE
  expected record;
  actual_type text;
  required boolean;
  has_default boolean;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('address_line', 'text'), ('location_id', 'uuid'), ('description', 'text'),
    ('logo_url', 'text'), ('cover_image_url', 'text'), ('boarding_scale', 'character varying(100)')
  ) AS columns(name, type) LOOP
    SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
           EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
    INTO actual_type, required, has_default
    FROM pg_attribute a
    WHERE a.attrelid = 'foodprint.schools'::regclass AND a.attname = expected.name AND NOT a.attisdropped;
    IF actual_type IS DISTINCT FROM expected.type OR required OR has_default THEN
      RAISE EXCEPTION 'Unexpected schools profile column definition: %', expected.name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'foodprint.schools'::regclass AND conname = 'schools_location_id_fkey'
  ) THEN
    ALTER TABLE foodprint.schools ADD CONSTRAINT schools_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES foodprint.locations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_schools_location_id ON foodprint.schools(location_id);
COMMIT;
