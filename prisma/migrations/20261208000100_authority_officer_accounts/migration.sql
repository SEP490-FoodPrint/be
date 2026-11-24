BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- specs/authority-officer-accounts FR-001: System Admin creates commune food-safety
-- officer accounts by username; the officer sets a verified email on first login.
-- Only such pending officer accounts may have no email; UNIQUE(email) is unchanged.
ALTER TABLE "foodprint"."users" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "foodprint"."users"
ADD CONSTRAINT "chk_users_email_required" CHECK (
  "email" IS NOT NULL
  OR (
    ("role_code")::text = 'COMMUNE_FOOD_SAFETY_OFFICER'::text
    AND "status" <> 'ACTIVE'
    AND "email_verified_at" IS NULL
  )
);

COMMIT;
