-- Role code is a verified discriminator for partial admin uniqueness; no fixed role UUIDs.
-- Existing accounts retain their role and credentials. Duplicate admins cause failure.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE foodprint.users ADD COLUMN role_code varchar(60);
UPDATE foodprint.users u SET role_code = r.code, updated_at = CURRENT_TIMESTAMP FROM foodprint.roles r WHERE r.id = u.role_id;
ALTER TABLE foodprint.users ALTER COLUMN role_code SET NOT NULL;
ALTER TABLE foodprint.roles ADD CONSTRAINT uq_roles_id_code UNIQUE (id, code);
ALTER TABLE foodprint.users DROP CONSTRAINT users_role_id_fkey;
ALTER TABLE foodprint.users ADD CONSTRAINT users_role_id_code_fkey
  FOREIGN KEY (role_id, role_code) REFERENCES foodprint.roles(id, code) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE foodprint.users ADD CONSTRAINT chk_school_admin_organization
  CHECK (role_code <> 'SCHOOL_ADMINISTRATION' OR (supplier_id IS NULL AND commune_food_safety_unit_id IS NULL AND (status <> 'ACTIVE' OR school_id IS NOT NULL)));
ALTER TABLE foodprint.users ADD CONSTRAINT chk_supplier_admin_organization
  CHECK (role_code <> 'INGREDIENT_SUPPLIER_ADMIN' OR (school_id IS NULL AND commune_food_safety_unit_id IS NULL AND (status <> 'ACTIVE' OR supplier_id IS NOT NULL)));
CREATE UNIQUE INDEX uq_users_school_admin ON foodprint.users(school_id)
  WHERE (role_code)::text = 'SCHOOL_ADMINISTRATION'::text;
CREATE UNIQUE INDEX uq_users_supplier_admin ON foodprint.users(supplier_id)
  WHERE (role_code)::text = 'INGREDIENT_SUPPLIER_ADMIN'::text;
COMMIT;
