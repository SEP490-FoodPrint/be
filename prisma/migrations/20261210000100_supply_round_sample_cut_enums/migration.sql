-- TASK-10 v8 (cắt lưu mẫu trong mẻ Đợt 1, bù ở Đợt 2) — phần enum, tách riêng như các migration enum trước.
-- Chỉ thêm kiểu mới, không đổi dữ liệu.
CREATE TYPE "foodprint"."sample_strategy" AS ENUM ('CUT', 'TOP_UP', 'ROUND2_ORDER', 'STOCK');
CREATE TYPE "foodprint"."supply_compensation_kind" AS ENUM ('FRESH', 'STOCK');
