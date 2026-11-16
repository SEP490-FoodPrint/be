BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preflight: fail fast instead of mutating or deleting inconsistent records
DO $$
DECLARE
  v_count integer;
  v_samples text;
BEGIN
  SELECT count(*)::int, string_agg(id_text, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT d."id"::text AS id_text
    FROM "foodprint"."deliveries" d
    WHERE d."status" = 'PREPARING'::"foodprint"."delivery_status"
    ORDER BY d."id"
    LIMIT 5
  ) premature_preparing;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Existing deliveries already use PREPARING before workflow_version migration (count=%, sampleIds=%)', v_count, v_samples;
  END IF;

  SELECT count(*)::int, string_agg(dup_key, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT (di."delivery_id"::text || ':' || di."ingredient_id"::text || ':' || di."source_facility_id"::text) AS dup_key
    FROM "foodprint"."delivery_items" di
    WHERE di."source_facility_id" IS NOT NULL
    GROUP BY di."delivery_id", di."ingredient_id", di."source_facility_id"
    HAVING count(*) > 1
    ORDER BY di."delivery_id", di."ingredient_id", di."source_facility_id"
    LIMIT 5
  ) dup_nonnull_source;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Duplicate (delivery_id, ingredient_id, source_facility_id) in delivery_items requires review (count=%, sampleKeys=%)', v_count, v_samples;
  END IF;

  SELECT count(*)::int, string_agg(dup_key, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT (di."delivery_id"::text || ':' || di."ingredient_id"::text) AS dup_key
    FROM "foodprint"."delivery_items" di
    WHERE di."source_facility_id" IS NULL
    GROUP BY di."delivery_id", di."ingredient_id"
    HAVING count(*) > 1
    ORDER BY di."delivery_id", di."ingredient_id"
    LIMIT 5
  ) dup_null_ingredient;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Duplicate legacy (delivery_id, ingredient_id) with NULL source_facility_id requires review (count=%, sampleKeys=%)', v_count, v_samples;
  END IF;

  SELECT count(*)::int, string_agg(dup_key, ', ')
  INTO v_count, v_samples
  FROM (
    SELECT (di."delivery_id"::text || ':' || di."supply_request_item_id"::text) AS dup_key
    FROM "foodprint"."delivery_items" di
    WHERE di."source_facility_id" IS NULL
      AND di."supply_request_item_id" IS NOT NULL
    GROUP BY di."delivery_id", di."supply_request_item_id"
    HAVING count(*) > 1
    ORDER BY di."delivery_id", di."supply_request_item_id"
    LIMIT 5
  ) dup_null_request_item;

  IF v_count > 0 THEN
    RAISE EXCEPTION 'Duplicate legacy (delivery_id, supply_request_item_id) with NULL source_facility_id requires review (count=%, sampleKeys=%)', v_count, v_samples;
  END IF;
END $$;

-- Add nullable workflow_version marker (no default, no backfill for legacy records)
ALTER TABLE "foodprint"."deliveries"
  ADD COLUMN "workflow_version" INTEGER;

-- Replace chk_delivery_traceability_version to support workflow_version = 2 while preserving workflow_version IS NULL semantics
ALTER TABLE "foodprint"."deliveries"
  DROP CONSTRAINT "chk_delivery_traceability_version";

