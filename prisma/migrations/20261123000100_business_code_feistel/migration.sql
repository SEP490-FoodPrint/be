-- Mã nghiệp vụ FP-XX-NNNNN dùng chung (specs/feistel-business-codes).
-- Hậu tố 5 chữ số = Feistel(số thứ tự − 1) do backend tính bằng khóa cấu hình; migration không chứa khóa,
-- không có function/trigger và không seed dữ liệu (bộ đếm được tạo bằng upsert khi cấp mã lần đầu).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Bộ đếm số thứ tự theo loại mã.
CREATE TABLE "foodprint"."business_code_counters" (
    "code_type" VARCHAR(2) NOT NULL,
    "last_sequence" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_code_counters_pkey" PRIMARY KEY ("code_type"),
    CONSTRAINT "business_code_counters_code_type_format" CHECK ("code_type" ~ '^[A-Z]{2}$'),
    CONSTRAINT "business_code_counters_last_sequence_range" CHECK ("last_sequence" BETWEEN 0 AND 100000)
);

-- Hồ sơ đăng ký: giữ đúng mã FP-REG-… đang hiển thị cho hồ sơ cũ; hồ sơ mới dùng FP-RG-NNNNN.
LOCK TABLE "foodprint"."registration_requests" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "foodprint"."registration_requests"
  ADD COLUMN "code" VARCHAR(26);

UPDATE "foodprint"."registration_requests"
-- lpad cắt chuỗi dài hơn 5 ký tự nên chỉ pad khi số < 100000, giống formatRegistrationID cũ.
SET "code" = 'FP-REG-' || CASE
      WHEN "registration_number" < 100000 THEN lpad("registration_number"::text, 5, '0')
      ELSE "registration_number"::text
    END,
    "updated_at" = "updated_at";

ALTER TABLE "foodprint"."registration_requests"
  ALTER COLUMN "code" SET NOT NULL,
  ADD CONSTRAINT "registration_requests_code_format" CHECK (
    "code" ~ '^FP-REG-([0-9]{5}|[1-9][0-9]{5,18})$'
    OR ("code" ~ '^FP-RG-[0-9]{5}$' AND "code" <> 'FP-RG-00000')
  );

CREATE UNIQUE INDEX "registration_requests_code_key"
  ON "foodprint"."registration_requests"("code");

-- Khiếu nại bữa ăn: cột mã tạm nullable; bản ghi cũ được gán bằng `npm run business-codes:backfill`.
ALTER TABLE "foodprint"."meal_complaints"
  ADD COLUMN "code" VARCHAR(20),
  ADD CONSTRAINT "meal_complaints_code_format" CHECK (
    "code" IS NULL OR ("code" ~ '^FP-MC-[0-9]{5}$' AND "code" <> 'FP-MC-00000')
  );

CREATE UNIQUE INDEX "meal_complaints_code_key"
  ON "foodprint"."meal_complaints"("code");

-- Sự cố an toàn thực phẩm: cột mã tạm nullable; bản ghi cũ được gán bằng `npm run business-codes:backfill`.
ALTER TABLE "foodprint"."food_safety_incidents"
  ADD COLUMN "code" VARCHAR(20),
  ADD CONSTRAINT "food_safety_incidents_code_format" CHECK (
    "code" IS NULL OR ("code" ~ '^FP-IC-[0-9]{5}$' AND "code" <> 'FP-IC-00000')
  );

CREATE UNIQUE INDEX "food_safety_incidents_code_key"
  ON "foodprint"."food_safety_incidents"("code");

COMMIT;
