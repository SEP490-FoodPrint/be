BEGIN;

-- 1. Create complaint_kind ENUM
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'complaint_kind') THEN
    CREATE TYPE foodprint.complaint_kind AS ENUM ('MEAL', 'INGREDIENT', 'AUTHORITY', 'SYSTEM');
  END IF;
END $$;

-- 2. Add RESPONDED to complaint_status ENUM if not exists
ALTER TYPE foodprint.complaint_status ADD VALUE IF NOT EXISTS 'RESPONDED';

-- 3. Rename or create complaint_code_seq
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ingredient_quality_feedback_complaint_code_seq'
      AND n.nspname = 'foodprint'
  ) THEN
    ALTER SEQUENCE foodprint.ingredient_quality_feedback_complaint_code_seq
      RENAME TO complaint_code_seq;
  ELSE
    CREATE SEQUENCE IF NOT EXISTS foodprint.complaint_code_seq
      AS BIGINT INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;
  END IF;
END $$;

-- 4. Create complaints table
CREATE TABLE foodprint.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind foodprint.complaint_kind NOT NULL,
  complaint_code VARCHAR(25) NOT NULL,
  sender_user_id UUID NOT NULL,
  sender_role_code VARCHAR(60) NOT NULL,
  sender_school_id UUID,
  sender_supplier_id UUID,
  sender_commune_food_safety_unit_id UUID,
  title VARCHAR(255),
  description TEXT NOT NULL,
  status foodprint.complaint_status NOT NULL DEFAULT 'SUBMITTED',
  current_response_version_id UUID,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_complaints_id_kind UNIQUE (id, kind),
  CONSTRAINT uq_complaints_complaint_code UNIQUE (complaint_code),
  CONSTRAINT fk_complaints_sender_user FOREIGN KEY (sender_user_id) REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_sender_role FOREIGN KEY (sender_role_code) REFERENCES foodprint.roles(code) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_sender_school FOREIGN KEY (sender_school_id) REFERENCES foodprint.schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_sender_supplier FOREIGN KEY (sender_supplier_id) REFERENCES foodprint.suppliers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaints_sender_unit FOREIGN KEY (sender_commune_food_safety_unit_id) REFERENCES foodprint.commune_food_safety_units(id) ON DELETE RESTRICT,
  CONSTRAINT complaints_complaint_code_format CHECK (
    CASE
      WHEN complaint_code ~ '^FP-CP-([0-9]{5}|[1-9][0-9]{5,18})$'
        THEN substring(complaint_code FROM 7)::numeric BETWEEN 1 AND 9223372036854775807
      ELSE false
    END
  ),
  CONSTRAINT complaints_sender_scope_check CHECK (
    num_nonnulls(sender_school_id, sender_supplier_id, sender_commune_food_safety_unit_id) <= 1
  )
);

CREATE INDEX idx_complaints_kind_created ON foodprint.complaints(kind, created_at DESC, id);
CREATE INDEX idx_complaints_sender_created ON foodprint.complaints(sender_user_id, created_at DESC);
CREATE INDEX idx_complaints_status_created ON foodprint.complaints(status, created_at DESC);

-- 5. Create complaint_response_versions table
CREATE TABLE foodprint.complaint_response_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL,
  version INT NOT NULL,
  previous_version_id UUID,
  content TEXT NOT NULL,
  change_reason TEXT,
  responded_by_user_id UUID,
  responded_role_code VARCHAR(60),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT fk_crv_complaint FOREIGN KEY (complaint_id) REFERENCES foodprint.complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_crv_prev_version FOREIGN KEY (previous_version_id) REFERENCES foodprint.complaint_response_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crv_responded_by_user FOREIGN KEY (responded_by_user_id) REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_crv_responded_role FOREIGN KEY (responded_role_code) REFERENCES foodprint.roles(code) ON DELETE RESTRICT,
  CONSTRAINT uq_crv_complaint_version UNIQUE (complaint_id, version),
  CONSTRAINT uq_crv_complaint_id UNIQUE (complaint_id, id),
  CONSTRAINT chk_crv_version CHECK (version >= 1),
  CONSTRAINT chk_crv_change_reason CHECK (
    version = 1 OR (change_reason IS NOT NULL AND length(btrim(change_reason)) > 0)
  )
);

CREATE INDEX idx_crv_complaint ON foodprint.complaint_response_versions(complaint_id, version DESC);

ALTER TABLE foodprint.complaints
  ADD CONSTRAINT fk_complaints_current_response_version
    FOREIGN KEY (current_response_version_id) REFERENCES foodprint.complaint_response_versions(id) ON DELETE RESTRICT;

ALTER TABLE foodprint.complaints
  ADD CONSTRAINT chk_complaints_status_version CHECK (
    (status IN ('SUBMITTED', 'IN_REVIEW') AND current_response_version_id IS NULL)
    OR (status = 'RESPONDED' AND current_response_version_id IS NOT NULL)
    OR (status = 'CLOSED')
  );

