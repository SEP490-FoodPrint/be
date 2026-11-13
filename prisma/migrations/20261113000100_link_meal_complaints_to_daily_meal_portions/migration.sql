BEGIN;

ALTER TABLE foodprint.meal_complaints ADD COLUMN daily_meal_portion_id UUID;

UPDATE foodprint.meal_complaints AS complaint
SET daily_meal_portion_id = allocation.daily_meal_portion_id
FROM foodprint.meal_allocations AS allocation
WHERE allocation.id = complaint.meal_allocation_id;

-- Abort the transaction if any existing complaint could not be linked.
ALTER TABLE foodprint.meal_complaints ALTER COLUMN daily_meal_portion_id SET NOT NULL;

CREATE INDEX idx_meal_complaints_daily_meal_portion
ON foodprint.meal_complaints(daily_meal_portion_id);

ALTER TABLE foodprint.meal_complaints
ADD CONSTRAINT meal_complaints_daily_meal_portion_id_fkey
FOREIGN KEY (daily_meal_portion_id) REFERENCES foodprint.daily_meal_portions(id)
ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE foodprint.meal_complaints
DROP CONSTRAINT meal_complaints_meal_allocation_id_fkey;

DROP INDEX foodprint.idx_meal_complaints_allocation;
ALTER TABLE foodprint.meal_complaints DROP COLUMN meal_allocation_id;

COMMIT;
