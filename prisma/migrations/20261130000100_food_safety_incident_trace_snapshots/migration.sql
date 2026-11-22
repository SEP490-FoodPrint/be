-- PR5b: snapshot truy xuất sự cố ATTP (specs/food-safety-incident-trace-snapshots).
-- Snapshot bất biến theo phiên bản, mức đầy đủ truy xuất trên hồ sơ, bản chuyển trỏ tới snapshot đã gửi.
-- Không có function/trigger; payload, hash và phiên bản do backend tạo.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "foodprint"."trace_completeness" AS ENUM ('COMPLETE', 'PARTIAL', 'MISSING');

-- Hồ sơ đã chuyển trước PR5b giữ NULL tới snapshot đầu tiên; chỉ buộc NULL khi chưa gửi ATTP.
ALTER TABLE "foodprint"."food_safety_incidents"
  ADD COLUMN "trace_completeness" "foodprint"."trace_completeness",
  ADD CONSTRAINT "food_safety_incidents_trace_completeness" CHECK (
    "status" NOT IN ('PENDING_SCHOOL_REVIEW', 'CANCELLED_BY_SCHOOL') OR "trace_completeness" IS NULL
  );

CREATE TABLE "foodprint"."food_safety_incident_trace_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "completeness" "foodprint"."trace_completeness" NOT NULL,
    "missing_reasons" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_version" INTEGER NOT NULL DEFAULT 1,
    "hash_algorithm" VARCHAR(20) NOT NULL DEFAULT 'KECCAK-256',
    "payload_hash" VARCHAR(128) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_safety_incident_trace_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "food_safety_incident_trace_snapshots_version" CHECK ("version" >= 1 AND "payload_version" >= 1),
    CONSTRAINT "food_safety_incident_trace_snapshots_hash" CHECK (
      "hash_algorithm" = 'KECCAK-256' AND "payload_hash" ~ '^0x[0-9a-f]{64}$'
    ),
    CONSTRAINT "food_safety_incident_trace_snapshots_payload" CHECK (jsonb_typeof("payload") = 'object'),
    -- Lý do thiếu là mảng; rỗng ⇔ COMPLETE.
    CONSTRAINT "food_safety_incident_trace_snapshots_missing" CHECK (
      CASE WHEN jsonb_typeof("missing_reasons") = 'array'
        THEN ("completeness" = 'COMPLETE') = (jsonb_array_length("missing_reasons") = 0)
        ELSE FALSE
      END
    )
);

CREATE UNIQUE INDEX "food_safety_incident_trace_snapshots_incident_id_version_key" ON "foodprint"."food_safety_incident_trace_snapshots"("incident_id", "version");
CREATE UNIQUE INDEX "food_safety_incident_trace_snapshots_incident_id_id_key" ON "foodprint"."food_safety_incident_trace_snapshots"("incident_id", "id");

ALTER TABLE "foodprint"."food_safety_incident_trace_snapshots"
  ADD CONSTRAINT "food_safety_incident_trace_snapshots_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "foodprint"."food_safety_incidents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "food_safety_incident_trace_snapshots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Bản chuyển cũ: NULL. FK tổ hợp bảo đảm snapshot thuộc cùng hồ sơ.
ALTER TABLE "foodprint"."food_safety_report_forwardings"
  ADD COLUMN "trace_snapshot_id" UUID,
  ADD CONSTRAINT "food_safety_report_forwardings_trace_snapshot_fkey" FOREIGN KEY ("incident_id", "trace_snapshot_id") REFERENCES "foodprint"."food_safety_incident_trace_snapshots"("incident_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "idx_food_safety_forwardings_trace_snapshot" ON "foodprint"."food_safety_report_forwardings"("trace_snapshot_id") WHERE "trace_snapshot_id" IS NOT NULL;

COMMIT;
