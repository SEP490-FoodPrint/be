-- TASK-09: tỷ lệ hao hụt sơ chế/nấu theo nguyên liệu của trường (0 <= r < 1).
-- Lượng sống = thành phẩm / (1 - r). Gia vị chung của bữa không áp dụng. Không lưu lịch sử thay đổi.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE "foodprint"."ingredient_entries"
  ADD COLUMN "waste_rate" DECIMAL(5,4) NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ingredient_entries_waste_rate_check" CHECK ("waste_rate" >= 0 AND "waste_rate" < 1);

-- Preserve administrator-disabled permissions and all per-user denials.
INSERT INTO foodprint.permissions (code, name, module, action, description)
VALUES ('ingredient_waste_rate.manage', 'Cấu hình tỷ lệ hao hụt nguyên liệu', 'ingredient_waste_rate', 'manage',
        'Xem và cập nhật tỷ lệ hao hụt của nguyên liệu trong danh mục trường.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'ingredient_waste_rate.manage'
WHERE role.code IN ('SCHOOL_KITCHEN_STAFF')
ON CONFLICT DO NOTHING;
COMMIT;