-- 6. Create complaint_status_histories table
CREATE TABLE foodprint.complaint_status_histories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL,
  from_status foodprint.complaint_status,
  to_status foodprint.complaint_status NOT NULL,
  response_version_id UUID,
  actor_user_id UUID,
  actor_role_code VARCHAR(60),
  note TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT fk_csh_complaint FOREIGN KEY (complaint_id) REFERENCES foodprint.complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_csh_version FOREIGN KEY (response_version_id) REFERENCES foodprint.complaint_response_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_csh_actor_user FOREIGN KEY (actor_user_id) REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_csh_actor_role FOREIGN KEY (actor_role_code) REFERENCES foodprint.roles(code) ON DELETE RESTRICT
);

CREATE INDEX idx_csh_complaint_created ON foodprint.complaint_status_histories(complaint_id, created_at DESC);

-- 7. Migrate data from ingredient_quality_feedback
INSERT INTO foodprint.complaints (
  id,
  kind,
  complaint_code,
  sender_user_id,
  sender_role_code,
  sender_school_id,
  title,
  description,
  status,
  created_at,
  updated_at
)
SELECT
  f.id,
  'INGREDIENT'::foodprint.complaint_kind,
  f.complaint_code,
  f.submitted_by_user_id,
  u.role_code,
  u.school_id,
  f.title,
  f.description,
  f.status::text::foodprint.complaint_status,
  f.created_at,
  f.updated_at
FROM foodprint.ingredient_quality_feedback f
INNER JOIN foodprint.users u ON u.id = f.submitted_by_user_id;

-- Insert response versions for responded ingredient_quality_feedback
INSERT INTO foodprint.complaint_response_versions (
  id,
  complaint_id,
  version,
  content,
  responded_by_user_id,
  responded_role_code,
  created_at
)
SELECT
  gen_random_uuid(),
  f.id,
  1,
  f.supplier_response,
  f.responded_by_user_id,
  ru.role_code,
  COALESCE(f.responded_at, f.updated_at)
FROM foodprint.ingredient_quality_feedback f
LEFT JOIN foodprint.users ru ON ru.id = f.responded_by_user_id
WHERE f.supplier_response IS NOT NULL AND f.status::text = 'RESPONDED';

-- Link current_response_version_id on complaints for INGREDIENT
UPDATE foodprint.complaints c
SET current_response_version_id = crv.id
FROM foodprint.complaint_response_versions crv
WHERE crv.complaint_id = c.id AND crv.version = 1 AND c.kind = 'INGREDIENT';

-- Insert history for responded ingredient_quality_feedback
INSERT INTO foodprint.complaint_status_histories (
  id,
  complaint_id,
  from_status,
  to_status,
  response_version_id,
  actor_user_id,
  actor_role_code,
  created_at
)
SELECT
  gen_random_uuid(),
  c.id,
  'SUBMITTED'::foodprint.complaint_status,
  'RESPONDED'::foodprint.complaint_status,
  c.current_response_version_id,
  crv.responded_by_user_id,
  crv.responded_role_code,
  crv.created_at
FROM foodprint.complaints c
INNER JOIN foodprint.complaint_response_versions crv ON crv.id = c.current_response_version_id
WHERE c.kind = 'INGREDIENT';

-- 8. Migrate data from meal_complaints
WITH numbered_mc AS (
  SELECT
    mc.id,
    nextval('foodprint.complaint_code_seq') AS seq
  FROM foodprint.meal_complaints mc
  ORDER BY mc.submitted_at ASC, mc.id ASC
),
mc_with_school AS (
  SELECT
    mc.id,
    mc.submitted_by_user_id,
    u.role_code AS sender_role_code,
    c.school_id,
    mc.complaint_type,
    mc.description,
    CASE
      WHEN mc.status::text = 'RESOLVED' THEN 'RESPONDED'::foodprint.complaint_status
      ELSE mc.status::text::foodprint.complaint_status
    END AS mapped_status,
    mc.submitted_at,
    mc.updated_at,
    mc.resolution,
    mc.handled_by_user_id,
    mc.resolved_at
  FROM foodprint.meal_complaints mc
  INNER JOIN foodprint.users u ON u.id = mc.submitted_by_user_id
  INNER JOIN foodprint.daily_meal_portions dmp ON dmp.id = mc.daily_meal_portion_id
  INNER JOIN foodprint.classes c ON c.id = dmp.class_id
)
INSERT INTO foodprint.complaints (
  id,
  kind,
  complaint_code,
  sender_user_id,
  sender_role_code,
  sender_school_id,
  title,
  description,
  status,
  created_at,
  updated_at
)
SELECT
  m.id,
  'MEAL'::foodprint.complaint_kind,
  CONCAT(
    'FP-CP-',
    CASE
      WHEN n.seq < 100000 THEN lpad(n.seq::text, 5, '0')
      ELSE n.seq::text
    END
  ),
  m.submitted_by_user_id,
  m.sender_role_code,
  m.school_id,
  CASE m.complaint_type::text
    WHEN 'MEAL_QUALITY' THEN 'Phản ánh chất lượng món ăn'
    WHEN 'FOOD_HYGIENE' THEN 'Phản ánh vệ sinh an toàn thực phẩm'
    WHEN 'HEALTH_ISSUE' THEN 'Phản ánh vấn đề sức khỏe sau bữa ăn'
    ELSE 'Phản ánh suất ăn'
  END,
  m.description,
  m.mapped_status,
  m.submitted_at,
  m.updated_at
