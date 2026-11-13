-- Reviewed migration only: duplicates and unassigned open reports require operator review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM foodprint.users
    WHERE role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'
      AND commune_food_safety_unit_id IS NOT NULL
    GROUP BY commune_food_safety_unit_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate commune food safety officers require review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM foodprint.users u
    JOIN foodprint.roles r ON r.id = u.role_id
    WHERE u.role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'
      AND (r.type <> 'AUTHORITY' OR u.school_id IS NOT NULL OR u.supplier_id IS NOT NULL
        OR (u.status = 'ACTIVE' AND u.commune_food_safety_unit_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'Invalid commune food safety officer membership requires review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM foodprint.food_safety_report_forwardings f
    JOIN foodprint.food_safety_incidents i ON i.id = f.incident_id
    WHERE f.recipient_commune_food_safety_unit_id IS NOT NULL
      AND i.status <> 'CLOSED'
      AND NOT EXISTS (
        SELECT 1 FROM foodprint.users u
        WHERE u.role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'
          AND u.commune_food_safety_unit_id = f.recipient_commune_food_safety_unit_id
      )
  ) THEN
    RAISE EXCEPTION 'Open internal food safety reports without an officer require review';
  END IF;
END $$;

CREATE TYPE foodprint.intake_state AS ENUM ('ACTIVE', 'PAUSED', 'PAUSED_FOR_FOOD_SAFETY_INSPECTION');
ALTER TABLE foodprint.schools ADD COLUMN intake_state foodprint.intake_state NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE foodprint.suppliers ADD COLUMN intake_state foodprint.intake_state NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE foodprint.users ADD COLUMN intake_state foodprint.intake_state NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE foodprint.food_safety_report_forwardings ADD COLUMN recipient_user_id uuid;
ALTER TABLE foodprint.food_safety_report_forwardings ADD COLUMN received_at timestamptz(6);

-- Assign the current unique officer, not historical receipt; received_at remains NULL.
UPDATE foodprint.food_safety_report_forwardings f
SET recipient_user_id = u.id
FROM foodprint.users u
WHERE u.role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'
  AND f.recipient_commune_food_safety_unit_id = u.commune_food_safety_unit_id;

ALTER TABLE foodprint.schools ADD CONSTRAINT chk_school_intake_state
  CHECK (intake_state IN ('ACTIVE', 'PAUSED'));
ALTER TABLE foodprint.suppliers ADD CONSTRAINT chk_supplier_intake_state
  CHECK (intake_state IN ('ACTIVE', 'PAUSED_FOR_FOOD_SAFETY_INSPECTION'));
ALTER TABLE foodprint.users ADD CONSTRAINT chk_user_intake_state
  CHECK ((role_code = 'COMMUNE_FOOD_SAFETY_OFFICER' AND intake_state IN ('ACTIVE', 'PAUSED'))
      OR (role_code <> 'COMMUNE_FOOD_SAFETY_OFFICER' AND intake_state = 'ACTIVE'));
ALTER TABLE foodprint.users ADD CONSTRAINT chk_commune_officer_organization
  CHECK (role_code <> 'COMMUNE_FOOD_SAFETY_OFFICER'
    OR (school_id IS NULL AND supplier_id IS NULL
      AND (status <> 'ACTIVE' OR commune_food_safety_unit_id IS NOT NULL)));
ALTER TABLE foodprint.food_safety_report_forwardings ADD CONSTRAINT chk_forwarding_receipt_recipient
  CHECK ((received_at IS NULL OR recipient_user_id IS NOT NULL)
    AND (recipient_user_id IS NULL OR recipient_commune_food_safety_unit_id IS NOT NULL));
ALTER TABLE foodprint.food_safety_report_forwardings ADD CONSTRAINT food_safety_forwarding_recipient_user_fkey
  FOREIGN KEY (recipient_user_id) REFERENCES foodprint.users(id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE UNIQUE INDEX uq_users_commune_officer ON foodprint.users (commune_food_safety_unit_id)
  WHERE (role_code)::text = 'COMMUNE_FOOD_SAFETY_OFFICER'::text;
CREATE INDEX idx_food_safety_forwardings_recipient_user
  ON foodprint.food_safety_report_forwardings (recipient_user_id, incident_id);
COMMIT;
