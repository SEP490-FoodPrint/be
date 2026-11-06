-- Expand only: BGH assigns one ACTIVE HOMEROOM_TEACHER account to each class.
-- Classes are already one row per academic year, so assignments follow the year.
-- Replacing a teacher closes the current row (ended_at) and keeps it as history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE foodprint.class_homeroom_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES foodprint.classes(id) ON DELETE RESTRICT,
  teacher_user_id uuid NOT NULL REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  assigned_by_user_id uuid NOT NULL REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  ended_by_user_id uuid REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_class_homeroom_assignment_lifecycle CHECK (
    (ended_at IS NULL AND ended_by_user_id IS NULL)
    OR (ended_at IS NOT NULL AND ended_by_user_id IS NOT NULL AND ended_at >= assigned_at)
  )
);
-- One current homeroom teacher per class.
CREATE UNIQUE INDEX uq_class_homeroom_current
  ON foodprint.class_homeroom_assignments(class_id) WHERE ended_at IS NULL;
CREATE INDEX idx_class_homeroom_teacher_current
  ON foodprint.class_homeroom_assignments(teacher_user_id) WHERE ended_at IS NULL;
COMMIT;
