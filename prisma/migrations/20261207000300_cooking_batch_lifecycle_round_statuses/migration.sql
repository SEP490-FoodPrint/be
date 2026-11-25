BEGIN;

ALTER TABLE foodprint.cooking_batches DROP CONSTRAINT chk_cooking_batch_lifecycle;
ALTER TABLE foodprint.cooking_batches ADD CONSTRAINT chk_cooking_batch_lifecycle CHECK (
  (status IN ('UNCONFIRMED', 'PENDING_APPROVAL', 'ROUND1_APPROVED', 'ROUND2_APPROVED', 'CANCELLED')
    AND confirmed_at IS NULL AND confirmed_by_user_id IS NULL
    AND completed_at IS NULL AND completed_by_user_id IS NULL
    AND prepared_portions IS NULL)
  OR (status = 'CONFIRMED'
    AND confirmed_at IS NOT NULL
    AND (confirmed_by_user_id IS NOT NULL OR batch_group_id IS NOT NULL)
    AND completed_at IS NULL AND completed_by_user_id IS NULL
    AND prepared_portions IS NULL AND planned_portions IS NOT NULL AND planned_portions > 0)
  OR (status = 'COMPLETED'
    AND confirmed_at IS NOT NULL
    AND (confirmed_by_user_id IS NOT NULL OR batch_group_id IS NOT NULL)
    AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL
    AND planned_portions IS NOT NULL AND planned_portions > 0
    AND (prepared_portions IS NULL OR prepared_portions = planned_portions))
);

COMMIT;
