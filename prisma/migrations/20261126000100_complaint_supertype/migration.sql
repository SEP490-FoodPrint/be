-- Bảng cha khiếu nại + luồng ticket chung (specs/complaint-supertype).
-- Chưa có dữ liệu khiếu nại thật (Q27): không chuyển dữ liệu; dừng nếu bảng cũ còn dòng.
-- Không có function/trigger; máy trạng thái do backend kiểm soát, CHECK chặn trạng thái không nhất quán.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE "foodprint"."meal_complaints", "foodprint"."ingredient_quality_feedback" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "foodprint"."meal_complaints")
     OR EXISTS (SELECT 1 FROM "foodprint"."ingredient_quality_feedback") THEN
    RAISE EXCEPTION 'complaint_supertype: meal_complaints/ingredient_quality_feedback còn dữ liệu; cần xử lý thủ công có ủy quyền trước khi migrate';
  END IF;
END
$$;

DROP TABLE "foodprint"."meal_complaints";
DROP TABLE "foodprint"."ingredient_quality_feedback";
DROP TYPE "foodprint"."complaint_status";
DROP TYPE "foodprint"."ingredient_quality_feedback_status";

CREATE TYPE "foodprint"."complaint_kind" AS ENUM ('MEAL', 'INGREDIENT', 'AUTHORITY', 'SYSTEM');
CREATE TYPE "foodprint"."complaint_ticket_status" AS ENUM ('NEW', 'IN_PROGRESS', 'REOPENED', 'RESOLVED', 'CLOSED');
CREATE TYPE "foodprint"."complaint_close_reason" AS ENUM ('SATISFIED', 'ESCALATED', 'AUTO_CLOSED');
CREATE TYPE "foodprint"."complaint_comment_side" AS ENUM ('REQUESTER', 'HANDLER');
CREATE TYPE "foodprint"."complaint_comment_type" AS ENUM ('MESSAGE', 'RESOLUTION', 'REOPEN_NOTE', 'ESCALATION_NOTE');
CREATE TYPE "foodprint"."complaint_actor_type" AS ENUM ('USER', 'SYSTEM');

CREATE TABLE "foodprint"."complaints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "foodprint"."complaint_kind" NOT NULL,
    "code" VARCHAR(25) NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_role_code" VARCHAR(60) NOT NULL,
    "sender_school_id" UUID,
    "sender_supplier_id" UUID,
    "sender_commune_food_safety_unit_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "foodprint"."complaint_ticket_status" NOT NULL DEFAULT 'NEW',
    "last_resolved_at" TIMESTAMPTZ(6),
    "resolved_count" INTEGER NOT NULL DEFAULT 0,
    "close_reason" "foodprint"."complaint_close_reason",
    "closed_at" TIMESTAMPTZ(6),
    "closed_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaints_code_format" CHECK (
      ("code" ~ '^FP-[A-Z]{2}-[0-9]{5}$' AND "code" !~ '-00000$')
      OR "code" ~ '^FP-CP-([0-9]{5}|[1-9][0-9]{5,18})$'
    ),
    CONSTRAINT "complaints_code_kind" CHECK (
      ("kind" = 'MEAL' AND "code" LIKE 'FP-MC-%')
      OR ("kind" = 'INGREDIENT' AND "code" LIKE 'FP-CP-%')
      OR ("kind" = 'AUTHORITY' AND "code" LIKE 'FP-AC-%')
      OR ("kind" = 'SYSTEM' AND "code" LIKE 'FP-SC-%')
    ),
    CONSTRAINT "complaints_sender_org" CHECK (
      num_nonnulls("sender_school_id", "sender_supplier_id", "sender_commune_food_safety_unit_id") <= 1
    ),
    CONSTRAINT "complaints_title_present" CHECK (length(btrim("title")) > 0),
    CONSTRAINT "complaints_description_present" CHECK (length(btrim("description")) > 0),
    CONSTRAINT "complaints_resolved_count_range" CHECK ("resolved_count" >= 0),
    CONSTRAINT "complaints_resolved_timestamp" CHECK (
      "status" <> 'RESOLVED' OR "last_resolved_at" IS NOT NULL
    ),
    CONSTRAINT "complaints_closed_fields" CHECK (
      ("status" = 'CLOSED') = ("close_reason" IS NOT NULL AND "closed_at" IS NOT NULL)
    ),
    CONSTRAINT "complaints_closed_actor" CHECK (
      "close_reason" IS NULL OR (("close_reason" = 'AUTO_CLOSED') = ("closed_by_user_id" IS NULL))
    ),
    CONSTRAINT "complaints_closed_by_requires_close" CHECK (
      "closed_by_user_id" IS NULL OR "close_reason" IS NOT NULL
    ),
    CONSTRAINT "complaints_escalated_kind" CHECK (
      "close_reason" IS DISTINCT FROM 'ESCALATED' OR "kind" = 'MEAL'
    )
);

