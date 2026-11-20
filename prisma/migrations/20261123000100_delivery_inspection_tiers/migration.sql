BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

CREATE TYPE foodprint.delivery_inspection_tier AS ENUM ('PRIMARY', 'REQUIRED', 'OPTIONAL');

CREATE TABLE foodprint.school_delivery_inspection_roles (
  school_id          uuid NOT NULL REFERENCES foodprint.schools(id) ON DELETE RESTRICT,
  role_id            uuid NOT NULL REFERENCES foodprint.roles(id)   ON DELETE RESTRICT,
  tier               foodprint.delivery_inspection_tier NOT NULL,
  updated_by_user_id uuid NOT NULL REFERENCES foodprint.users(id)   ON DELETE RESTRICT,
  created_at         timestamptz(6) NOT NULL DEFAULT now(),
  updated_at         timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, role_id)
);
CREATE UNIQUE INDEX uq_school_delivery_inspection_primary
  ON foodprint.school_delivery_inspection_roles (school_id) WHERE tier = 'PRIMARY';

CREATE TABLE foodprint.delivery_inspection_roles (
  delivery_id uuid NOT NULL REFERENCES foodprint.deliveries(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES foodprint.roles(id)      ON DELETE RESTRICT,
  tier        foodprint.delivery_inspection_tier NOT NULL,
  created_at  timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (delivery_id, role_id)
);
CREATE UNIQUE INDEX uq_delivery_inspection_primary
  ON foodprint.delivery_inspection_roles (delivery_id) WHERE tier = 'PRIMARY';

-- Permission mới cho BGH; giữ nguyên permission bị tắt và user denials.
INSERT INTO foodprint.permissions (code, name, module, action, description)
VALUES ('school_delivery_inspection.manage', 'Cấu hình nhóm duyệt nguyên liệu', 'school_delivery_inspection', 'manage',
        'Ban Giám Hiệu phân nhóm duyệt chính / bắt buộc / tùy chọn cho các bộ phận kiểm tra nguyên liệu đầu vào của trường.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO foodprint.role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM foodprint.roles role
JOIN foodprint.permissions permission ON permission.code = 'school_delivery_inspection.manage'
WHERE role.code = 'SCHOOL_MANAGEMENT_BOARD'
ON CONFLICT DO NOTHING;

-- Cập nhật mô tả delivery.inspect (trước đây ghi "đủ bốn bộ phận").
UPDATE foodprint.permissions
SET description = 'Ghi quyết định bất biến của bộ phận trên từng Delivery; tiếp nhận khi người duyệt chính và mọi bộ phận bắt buộc của trường đồng ý.'
WHERE code = 'delivery.inspect';
COMMIT;
