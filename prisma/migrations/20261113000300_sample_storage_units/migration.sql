-- Additive: Sample storage units master data for school kitchens
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE IF NOT EXISTS foodprint.sample_storage_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES foodprint.schools(id) ON DELETE RESTRICT,
  code varchar(50) NOT NULL,
  name varchar(255) NOT NULL,
  location varchar(255) NOT NULL,
  temperature_range varchar(100) NOT NULL DEFAULT '2°C - 8°C',
  current_temperature numeric(4, 1),
  capacity integer NOT NULL DEFAULT 40,
  current_usage integer NOT NULL DEFAULT 0,
  compartment_count integer NOT NULL DEFAULT 3,
  status varchar(50) NOT NULL DEFAULT 'ACTIVE',
  brand varchar(100),
  description text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_sample_storage_units_school_code UNIQUE (school_id, code),
  CONSTRAINT ck_sample_storage_units_status CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE'))
);

CREATE INDEX IF NOT EXISTS idx_sample_storage_units_school_status ON foodprint.sample_storage_units(school_id, status);

ALTER TABLE foodprint.retained_food_samples
  ADD COLUMN IF NOT EXISTS storage_unit_id uuid REFERENCES foodprint.sample_storage_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_retained_food_samples_storage_unit_id ON foodprint.retained_food_samples(storage_unit_id);

COMMIT;
