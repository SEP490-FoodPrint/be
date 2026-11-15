-- Create composite unique on (supplier_id, delivery_no) before dropping global unique
CREATE UNIQUE INDEX "uq_deliveries_supplier_no"
  ON "foodprint"."deliveries"("supplier_id", "delivery_no");

ALTER TABLE "foodprint"."deliveries"
  DROP CONSTRAINT IF EXISTS "deliveries_delivery_no_key";

DROP INDEX IF EXISTS "foodprint"."deliveries_delivery_no_key";

-- Extend foodprint.deliveries for supplier traceability version (nullable for legacy records)
ALTER TABLE "foodprint"."deliveries"
  ADD COLUMN "traceability_version" INTEGER;

ALTER TABLE "foodprint"."deliveries"
  ADD CONSTRAINT "chk_delivery_traceability_version" CHECK (
    "traceability_version" IS NULL
    OR (
      "traceability_version" = 1
      AND "creation_mode" IS NOT NULL
      AND "creation_key" IS NOT NULL
      AND "creation_fingerprint" IS NOT NULL
      AND "created_by_user_id" IS NOT NULL
      AND "vehicle_plate" IS NOT NULL
      AND char_length(btrim("vehicle_plate")) BETWEEN 1 AND 40
      AND "expected_arrival_at" IS NOT NULL
      AND "delivery_no" ~ '^FP-DE-([0-9]{5}|[1-9][0-9]{5,73})$'
      AND "delivery_no" <> 'FP-DE-00000'
      AND "status" NOT IN ('CREATED'::foodprint.delivery_status, 'APPROVED'::foodprint.delivery_status)
    )
  );

-- Extend foodprint.delivery_items for source snapshot and public QR traceability (nullable for legacy items)
ALTER TABLE "foodprint"."delivery_items"
  ADD COLUMN "source_facility_id" UUID,
  ADD COLUMN "source_facility_name_snapshot" VARCHAR(255),
  ADD COLUMN "source_facility_code_snapshot" VARCHAR(80),
  ADD COLUMN "ingredient_name_snapshot" VARCHAR(255),
  ADD COLUMN "qr_token" VARCHAR(160),
  ADD COLUMN "qr_url" VARCHAR(2048);

CREATE UNIQUE INDEX "delivery_items_qr_token_key"
  ON "foodprint"."delivery_items"("qr_token");

CREATE INDEX "idx_delivery_items_source_facility"
  ON "foodprint"."delivery_items"("source_facility_id");

ALTER TABLE "foodprint"."delivery_items"
  ADD CONSTRAINT "delivery_items_source_facility_id_fkey"
    FOREIGN KEY ("source_facility_id")
    REFERENCES "foodprint"."source_facilities"("id")
    ON DELETE RESTRICT
    ON UPDATE NO ACTION;

ALTER TABLE "foodprint"."delivery_items"
  ADD CONSTRAINT "chk_delivery_item_v1_metadata" CHECK (
    (
      "source_facility_id" IS NULL
      AND "source_facility_name_snapshot" IS NULL
      AND "source_facility_code_snapshot" IS NULL
      AND "ingredient_name_snapshot" IS NULL
      AND "qr_token" IS NULL
      AND "qr_url" IS NULL
    )
    OR (
      "source_facility_id" IS NOT NULL
      AND "source_facility_name_snapshot" IS NOT NULL
      AND btrim("source_facility_name_snapshot") <> ''
      AND ("source_facility_code_snapshot" IS NULL OR btrim("source_facility_code_snapshot") <> '')
      AND "ingredient_name_snapshot" IS NOT NULL
      AND btrim("ingredient_name_snapshot") <> ''
      AND "qr_token" IS NOT NULL
      AND "qr_url" IS NOT NULL
      AND btrim("qr_url") <> ''
    )
  );

ALTER TABLE "foodprint"."delivery_items"
  ADD CONSTRAINT "chk_delivery_item_qr_token_format" CHECK (
    "qr_token" IS NULL OR "qr_token" ~ '^[0-9a-f]{64}$'
  );
