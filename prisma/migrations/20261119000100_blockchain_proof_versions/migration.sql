-- Blockchain proof version tables (BLOCKCHAIN_GLOBAL.md 3.1) for delivery inspection, cooking batch completion and retained samples.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- CreateEnum
CREATE TYPE "foodprint"."retained_sample_event_type" AS ENUM ('STORED', 'DISPOSED');

-- CreateTable
CREATE TABLE "foodprint"."delivery_inspection_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data_hash" VARCHAR(66) NOT NULL,
    "hash_algorithm" VARCHAR(30) NOT NULL DEFAULT 'KECCAK-256',
    "payload_version" SMALLINT NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "previous_version_id" UUID,
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

    CONSTRAINT "delivery_inspection_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foodprint"."cooking_batch_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cooking_batch_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data_hash" VARCHAR(66) NOT NULL,
    "hash_algorithm" VARCHAR(30) NOT NULL DEFAULT 'KECCAK-256',
    "payload_version" SMALLINT NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "previous_version_id" UUID,
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

    CONSTRAINT "cooking_batch_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foodprint"."retained_sample_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "retained_food_sample_id" UUID NOT NULL,
    "event_type" "foodprint"."retained_sample_event_type" NOT NULL,
    "version" INTEGER NOT NULL,
    "data_hash" VARCHAR(66) NOT NULL,
    "hash_algorithm" VARCHAR(30) NOT NULL DEFAULT 'KECCAK-256',
    "payload_version" SMALLINT NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "previous_version_id" UUID,
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

    CONSTRAINT "retained_sample_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_delivery_inspection_versions_status" ON "foodprint"."delivery_inspection_versions"("transaction_status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_delivery_inspection_versions_delivery_version" ON "foodprint"."delivery_inspection_versions"("delivery_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_delivery_inspection_versions_tx_hash" ON "foodprint"."delivery_inspection_versions"("transaction_hash") WHERE (transaction_hash IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_cooking_batch_versions_status" ON "foodprint"."cooking_batch_versions"("transaction_status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cooking_batch_versions_batch_version" ON "foodprint"."cooking_batch_versions"("cooking_batch_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cooking_batch_versions_tx_hash" ON "foodprint"."cooking_batch_versions"("transaction_hash") WHERE (transaction_hash IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_retained_sample_versions_status" ON "foodprint"."retained_sample_versions"("transaction_status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retained_sample_versions_sample_version" ON "foodprint"."retained_sample_versions"("retained_food_sample_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retained_sample_versions_sample_event" ON "foodprint"."retained_sample_versions"("retained_food_sample_id", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "uq_retained_sample_versions_tx_hash" ON "foodprint"."retained_sample_versions"("transaction_hash") WHERE (transaction_hash IS NOT NULL);

-- AddForeignKey
ALTER TABLE "foodprint"."delivery_inspection_versions" ADD CONSTRAINT "delivery_inspection_versions_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "foodprint"."deliveries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."delivery_inspection_versions" ADD CONSTRAINT "delivery_inspection_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."delivery_inspection_versions" ADD CONSTRAINT "delivery_inspection_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "foodprint"."delivery_inspection_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."cooking_batch_versions" ADD CONSTRAINT "cooking_batch_versions_cooking_batch_id_fkey" FOREIGN KEY ("cooking_batch_id") REFERENCES "foodprint"."cooking_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."cooking_batch_versions" ADD CONSTRAINT "cooking_batch_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."cooking_batch_versions" ADD CONSTRAINT "cooking_batch_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "foodprint"."cooking_batch_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."retained_sample_versions" ADD CONSTRAINT "retained_sample_versions_retained_food_sample_id_fkey" FOREIGN KEY ("retained_food_sample_id") REFERENCES "foodprint"."retained_food_samples"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."retained_sample_versions" ADD CONSTRAINT "retained_sample_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."retained_sample_versions" ADD CONSTRAINT "retained_sample_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "foodprint"."retained_sample_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- CheckConstraints
ALTER TABLE "foodprint"."delivery_inspection_versions"
  ADD CONSTRAINT "chk_delivery_inspection_versions_version" CHECK (version >= 1 AND (version = 1) = (previous_version_id IS NULL)),
  ADD CONSTRAINT "chk_delivery_inspection_versions_hash" CHECK (data_hash ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_delivery_inspection_versions_counters" CHECK (payload_version >= 1 AND attempt_count >= 0 AND (block_number IS NULL OR block_number >= 0)),
  ADD CONSTRAINT "chk_delivery_inspection_versions_confirmed" CHECK (transaction_status <> 'CONFIRMED' OR recorded_at IS NOT NULL),
  ADD CONSTRAINT "chk_delivery_inspection_versions_verified" CHECK (verification_status = 'NOT_VERIFIED' OR verified_at IS NOT NULL);

ALTER TABLE "foodprint"."cooking_batch_versions"
  ADD CONSTRAINT "chk_cooking_batch_versions_version" CHECK (version >= 1 AND (version = 1) = (previous_version_id IS NULL)),
  ADD CONSTRAINT "chk_cooking_batch_versions_hash" CHECK (data_hash ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_cooking_batch_versions_counters" CHECK (payload_version >= 1 AND attempt_count >= 0 AND (block_number IS NULL OR block_number >= 0)),
  ADD CONSTRAINT "chk_cooking_batch_versions_confirmed" CHECK (transaction_status <> 'CONFIRMED' OR recorded_at IS NOT NULL),
  ADD CONSTRAINT "chk_cooking_batch_versions_verified" CHECK (verification_status = 'NOT_VERIFIED' OR verified_at IS NOT NULL);

ALTER TABLE "foodprint"."retained_sample_versions"
  ADD CONSTRAINT "chk_retained_sample_versions_version" CHECK (version >= 1 AND (version = 1) = (previous_version_id IS NULL)),
  ADD CONSTRAINT "chk_retained_sample_versions_event" CHECK ((event_type = 'STORED' AND version = 1) OR (event_type = 'DISPOSED' AND version = 2)),
  ADD CONSTRAINT "chk_retained_sample_versions_hash" CHECK (data_hash ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_retained_sample_versions_counters" CHECK (payload_version >= 1 AND attempt_count >= 0 AND (block_number IS NULL OR block_number >= 0)),
  ADD CONSTRAINT "chk_retained_sample_versions_confirmed" CHECK (transaction_status <> 'CONFIRMED' OR recorded_at IS NOT NULL),
  ADD CONSTRAINT "chk_retained_sample_versions_verified" CHECK (verification_status = 'NOT_VERIFIED' OR verified_at IS NOT NULL);
COMMIT;
