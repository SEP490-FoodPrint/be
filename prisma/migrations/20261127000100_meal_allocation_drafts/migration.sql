BEGIN;
CREATE TABLE foodprint.meal_allocation_drafts (
  school_id uuid NOT NULL REFERENCES foodprint.schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  meal_date date NOT NULL,
  meal_type foodprint.meal_type NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('PENDING', 'RUNNING', 'FAILED', 'DRAFT')),
  revision varchar(64) NOT NULL,
  source_revision varchar(64),
  plan jsonb,
  error text,
  updated_at timestamptz(6) NOT NULL,
  PRIMARY KEY (school_id, meal_date, meal_type),
  CHECK (state <> 'DRAFT' OR (plan IS NOT NULL AND source_revision IS NOT NULL))
);
CREATE INDEX meal_allocation_drafts_state_updated_at_idx
  ON foodprint.meal_allocation_drafts (state, updated_at);
COMMIT;