CREATE UNIQUE INDEX "complaints_code_key" ON "foodprint"."complaints"("code");
CREATE UNIQUE INDEX "uq_complaints_id_kind" ON "foodprint"."complaints"("id", "kind");
CREATE INDEX "idx_complaints_kind_submitted" ON "foodprint"."complaints"("kind", "submitted_at" DESC, "id");
CREATE INDEX "idx_complaints_sender_submitted" ON "foodprint"."complaints"("sender_user_id", "submitted_at" DESC);
CREATE INDEX "idx_complaints_status_submitted" ON "foodprint"."complaints"("status", "submitted_at" DESC);
CREATE INDEX "idx_complaints_resolved_due" ON "foodprint"."complaints"("last_resolved_at") WHERE "status" = 'RESOLVED';

ALTER TABLE "foodprint"."complaints"
  ADD CONSTRAINT "complaints_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaints_sender_role_code_fkey" FOREIGN KEY ("sender_role_code") REFERENCES "foodprint"."roles"("code") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaints_sender_school_id_fkey" FOREIGN KEY ("sender_school_id") REFERENCES "foodprint"."schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaints_sender_supplier_id_fkey" FOREIGN KEY ("sender_supplier_id") REFERENCES "foodprint"."suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaints_sender_commune_food_safety_unit_id_fkey" FOREIGN KEY ("sender_commune_food_safety_unit_id") REFERENCES "foodprint"."commune_food_safety_units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaints_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- C01/C03: khiếu nại suất ăn (bảng con, FK tổ hợp về bảng cha).
CREATE TABLE "foodprint"."meal_complaints" (
    "id" UUID NOT NULL,
    "kind" "foodprint"."complaint_kind" NOT NULL DEFAULT 'MEAL',
    "school_id" UUID NOT NULL,
    "daily_meal_portion_id" UUID NOT NULL,
    "complaint_type" "foodprint"."meal_complaint_type" NOT NULL,

    CONSTRAINT "meal_complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meal_complaints_kind" CHECK ("kind" = 'MEAL')
);

-- Prisma cần unique (id, kind) cho quan hệ 1-1 với bảng cha.
CREATE UNIQUE INDEX "uq_meal_complaints_id_kind" ON "foodprint"."meal_complaints"("id", "kind");
CREATE INDEX "idx_meal_complaints_daily_meal_portion" ON "foodprint"."meal_complaints"("daily_meal_portion_id");
CREATE INDEX "idx_meal_complaints_school" ON "foodprint"."meal_complaints"("school_id");

ALTER TABLE "foodprint"."meal_complaints"
  ADD CONSTRAINT "meal_complaints_id_kind_fkey" FOREIGN KEY ("id", "kind") REFERENCES "foodprint"."complaints"("id", "kind") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "meal_complaints_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "foodprint"."schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "meal_complaints_daily_meal_portion_id_fkey" FOREIGN KEY ("daily_meal_portion_id") REFERENCES "foodprint"."daily_meal_portions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- C02: phản ánh chất lượng nguyên liệu (bảng con).