FROM mc_with_school m
INNER JOIN numbered_mc n ON n.id = m.id;

-- Insert response versions for resolved meal_complaints
INSERT INTO foodprint.complaint_response_versions (
  id,
  complaint_id,
  version,
  content,
  responded_by_user_id,
  responded_role_code,
  created_at
)
SELECT
  gen_random_uuid(),
  mc.id,
  1,
  mc.resolution,
  mc.handled_by_user_id,
  hu.role_code,
  COALESCE(mc.resolved_at, mc.updated_at)
FROM foodprint.meal_complaints mc
LEFT JOIN foodprint.users hu ON hu.id = mc.handled_by_user_id
WHERE mc.resolution IS NOT NULL AND mc.status::text IN ('RESOLVED', 'CLOSED');

-- Link current_response_version_id on complaints for MEAL
UPDATE foodprint.complaints c
SET current_response_version_id = crv.id
FROM foodprint.complaint_response_versions crv
WHERE crv.complaint_id = c.id AND crv.version = 1 AND c.kind = 'MEAL';

-- Insert history for resolved meal_complaints
INSERT INTO foodprint.complaint_status_histories (
  id,
  complaint_id,
  from_status,
  to_status,
  response_version_id,
  actor_user_id,
  actor_role_code,
  created_at
)
SELECT
  gen_random_uuid(),
  c.id,
  'SUBMITTED'::foodprint.complaint_status,
  'RESPONDED'::foodprint.complaint_status,
  c.current_response_version_id,
  crv.responded_by_user_id,
  crv.responded_role_code,
  crv.created_at
FROM foodprint.complaints c
INNER JOIN foodprint.complaint_response_versions crv ON crv.id = c.current_response_version_id
WHERE c.kind = 'MEAL';

-- 9. Alter meal_complaints to Subtype
ALTER TABLE foodprint.meal_complaints
  ADD COLUMN school_id UUID,
  ADD COLUMN kind foodprint.complaint_kind NOT NULL DEFAULT 'MEAL';

UPDATE foodprint.meal_complaints mc
SET school_id = c.school_id
FROM foodprint.daily_meal_portions dmp
JOIN foodprint.classes c ON c.id = dmp.class_id
WHERE dmp.id = mc.daily_meal_portion_id;

ALTER TABLE foodprint.meal_complaints
  ALTER COLUMN school_id SET NOT NULL,
  ADD CONSTRAINT chk_meal_complaints_kind CHECK (kind = 'MEAL'),
  ADD CONSTRAINT fk_meal_complaints_school FOREIGN KEY (school_id) REFERENCES foodprint.schools(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_meal_complaints_parent FOREIGN KEY (id, kind) REFERENCES foodprint.complaints(id, kind) ON DELETE RESTRICT;

ALTER TABLE foodprint.meal_complaints
  DROP COLUMN submitted_by_user_id,
  DROP COLUMN status,
  DROP COLUMN handled_by_user_id,
  DROP COLUMN resolution,
  DROP COLUMN resolved_at,
  DROP COLUMN submitted_at,
  DROP COLUMN updated_at,
  DROP COLUMN description;

CREATE INDEX idx_meal_complaints_school ON foodprint.meal_complaints(school_id);

-- 10. Alter ingredient_quality_feedback to Subtype
ALTER TABLE foodprint.ingredient_quality_feedback
  ADD COLUMN kind foodprint.complaint_kind NOT NULL DEFAULT 'INGREDIENT';

ALTER TABLE foodprint.ingredient_quality_feedback
  ADD CONSTRAINT chk_iqf_kind CHECK (kind = 'INGREDIENT'),
  ADD CONSTRAINT fk_iqf_parent FOREIGN KEY (id, kind) REFERENCES foodprint.complaints(id, kind) ON DELETE RESTRICT;

ALTER TABLE foodprint.ingredient_quality_feedback
  DROP CONSTRAINT IF EXISTS ingredient_quality_feedback_complaint_code_key,
  DROP CONSTRAINT IF EXISTS ingredient_quality_feedback_complaint_code_format;

DROP INDEX IF EXISTS foodprint.idx_ingredient_quality_feedback_status;

ALTER TABLE foodprint.ingredient_quality_feedback
  DROP COLUMN complaint_code,
  DROP COLUMN submitted_by_user_id,
  DROP COLUMN status,
  DROP COLUMN supplier_response,
  DROP COLUMN responded_by_user_id,
  DROP COLUMN responded_at,
  DROP COLUMN created_at,
  DROP COLUMN updated_at,
  DROP COLUMN title,
  DROP COLUMN description;

-- 11. Ensure sequence counter is higher than maximum count
SELECT setval(
  'foodprint.complaint_code_seq'::regclass,
  GREATEST((SELECT count(*) FROM foodprint.complaints), 1),
  (SELECT count(*) FROM foodprint.complaints) > 0
);

COMMIT;
