-- Reviewed migration: backfill canonical school/ingredient references and add supplier order creation columns.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_count integer;
  v_samples text;
BEGIN
  SELECT
    count(*)::int,
    string_agg(id_text, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT d."id"::text AS id_text
    FROM "foodprint"."deliveries" d
    LEFT JOIN "foodprint"."supply_requests" sr ON sr."id" = d."supply_request_id"
    WHERE sr."id" IS NULL
       OR sr."school_id" IS NULL
       OR d."supplier_id" <> sr."supplier_id"
    ORDER BY d."id"
    LIMIT 5
  ) invalid_deliveries;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Historical deliveries missing or inconsistent SupplyRequest mapping (count=%, sampleIds=%)', v_count, v_samples;
  END IF;

  SELECT
    count(*)::int,
    string_agg(id_text, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT d."id"::text AS id_text
    FROM "foodprint"."deliveries" d
    WHERE length(btrim(d."delivery_no")) = 0
    ORDER BY d."id"
    LIMIT 5
  ) blank_delivery_nos;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Historical deliveries with blank delivery_no require review (count=%, sampleIds=%)', v_count, v_samples;
  END IF;

  SELECT
    count(*)::int,
    string_agg(id_text, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT di."id"::text AS id_text
    FROM "foodprint"."delivery_items" di
    LEFT JOIN "foodprint"."deliveries" d ON d."id" = di."delivery_id"
    LEFT JOIN "foodprint"."supply_requests" sr ON sr."id" = d."supply_request_id"
    LEFT JOIN "foodprint"."supply_request_items" sri ON sri."id" = di."supply_request_item_id"
    LEFT JOIN "foodprint"."ingredient_entries" ie ON ie."id" = sri."ingredient_entry_id"
    LEFT JOIN "foodprint"."ingredients" ing ON ing."id" = ie."ingredient_id"
    WHERE d."id" IS NULL
       OR sr."id" IS NULL
       OR sri."id" IS NULL
       OR ie."id" IS NULL
       OR ing."id" IS NULL
       OR sri."supply_request_id" <> d."supply_request_id"
       OR ie."school_id" <> sr."school_id"
       OR ing."supplier_id" <> d."supplier_id"
    ORDER BY di."id"
    LIMIT 5
  ) invalid_items;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Historical delivery_items inconsistent with SupplyRequest/IngredientEntry/Supplier mapping (count=%, sampleIds=%)', v_count, v_samples;
  END IF;

  SELECT
    count(*)::int,
    string_agg(id_text, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT di."id"::text AS id_text
    FROM "foodprint"."delivery_items" di
    WHERE length(btrim(di."unit")) = 0
    ORDER BY di."id"
    LIMIT 5
  ) blank_item_units;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Historical delivery_items with blank unit require review (count=%, sampleIds=%)', v_count, v_samples;
  END IF;

  SELECT
    count(*)::int,
    string_agg(dup_key, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT (di."delivery_id"::text || ':' || ie."ingredient_id"::text) AS dup_key
    FROM "foodprint"."delivery_items" di
    JOIN "foodprint"."supply_request_items" sri ON sri."id" = di."supply_request_item_id"
    JOIN "foodprint"."ingredient_entries" ie ON ie."id" = sri."ingredient_entry_id"
    GROUP BY di."delivery_id", ie."ingredient_id"
    HAVING count(*) > 1
    ORDER BY di."delivery_id", ie."ingredient_id"
    LIMIT 5
  ) dup_ingredients;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Duplicate (delivery_id, ingredient_id) in historical delivery_items requires review (count=%, sampleKeys=%)', v_count, v_samples;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "foodprint"."delivery_creation_mode" AS ENUM ('REQUEST', 'STANDALONE');

-- AlterTable: add nullable columns before deterministic backfill
ALTER TABLE "foodprint"."deliveries"
  ADD COLUMN "school_id" UUID,
  ADD COLUMN "creation_mode" "foodprint"."delivery_creation_mode",
  ADD COLUMN "creation_key" UUID,
  ADD COLUMN "creation_fingerprint" VARCHAR(64);

ALTER TABLE "foodprint"."delivery_items"
  ADD COLUMN "ingredient_id" UUID,
  ADD COLUMN "ingredient_entry_id" UUID;

-- Deterministic historical backfill preserving updated_at, quantities, codes, statuses, and approvals
UPDATE "foodprint"."deliveries" AS d
SET "school_id" = sr."school_id"
FROM "foodprint"."supply_requests" AS sr
WHERE sr."id" = d."supply_request_id";

