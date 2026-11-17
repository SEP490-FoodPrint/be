-- One table for every blockchain proof (specs/unified-blockchain-proofs).
-- Replaces the four per-entity version tables and the unused traceability_anchors.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Refuse to drop proofs: the old tables must be empty (checked on Azure on 2026-11-17).
LOCK TABLE
  "foodprint"."delivery_inspection_versions",
  "foodprint"."cooking_batch_versions",
  "foodprint"."retained_sample_versions",
  "foodprint"."registration_request_versions",
  "foodprint"."traceability_anchors"
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "foodprint"."delivery_inspection_versions")
    OR EXISTS (SELECT 1 FROM "foodprint"."cooking_batch_versions")
    OR EXISTS (SELECT 1 FROM "foodprint"."retained_sample_versions")
    OR EXISTS (SELECT 1 FROM "foodprint"."registration_request_versions")
    OR EXISTS (SELECT 1 FROM "foodprint"."traceability_anchors") THEN
    RAISE EXCEPTION 'Old blockchain proof tables are not empty; migrate their rows before unifying';
  END IF;
END $$;

DROP TABLE "foodprint"."delivery_inspection_versions";
DROP TABLE "foodprint"."cooking_batch_versions";
DROP TABLE "foodprint"."retained_sample_versions";
DROP TABLE "foodprint"."registration_request_versions";
DROP TABLE "foodprint"."traceability_anchors";
DROP TYPE "foodprint"."retained_sample_event_type";
DROP TYPE "foodprint"."registration_proof_event_type";

-- CreateEnum
CREATE TYPE "foodprint"."blockchain_proof_entity_type" AS ENUM ('REGISTRATION', 'DELIVERY_DECLARATION', 'DELIVERY_INSPECTION', 'COOKING_BATCH', 'RETAINED_SAMPLE', 'MEAL_DISTRIBUTION');

-- CreateEnum
CREATE TYPE "foodprint"."blockchain_proof_event_type" AS ENUM ('SUBMITTED', 'APPROVED', 'DECLARED', 'INSPECTED', 'COMPLETED', 'STORED', 'DISPOSED', 'DISTRIBUTED');

-- CreateTable
CREATE TABLE "foodprint"."blockchain_proofs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "foodprint"."blockchain_proof_entity_type" NOT NULL,
    "event_type" "foodprint"."blockchain_proof_event_type" NOT NULL,
    "version" INTEGER NOT NULL,
    "previous_proof_id" UUID,
    "registration_request_id" UUID,
    "delivery_id" UUID,
    "cooking_batch_id" UUID,
    "retained_food_sample_id" UUID,
    "school_id" UUID,
    "subject_date" DATE,
    "record_id" VARCHAR(66) NOT NULL,
    "data_hash" VARCHAR(66) NOT NULL,
    "hash_algorithm" VARCHAR(30) NOT NULL DEFAULT 'KECCAK-256',
    "payload_version" SMALLINT NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "change_reason" VARCHAR(255),
    "network_name" VARCHAR(80) NOT NULL,
    "contract_address" VARCHAR(100),
    "transaction_hash" VARCHAR(100),
    "block_number" BIGINT,
    "transaction_status" "foodprint"."blockchain_anchor_status" NOT NULL DEFAULT 'PREPARED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "recorded_at" TIMESTAMPTZ(6),
    "verification_status" "foodprint"."blockchain_verification_status" NOT NULL DEFAULT 'NOT_VERIFIED',
    "verification_result" VARCHAR(500),
    "verified_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_record_id" ON "foodprint"."blockchain_proofs"("record_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_registration_version" ON "foodprint"."blockchain_proofs"("registration_request_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_registration_approved" ON "foodprint"."blockchain_proofs"("registration_request_id") WHERE (event_type = 'APPROVED');

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_delivery_version" ON "foodprint"."blockchain_proofs"("delivery_id", "entity_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_cooking_batch_version" ON "foodprint"."blockchain_proofs"("cooking_batch_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_sample_version" ON "foodprint"."blockchain_proofs"("retained_food_sample_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_sample_event" ON "foodprint"."blockchain_proofs"("retained_food_sample_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_distribution_version" ON "foodprint"."blockchain_proofs"("school_id", "subject_date", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_blockchain_proofs_tx_hash" ON "foodprint"."blockchain_proofs"("transaction_hash") WHERE (transaction_hash IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_blockchain_proofs_status" ON "foodprint"."blockchain_proofs"("transaction_status");

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_previous_proof_id_fkey" FOREIGN KEY ("previous_proof_id") REFERENCES "foodprint"."blockchain_proofs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_registration_request_id_fkey" FOREIGN KEY ("registration_request_id") REFERENCES "foodprint"."registration_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "foodprint"."deliveries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_cooking_batch_id_fkey" FOREIGN KEY ("cooking_batch_id") REFERENCES "foodprint"."cooking_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_retained_food_sample_id_fkey" FOREIGN KEY ("retained_food_sample_id") REFERENCES "foodprint"."retained_food_samples"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "foodprint"."schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."blockchain_proofs" ADD CONSTRAINT "blockchain_proofs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "foodprint"."blockchain_proofs"
  -- Exactly the subject link of its entity type (exclusive arc).
  ADD CONSTRAINT "chk_blockchain_proofs_subject" CHECK (
    (entity_type = 'REGISTRATION') = (registration_request_id IS NOT NULL)
    AND (entity_type IN ('DELIVERY_DECLARATION', 'DELIVERY_INSPECTION')) = (delivery_id IS NOT NULL)
    AND (entity_type = 'COOKING_BATCH') = (cooking_batch_id IS NOT NULL)
    AND (entity_type = 'RETAINED_SAMPLE') = (retained_food_sample_id IS NOT NULL)
    AND (entity_type = 'MEAL_DISTRIBUTION') = (school_id IS NOT NULL)
    AND (entity_type = 'MEAL_DISTRIBUTION') = (subject_date IS NOT NULL)
  ),
  ADD CONSTRAINT "chk_blockchain_proofs_event" CHECK (
    (entity_type = 'REGISTRATION' AND event_type IN ('SUBMITTED', 'APPROVED'))
    OR (entity_type = 'DELIVERY_DECLARATION' AND event_type = 'DECLARED' AND version = 1)
    OR (entity_type = 'DELIVERY_INSPECTION' AND event_type = 'INSPECTED' AND version = 1)
    OR (entity_type = 'COOKING_BATCH' AND event_type = 'COMPLETED' AND version = 1)
    OR (entity_type = 'RETAINED_SAMPLE' AND ((event_type = 'STORED' AND version = 1) OR (event_type = 'DISPOSED' AND version = 2)))
    OR (entity_type = 'MEAL_DISTRIBUTION' AND event_type = 'DISTRIBUTED' AND version = 1)
  ),
  ADD CONSTRAINT "chk_blockchain_proofs_version" CHECK (version >= 1 AND (version = 1) = (previous_proof_id IS NULL)),
  ADD CONSTRAINT "chk_blockchain_proofs_hash" CHECK (data_hash ~ '^0x[0-9a-f]{64}$' AND record_id ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_blockchain_proofs_counters" CHECK (payload_version >= 1 AND attempt_count >= 0 AND (block_number IS NULL OR block_number >= 0)),
  ADD CONSTRAINT "chk_blockchain_proofs_confirmed" CHECK (transaction_status <> 'CONFIRMED' OR recorded_at IS NOT NULL),
  ADD CONSTRAINT "chk_blockchain_proofs_verified" CHECK (verification_status = 'NOT_VERIFIED' OR verified_at IS NOT NULL);

COMMIT;
