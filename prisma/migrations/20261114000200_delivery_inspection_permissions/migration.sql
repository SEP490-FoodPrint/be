BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Preserve administrator-disabled permissions and all per-user denials.
INSERT INTO foodprint.permissions (code, name, module, action, description)
VALUES ('delivery.inspect', 'Kiểm tra và quyết định tiếp nhận từng đợt giao', 'delivery', 'inspect',
        'Ghi quyết định bất biến của bộ phận trên từng Delivery; chỉ tiếp nhận khi đủ bốn bộ phận đồng ý.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'delivery.inspect'
WHERE role.code IN ('SCHOOL_NUTRITION_OFFICER', 'SCHOOL_KITCHEN_STAFF', 'INGREDIENT_MANAGEMENT_DEPARTMENT', 'PARENTS_COMMITTEE')
ON CONFLICT DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'delivery.view'
WHERE role.code = 'PARENTS_COMMITTEE'
ON CONFLICT DO NOTHING;
COMMIT;
