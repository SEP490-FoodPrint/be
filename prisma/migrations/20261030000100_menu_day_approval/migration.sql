-- Support independent menu-day decisions while preserving historical week status.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE foodprint.menu_days
  ADD COLUMN approval_status foodprint.weekly_menu_status NOT NULL DEFAULT 'PENDING_APPROVAL';

UPDATE foodprint.menu_days AS day
SET approval_status = menu.status,
    updated_at = CURRENT_TIMESTAMP
FROM foodprint.weekly_menus AS menu
WHERE day.weekly_menu_id = menu.id;

ALTER TABLE foodprint.menu_review_records
  ADD COLUMN menu_day_id uuid;

ALTER TABLE foodprint.menu_review_records
  ADD CONSTRAINT menu_review_records_menu_day_id_fkey
  FOREIGN KEY (menu_day_id) REFERENCES foodprint.menu_days(id)
  ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE INDEX idx_menu_review_records_menu_day
  ON foodprint.menu_review_records(menu_day_id);

COMMIT;
