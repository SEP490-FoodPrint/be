BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Preserve non-staff account names while allowing independent supplier staff.
-- All statuses keep their names; supplier admins share the supplier namespace.
CREATE UNIQUE INDEX "uq_users_non_staff_username"
ON "foodprint"."users" ("username")
WHERE (("role_code")::text <> 'INGREDIENT_SUPPLIER_STAFF'::text);

CREATE UNIQUE INDEX "uq_users_supplier_username"
ON "foodprint"."users" ("supplier_id", "username")
WHERE "supplier_id" IS NOT NULL;

ALTER TABLE "foodprint"."users" DROP CONSTRAINT "users_username_key";

COMMIT;
