-- supply-round-sample-planning (PR1, phần enum): tách riêng vì giá trị enum mới
-- không được dùng trong cùng transaction đã thêm nó. Chỉ thêm, không đổi dữ liệu.
ALTER TYPE "foodprint"."cooking_batch_status" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "foodprint"."cooking_batch_status" ADD VALUE IF NOT EXISTS 'ROUND1_APPROVED';
ALTER TYPE "foodprint"."cooking_batch_status" ADD VALUE IF NOT EXISTS 'ROUND2_APPROVED';
ALTER TYPE "foodprint"."cooking_batch_status" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "foodprint"."supply_round_status" AS ENUM ('COLLECTING', 'IN_REVIEW', 'READY', 'CLOSED', 'NOT_NEEDED');
CREATE TYPE "foodprint"."dish_plan_status" AS ENUM ('WAITING_SUPPLIERS', 'PLAN_FAILED', 'PENDING_WAREHOUSE', 'APPROVED', 'REPLAN_REQUIRED', 'CANCELLED');
CREATE TYPE "foodprint"."round_part_status" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'MERGED');
CREATE TYPE "foodprint"."delivery_preparation_stage" AS ENUM ('LOTS_DECLARED', 'PENDING_WAREHOUSE', 'TOP_UP_PENDING', 'READY_TO_DISPATCH');
