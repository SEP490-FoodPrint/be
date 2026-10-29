-- Additive patch for the Prisma UserPermissionDenial model.
-- Requires the existing foodprint users, permissions, schools, suppliers,
-- and commune_food_safety_units tables (RBAC schema from v5.4 or equivalent).
-- One-time application: an existing target table causes failure; never reset it.
-- This file is reviewed independently of Prisma Migrate; it creates no migration history.
-- Deployment must be explicitly authorized. Do not run the complete database seed SQL.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- CreateTable
CREATE TABLE "foodprint"."user_permission_denials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "school_id" UUID,
    "supplier_id" UUID,
    "commune_food_safety_unit_id" UUID,
    "disabled_by_user_id" UUID NOT NULL,
    "disabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_denials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_user_permission_denials_permission_id" ON "foodprint"."user_permission_denials"("permission_id");

-- CreateIndex
CREATE INDEX "idx_user_permission_denials_disabled_by" ON "foodprint"."user_permission_denials"("disabled_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_permission_denials_school" ON "foodprint"."user_permission_denials"("user_id", "permission_id", "school_id") WHERE (school_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_permission_denials_supplier" ON "foodprint"."user_permission_denials"("user_id", "permission_id", "supplier_id") WHERE (supplier_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_permission_denials_commune_unit" ON "foodprint"."user_permission_denials"("user_id", "permission_id", "commune_food_safety_unit_id") WHERE (commune_food_safety_unit_id IS NOT NULL);

-- AddForeignKey
ALTER TABLE "foodprint"."user_permission_denials" ADD CONSTRAINT "user_permission_denials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "foodprint"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."user_permission_denials" ADD CONSTRAINT "user_permission_denials_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "foodprint"."permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."user_permission_denials" ADD CONSTRAINT "user_permission_denials_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "foodprint"."schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."user_permission_denials" ADD CONSTRAINT "user_permission_denials_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "foodprint"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."user_permission_denials" ADD CONSTRAINT "user_permission_denials_commune_food_safety_unit_id_fkey" FOREIGN KEY ("commune_food_safety_unit_id") REFERENCES "foodprint"."commune_food_safety_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."user_permission_denials" ADD CONSTRAINT "user_permission_denials_disabled_by_user_id_fkey" FOREIGN KEY ("disabled_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- PostgreSQL must reject zero organizations and every combination of multiple organizations.
ALTER TABLE "foodprint"."user_permission_denials"
    ADD CONSTRAINT "chk_user_permission_denials_exactly_one_organization"
    CHECK (num_nonnulls(school_id, supplier_id, commune_food_safety_unit_id) = 1);

COMMIT;