CREATE TABLE "foodprint"."ingredient_quality_feedback" (
    "id" UUID NOT NULL,
    "kind" "foodprint"."complaint_kind" NOT NULL DEFAULT 'INGREDIENT',
    "delivery_id" UUID NOT NULL,
    "ingredient_lot_id" UUID,

    CONSTRAINT "ingredient_quality_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ingredient_quality_feedback_kind" CHECK ("kind" = 'INGREDIENT')
);

CREATE UNIQUE INDEX "uq_ingredient_quality_feedback_id_kind" ON "foodprint"."ingredient_quality_feedback"("id", "kind");
CREATE INDEX "idx_ingredient_quality_feedback_delivery" ON "foodprint"."ingredient_quality_feedback"("delivery_id");
CREATE INDEX "idx_ingredient_quality_feedback_lot" ON "foodprint"."ingredient_quality_feedback"("ingredient_lot_id");

ALTER TABLE "foodprint"."ingredient_quality_feedback"
  ADD CONSTRAINT "ingredient_quality_feedback_id_kind_fkey" FOREIGN KEY ("id", "kind") REFERENCES "foodprint"."complaints"("id", "kind") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ingredient_quality_feedback_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "foodprint"."deliveries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ingredient_quality_feedback_ingredient_lot_id_fkey" FOREIGN KEY ("ingredient_lot_id") REFERENCES "foodprint"."ingredient_lots"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Bình luận hai chiều, append-only.
CREATE TABLE "foodprint"."complaint_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "author_role_code" VARCHAR(60) NOT NULL,
    "author_side" "foodprint"."complaint_comment_side" NOT NULL,
    "comment_type" "foodprint"."complaint_comment_type" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaint_comments_content_present" CHECK (length(btrim("content")) > 0),
    CONSTRAINT "complaint_comments_resolution_side" CHECK (
      "comment_type" <> 'RESOLUTION' OR "author_side" = 'HANDLER'
    ),
    CONSTRAINT "complaint_comments_requester_note_side" CHECK (
      "comment_type" NOT IN ('REOPEN_NOTE', 'ESCALATION_NOTE') OR "author_side" = 'REQUESTER'
    )
);

CREATE INDEX "idx_complaint_comments_complaint" ON "foodprint"."complaint_comments"("complaint_id", "created_at", "id");

ALTER TABLE "foodprint"."complaint_comments"
  ADD CONSTRAINT "complaint_comments_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "foodprint"."complaints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaint_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaint_comments_author_role_code_fkey" FOREIGN KEY ("author_role_code") REFERENCES "foodprint"."roles"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Lịch sử trạng thái, append-only.
CREATE TABLE "foodprint"."complaint_status_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_id" UUID NOT NULL,
    "from_status" "foodprint"."complaint_ticket_status",
    "to_status" "foodprint"."complaint_ticket_status" NOT NULL,
    "close_reason" "foodprint"."complaint_close_reason",
    "actor_type" "foodprint"."complaint_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_role_code" VARCHAR(60),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_status_histories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaint_status_histories_actor" CHECK (
      ("actor_type" = 'SYSTEM') = ("actor_user_id" IS NULL)
      AND ("actor_user_id" IS NULL) = ("actor_role_code" IS NULL)
    ),
    CONSTRAINT "complaint_status_histories_close_reason" CHECK (
      ("to_status" = 'CLOSED') = ("close_reason" IS NOT NULL)
    )
);

CREATE INDEX "idx_complaint_status_histories_complaint" ON "foodprint"."complaint_status_histories"("complaint_id", "created_at", "id");

ALTER TABLE "foodprint"."complaint_status_histories"
  ADD CONSTRAINT "complaint_status_histories_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "foodprint"."complaints"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaint_status_histories_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "foodprint"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "complaint_status_histories_actor_role_code_fkey" FOREIGN KEY ("actor_role_code") REFERENCES "foodprint"."roles"("code") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
