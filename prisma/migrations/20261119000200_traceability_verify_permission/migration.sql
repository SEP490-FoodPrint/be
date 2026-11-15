BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- Preserve administrator-disabled permissions and all per-user denials.
INSERT INTO foodprint.permissions (code, name, module, action, description)
VALUES ('traceability.verify', 'Xác minh bằng chứng blockchain', 'traceability', 'verify',
        'Đối chiếu dữ liệu kiểm nhận, mẻ nấu, mẫu lưu với hash trên blockchain và gửi lại bằng chứng chưa ghi được.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'traceability.verify'
WHERE role.code IN ('SCHOOL_MANAGEMENT_BOARD', 'SCHOOL_NUTRITION_OFFICER')
ON CONFLICT DO NOTHING;
COMMIT;
