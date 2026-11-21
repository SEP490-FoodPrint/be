-- C06: khiếu nại gửi System Admin (specs/system-complaint-management).
-- Chỉ thêm bảng con và enum mới; bảng cha `complaints` đã có CHECK mã `FP-SC-%` cho kind SYSTEM từ PR1.
-- Không có function/trigger; luồng ticket do backend kiểm soát.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TYPE "foodprint"."system_complaint_category" AS ENUM ('ACCOUNT', 'PERMISSION', 'DATA', 'TECHNICAL', 'OTHER');

CREATE TABLE "foodprint"."system_complaints" (
    "id" UUID NOT NULL,
    "kind" "foodprint"."complaint_kind" NOT NULL DEFAULT 'SYSTEM',
    "category" "foodprint"."system_complaint_category" NOT NULL,

    CONSTRAINT "system_complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "system_complaints_kind" CHECK ("kind" = 'SYSTEM')
);

-- Prisma cần unique (id, kind) cho quan hệ 1-1 với bảng cha.
CREATE UNIQUE INDEX "uq_system_complaints_id_kind" ON "foodprint"."system_complaints"("id", "kind");

ALTER TABLE "foodprint"."system_complaints"
  ADD CONSTRAINT "system_complaints_id_kind_fkey" FOREIGN KEY ("id", "kind") REFERENCES "foodprint"."complaints"("id", "kind") ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
