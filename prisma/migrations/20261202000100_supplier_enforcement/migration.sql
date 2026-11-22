-- PR6b: yêu cầu chế tài NCC, hạn chế hiệu lực, tài khoản bị khóa và lịch sử trạng thái tài khoản
-- (specs/supplier-enforcement). Không có function/trigger: backend điều phối duyệt/thực thi.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "foodprint"."supplier_enforcement_action_type" AS ENUM ('PAUSE_INTAKE', 'LOCK_ACCOUNT', 'RESTORE');
CREATE TYPE "foodprint"."supplier_enforcement_decision_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "foodprint"."supplier_enforcement_execution_status" AS ENUM ('NOT_APPLIED', 'APPLIED', 'FAILED');
CREATE TYPE "foodprint"."supplier_restriction_type" AS ENUM ('PAUSE_INTAKE', 'ACCOUNT_LOCKED');

CREATE TABLE "foodprint"."supplier_enforcement_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "action_type" "foodprint"."supplier_enforcement_action_type" NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "request_reason" TEXT NOT NULL,
    "evidence_inspection_id" UUID,
    "decision_status" "foodprint"."supplier_enforcement_decision_status" NOT NULL DEFAULT 'PENDING',
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "execution_status" "foodprint"."supplier_enforcement_execution_status" NOT NULL DEFAULT 'NOT_APPLIED',
    "executed_at" TIMESTAMPTZ(6),
    "execution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_enforcement_actions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_enforcement_actions_lock_evidence" CHECK ("action_type" <> 'LOCK_ACCOUNT' OR "evidence_inspection_id" IS NOT NULL),
    CONSTRAINT "supplier_enforcement_actions_reason" CHECK (length(btrim("request_reason")) > 0),
    -- PENDING ⇔ chưa có người/thời điểm quyết định; REJECTED cần ghi chú.
    CONSTRAINT "supplier_enforcement_actions_decision" CHECK (
      ("decision_status" = 'PENDING') = ("decided_by_user_id" IS NULL)
      AND ("decision_status" = 'PENDING') = ("decided_at" IS NULL)
      AND ("decision_status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) > 0)
    ),
    -- Chỉ yêu cầu APPROVED mới có kết quả thực thi; FAILED cần ghi chú.
    CONSTRAINT "supplier_enforcement_actions_execution" CHECK (
      ("execution_status" = 'NOT_APPLIED') = ("decision_status" <> 'APPROVED')
      AND ("execution_status" = 'NOT_APPLIED') = ("executed_at" IS NULL)
      AND ("execution_status" <> 'FAILED' OR length(btrim(coalesce("execution_note", ''))) > 0)
    )
);

CREATE UNIQUE INDEX "supplier_enforcement_actions_id_supplier_id_incident_id_key" ON "foodprint"."supplier_enforcement_actions"("id", "supplier_id", "incident_id");
CREATE UNIQUE INDEX "uq_supplier_enforcement_actions_pending" ON "foodprint"."supplier_enforcement_actions"("incident_id", "supplier_id", "action_type") WHERE ("decision_status" = 'PENDING');
CREATE INDEX "idx_supplier_enforcement_actions_queue" ON "foodprint"."supplier_enforcement_actions"("decision_status", "created_at");
CREATE INDEX "idx_supplier_enforcement_actions_supplier" ON "foodprint"."supplier_enforcement_actions"("supplier_id", "created_at");

ALTER TABLE "foodprint"."supplier_enforcement_actions"
  ADD CONSTRAINT "supplier_enforcement_actions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "foodprint"."food_safety_incidents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_enforcement_actions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "foodprint"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_enforcement_actions_evidence_inspection_fkey" FOREIGN KEY ("incident_id", "evidence_inspection_id") REFERENCES "foodprint"."food_safety_inspections"("incident_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_enforcement_actions_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_enforcement_actions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "foodprint"."supplier_restrictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplier_id" UUID NOT NULL,
    "incident_id" UUID,
    "restriction_type" "foodprint"."supplier_restriction_type" NOT NULL,
    "source_action_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "activated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_at" TIMESTAMPTZ(6),
    "lifted_by_action_id" UUID,

    CONSTRAINT "supplier_restrictions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_restrictions_source" CHECK ("incident_id" IS NULL OR "source_action_id" IS NOT NULL),
    CONSTRAINT "supplier_restrictions_lifted" CHECK (
      "is_active" = ("lifted_at" IS NULL)
      AND ("is_active" = false OR "lifted_by_action_id" IS NULL)
    )
);

-- Tối đa một hạn chế hiệu lực mỗi loại cho mỗi sự cố và một hạn chế thủ công (incident_id NULL) mỗi loại.
CREATE UNIQUE INDEX "uq_supplier_restrictions_active" ON "foodprint"."supplier_restrictions"("supplier_id", "incident_id", "restriction_type") NULLS NOT DISTINCT WHERE "is_active";
CREATE INDEX "idx_supplier_restrictions_incident" ON "foodprint"."supplier_restrictions"("incident_id");

ALTER TABLE "foodprint"."supplier_restrictions"
  ADD CONSTRAINT "supplier_restrictions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "foodprint"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_restrictions_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "foodprint"."food_safety_incidents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_restrictions_source_action_fkey" FOREIGN KEY ("source_action_id", "supplier_id", "incident_id") REFERENCES "foodprint"."supplier_enforcement_actions"("id", "supplier_id", "incident_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_restrictions_lifted_by_action_fkey" FOREIGN KEY ("lifted_by_action_id", "supplier_id", "incident_id") REFERENCES "foodprint"."supplier_enforcement_actions"("id", "supplier_id", "incident_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "foodprint"."supplier_restriction_locked_accounts" (
    "restriction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "previous_status" "foodprint"."account_status" NOT NULL,
    "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlocked_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_restriction_locked_accounts_pkey" PRIMARY KEY ("restriction_id", "user_id"),
    CONSTRAINT "supplier_restriction_locked_accounts_previous_status" CHECK ("previous_status" = 'ACTIVE'),
    CONSTRAINT "supplier_restriction_locked_accounts_unlocked" CHECK ("unlocked_at" IS NULL OR "unlocked_at" >= "locked_at")
);

CREATE INDEX "idx_supplier_restriction_locked_accounts_user" ON "foodprint"."supplier_restriction_locked_accounts"("user_id");

ALTER TABLE "foodprint"."supplier_restriction_locked_accounts"
  ADD CONSTRAINT "supplier_restriction_locked_accounts_restriction_id_fkey" FOREIGN KEY ("restriction_id") REFERENCES "foodprint"."supplier_restrictions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "supplier_restriction_locked_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "foodprint"."account_status_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "supplier_id" UUID,
    "from_status" "foodprint"."account_status" NOT NULL,
    "to_status" "foodprint"."account_status" NOT NULL,
    "reason" TEXT NOT NULL,
    "source_action_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_status_histories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_status_histories_change" CHECK ("from_status" <> "to_status"),
    CONSTRAINT "account_status_histories_reason" CHECK (length(btrim("reason")) > 0)
);

CREATE INDEX "idx_account_status_histories_user" ON "foodprint"."account_status_histories"("user_id", "created_at");
CREATE INDEX "idx_account_status_histories_action" ON "foodprint"."account_status_histories"("source_action_id");

ALTER TABLE "foodprint"."account_status_histories"
  ADD CONSTRAINT "account_status_histories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "account_status_histories_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "foodprint"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "account_status_histories_source_action_id_fkey" FOREIGN KEY ("source_action_id") REFERENCES "foodprint"."supplier_enforcement_actions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "account_status_histories_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
