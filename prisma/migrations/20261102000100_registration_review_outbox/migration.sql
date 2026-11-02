CREATE TABLE "foodprint"."email_outbox" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "registration_id" uuid NOT NULL,
  "recipient_email" varchar(254) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "text" text NOT NULL,
  "html" text NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz(6) NOT NULL DEFAULT now(),
  "locked_until" timestamptz(6),
  "first_attempt_at" timestamptz(6),
  "provider_message_id" varchar(255),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_outbox_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "foodprint"."registration_requests"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "email_outbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'ACCEPTED', 'FAILED')),
  CONSTRAINT "email_outbox_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5)
);

CREATE INDEX "idx_email_outbox_dispatch" ON "foodprint"."email_outbox" ("status", "next_attempt_at");
