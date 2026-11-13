-- Enable the existing permission for existing parent committee roles.
INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles AS role
CROSS JOIN foodprint.permissions AS permission
WHERE role.code = 'PARENTS_COMMITTEE'
  AND role.type = 'SCHOOL'
  AND permission.code = 'meal_complaint.view'
  AND permission.is_active
ON CONFLICT (role_id, permission_id) DO NOTHING;