UPDATE "foodprint"."delivery_items" AS di
SET
  "ingredient_id" = ie."ingredient_id",
  "ingredient_entry_id" = ie."id"
FROM "foodprint"."supply_request_items" AS sri
JOIN "foodprint"."ingredient_entries" AS ie ON ie."id" = sri."ingredient_entry_id"
WHERE sri."id" = di."supply_request_item_id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "foodprint"."deliveries" WHERE "school_id" IS NULL) THEN
    RAISE EXCEPTION 'Backfill failed to populate deliveries.school_id for all historical rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "foodprint"."delivery_items"
    WHERE "ingredient_id" IS NULL OR "ingredient_entry_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Backfill failed to populate delivery_items canonical ingredient columns';
  END IF;
END $$;

-- Tighten canonical columns and relax source references to nullable
ALTER TABLE "foodprint"."deliveries"
  ALTER COLUMN "school_id" SET NOT NULL,
  ALTER COLUMN "supply_request_id" DROP NOT NULL;

ALTER TABLE "foodprint"."delivery_items"
  ALTER COLUMN "ingredient_id" SET NOT NULL,
  ALTER COLUMN "supply_request_item_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "idx_deliveries_school_status" ON "foodprint"."deliveries"("school_id", "status");
CREATE INDEX "idx_deliveries_supplier_created" ON "foodprint"."deliveries"("supplier_id", "created_at", "id");
CREATE UNIQUE INDEX "uq_deliveries_request_mode"
  ON "foodprint"."deliveries"("supply_request_id")
  WHERE ("creation_mode" = 'REQUEST'::"foodprint"."delivery_creation_mode");
CREATE UNIQUE INDEX "uq_deliveries_creation_idempotency"
  ON "foodprint"."deliveries"("supplier_id", "created_by_user_id", "creation_key")
  WHERE ("creation_key" IS NOT NULL);

CREATE UNIQUE INDEX "delivery_items_delivery_id_ingredient_id_key"
  ON "foodprint"."delivery_items"("delivery_id", "ingredient_id");
CREATE INDEX "idx_delivery_items_ingredient" ON "foodprint"."delivery_items"("ingredient_id");
CREATE INDEX "idx_delivery_items_ingredient_entry" ON "foodprint"."delivery_items"("ingredient_entry_id");

-- AddForeignKey
ALTER TABLE "foodprint"."deliveries"
  ADD CONSTRAINT "deliveries_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "foodprint"."schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "foodprint"."delivery_items"
  ADD CONSTRAINT "delivery_items_ingredient_id_fkey"
  FOREIGN KEY ("ingredient_id") REFERENCES "foodprint"."ingredients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "foodprint"."delivery_items"
  ADD CONSTRAINT "delivery_items_ingredient_entry_id_fkey"
  FOREIGN KEY ("ingredient_entry_id") REFERENCES "foodprint"."ingredient_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- CHECK constraints
ALTER TABLE "foodprint"."deliveries"
  ADD CONSTRAINT "chk_delivery_creation_mode_source" CHECK (
    (
      "creation_mode" IS NULL
      AND "supply_request_id" IS NOT NULL
      AND "creation_key" IS NULL
      AND "creation_fingerprint" IS NULL
    )
    OR (
      "creation_mode" = 'REQUEST'::"foodprint"."delivery_creation_mode"
      AND "supply_request_id" IS NOT NULL
      AND "creation_key" IS NOT NULL
      AND "creation_fingerprint" IS NOT NULL
      AND "created_by_user_id" IS NOT NULL
    )
    OR (
      "creation_mode" = 'STANDALONE'::"foodprint"."delivery_creation_mode"
      AND "supply_request_id" IS NULL
      AND "creation_key" IS NOT NULL
      AND "creation_fingerprint" IS NOT NULL
      AND "created_by_user_id" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "chk_delivery_creation_fingerprint_sha256" CHECK (
    "creation_fingerprint" IS NULL OR "creation_fingerprint" ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT "chk_delivery_no_not_blank" CHECK (
    length(btrim("delivery_no")) > 0
  );

ALTER TABLE "foodprint"."delivery_items"
  ADD CONSTRAINT "chk_delivery_item_unit_not_blank" CHECK (
    length(btrim("unit")) > 0
  );

COMMIT;