ALTER TABLE "foodprint"."deliveries"
  ADD CONSTRAINT "chk_delivery_traceability_version" CHECK (
    (
      "traceability_version" IS NULL
      AND "workflow_version" IS NULL
    )
    OR (
      "traceability_version" IS NOT NULL
      AND "traceability_version" = 1
      AND "creation_mode" IS NOT NULL
      AND "creation_key" IS NOT NULL
      AND "creation_fingerprint" IS NOT NULL
      AND "created_by_user_id" IS NOT NULL
      AND "delivery_no" ~ '^FP-DE-([0-9]{5}|[1-9][0-9]{5,73})$'
      AND "delivery_no" <> 'FP-DE-00000'
      AND "status" NOT IN (
        'CREATED'::"foodprint"."delivery_status",
        'APPROVED'::"foodprint"."delivery_status"
      )
      AND (
        (
          "workflow_version" IS NULL
          AND "status" <> 'PREPARING'::"foodprint"."delivery_status"
          AND "vehicle_plate" IS NOT NULL
          AND char_length(btrim("vehicle_plate")) BETWEEN 1 AND 40
          AND "expected_arrival_at" IS NOT NULL
        )
        OR (
          "workflow_version" IS NOT NULL
          AND "workflow_version" = 2
          AND (
            (
              "status" = 'PREPARING'::"foodprint"."delivery_status"
              AND "expected_arrival_at" IS NULL
              AND "vehicle_plate" IS NULL
            )
            OR (
              "status" IN (
                'IN_TRANSIT'::"foodprint"."delivery_status",
                'ARRIVED'::"foodprint"."delivery_status",
                'PENDING_APPROVAL'::"foodprint"."delivery_status",
                'RECEIVED'::"foodprint"."delivery_status",
                'REJECTED'::"foodprint"."delivery_status"
              )
              AND "expected_arrival_at" IS NOT NULL
              AND "vehicle_plate" IS NOT NULL
              AND char_length(btrim("vehicle_plate")) BETWEEN 1 AND 40
            )
            OR (
              "status" IN (
                'CANCELLED'::"foodprint"."delivery_status",
                'CANCELLED_MEAL'::"foodprint"."delivery_status"
              )
              AND (
                ("expected_arrival_at" IS NULL AND "vehicle_plate" IS NULL)
                OR (
                  "expected_arrival_at" IS NOT NULL
                  AND "vehicle_plate" IS NOT NULL
                  AND char_length(btrim("vehicle_plate")) BETWEEN 1 AND 40
                )
              )
            )
          )
        )
      )
    )
  );

ALTER TABLE "foodprint"."deliveries"
  ADD CONSTRAINT "chk_delivery_workflow_version" CHECK (
    (
      "workflow_version" IS NULL
      AND "status" <> 'PREPARING'::"foodprint"."delivery_status"
    )
    OR (
      "workflow_version" IS NOT NULL
      AND "workflow_version" = 2
      AND "traceability_version" IS NOT NULL
      AND "traceability_version" = 1
      AND (
        (
          "status" = 'PREPARING'::"foodprint"."delivery_status"
          AND "expected_arrival_at" IS NULL
          AND "vehicle_plate" IS NULL
        )
        OR (
          "status" IN (
            'IN_TRANSIT'::"foodprint"."delivery_status",
            'ARRIVED'::"foodprint"."delivery_status",
            'PENDING_APPROVAL'::"foodprint"."delivery_status",
            'RECEIVED'::"foodprint"."delivery_status",
            'REJECTED'::"foodprint"."delivery_status"
          )
          AND "expected_arrival_at" IS NOT NULL
          AND "vehicle_plate" IS NOT NULL
          AND char_length(btrim("vehicle_plate")) BETWEEN 1 AND 40
        )
        OR (
          "status" IN (
            'CANCELLED'::"foodprint"."delivery_status",
            'CANCELLED_MEAL'::"foodprint"."delivery_status"
          )
          AND (
            ("expected_arrival_at" IS NULL AND "vehicle_plate" IS NULL)
            OR (
              "expected_arrival_at" IS NOT NULL
              AND "vehicle_plate" IS NOT NULL
              AND char_length(btrim("vehicle_plate")) BETWEEN 1 AND 40
            )
          )
        )
      )
    )
  );

-- Create all three partial unique indexes BEFORE dropping legacy full uniques
CREATE UNIQUE INDEX "uq_delivery_items_ingredient_source"
  ON "foodprint"."delivery_items"("delivery_id", "ingredient_id", "source_facility_id")
  WHERE ("source_facility_id" IS NOT NULL);

CREATE UNIQUE INDEX "uq_delivery_items_legacy_ingredient"
  ON "foodprint"."delivery_items"("delivery_id", "ingredient_id")
  WHERE ("source_facility_id" IS NULL);

CREATE UNIQUE INDEX "uq_delivery_items_legacy_request_item"
  ON "foodprint"."delivery_items"("delivery_id", "supply_request_item_id")
  WHERE ("source_facility_id" IS NULL);

-- Drop legacy full constraint and full unique index by exact PostgreSQL object kind
ALTER TABLE "foodprint"."delivery_items"
  DROP CONSTRAINT "delivery_items_delivery_id_supply_request_item_id_key";

DROP INDEX "foodprint"."delivery_items_delivery_id_ingredient_id_key";

COMMIT;
