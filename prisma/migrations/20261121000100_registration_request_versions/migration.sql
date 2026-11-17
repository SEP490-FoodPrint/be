-- Blockchain proof versions (BLOCKCHAIN_GLOBAL.md 3.1) for supplier/school registration documents (UC-01, UC-02).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- CreateEnum
CREATE TYPE "foodprint"."registration_proof_event_type" AS ENUM ('SUBMITTED', 'APPROVED');

-- CreateTable
CREATE TABLE "foodprint"."registration_request_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "registration_request_id" UUID NOT NULL,
    "event_type" "foodprint"."registration_proof_event_type" NOT NULL,
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

    CONSTRAINT "registration_request_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_registration_request_versions_status" ON "foodprint"."registration_request_versions"("transaction_status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_registration_request_versions_request_version" ON "foodprint"."registration_request_versions"("registration_request_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "uq_registration_request_versions_approved" ON "foodprint"."registration_request_versions"("registration_request_id") WHERE (event_type = 'APPROVED');

-- CreateIndex
CREATE UNIQUE INDEX "uq_registration_request_versions_tx_hash" ON "foodprint"."registration_request_versions"("transaction_hash") WHERE (transaction_hash IS NOT NULL);

-- AddForeignKey
ALTER TABLE "foodprint"."registration_request_versions" ADD CONSTRAINT "registration_request_versions_registration_request_id_fkey" FOREIGN KEY ("registration_request_id") REFERENCES "foodprint"."registration_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."registration_request_versions" ADD CONSTRAINT "registration_request_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."registration_request_versions" ADD CONSTRAINT "registration_request_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "foodprint"."registration_request_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "foodprint"."registration_request_versions"
  ADD CONSTRAINT "chk_registration_request_versions_version" CHECK (version >= 1 AND (version = 1) = (previous_version_id IS NULL)),
  ADD CONSTRAINT "chk_registration_request_versions_event" CHECK (event_type = 'SUBMITTED' OR previous_version_id IS NOT NULL),
  ADD CONSTRAINT "chk_registration_request_versions_hash" CHECK (data_hash ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT "chk_registration_request_versions_counters" CHECK (payload_version >= 1 AND attempt_count >= 0 AND (block_number IS NULL OR block_number >= 0)),
  ADD CONSTRAINT "chk_registration_request_versions_confirmed" CHECK (transaction_status <> 'CONFIRMED' OR recorded_at IS NOT NULL),
  ADD CONSTRAINT "chk_registration_request_versions_verified" CHECK (verification_status = 'NOT_VERIFIED' OR verified_at IS NOT NULL);

COMMIT;
