-- TASK-10: gán quyền Kế hoạch mẻ theo đợt giao cho các vai trò trường (khớp INITIAL_ROLE_PERMISSIONS).
-- Migration supply-round trước đó không gán quyền; auth:bootstrap bỏ qua vai trò đã tồn tại,
-- nên Kho bị 403 "Bạn không có quyền thực hiện thao tác này" ở trang Kế hoạch mẻ.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Preserve administrator-disabled permissions and all per-user denials.
INSERT INTO foodprint.permissions (code, name, module, action, description)
VALUES
  ('cooking_plan.view', 'Xem kế hoạch mẻ theo đợt', 'cooking_plan', 'view',
   'Xem kế hoạch mẻ và phần nguyên liệu lấy thêm cho lưu mẫu theo đợt giao.'),
  ('cooking_plan.approve', 'Duyệt kế hoạch mẻ theo đợt', 'cooking_plan', 'approve',
   'Duyệt hoặc lập lại kế hoạch mẻ và phần lấy thêm cho lưu mẫu theo đợt giao.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'cooking_plan.view'
WHERE role.code IN ('INGREDIENT_MANAGEMENT_DEPARTMENT', 'SCHOOL_MANAGEMENT_BOARD', 'SCHOOL_KITCHEN_STAFF')
ON CONFLICT DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'cooking_plan.approve'
WHERE role.code IN ('INGREDIENT_MANAGEMENT_DEPARTMENT')
ON CONFLICT DO NOTHING;
COMMIT;
