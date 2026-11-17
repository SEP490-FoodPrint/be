BEGIN;

LOCK TABLE foodprint.ingredient_quality_feedback IN ACCESS EXCLUSIVE MODE;

ALTER TABLE foodprint.ingredient_quality_feedback
  ADD COLUMN complaint_code VARCHAR(25);

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (ORDER BY created_at ASC, id ASC) AS seq
  FROM foodprint.ingredient_quality_feedback
)
UPDATE foodprint.ingredient_quality_feedback AS feedback
SET
  complaint_code = CONCAT(
    'FP-CP-',
    CASE
      WHEN numbered.seq < 100000 THEN lpad(numbered.seq::text, 5, '0')
      ELSE numbered.seq::text
    END
  ),
  updated_at = feedback.updated_at
FROM numbered
WHERE feedback.id = numbered.id;

ALTER TABLE foodprint.ingredient_quality_feedback
  ALTER COLUMN complaint_code SET NOT NULL,
  ADD CONSTRAINT ingredient_quality_feedback_complaint_code_format
    CHECK (
      CASE
        WHEN complaint_code ~ '^FP-CP-([0-9]{5}|[1-9][0-9]{5,18})$'
          THEN substring(complaint_code FROM 7)::numeric BETWEEN 1 AND 9223372036854775807
        ELSE false
      END
    );

CREATE UNIQUE INDEX ingredient_quality_feedback_complaint_code_key
  ON foodprint.ingredient_quality_feedback(complaint_code);

CREATE SEQUENCE foodprint.ingredient_quality_feedback_complaint_code_seq
  AS BIGINT INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE
  OWNED BY foodprint.ingredient_quality_feedback.complaint_code;

SELECT setval(
  'foodprint.ingredient_quality_feedback_complaint_code_seq'::regclass,
  GREATEST(COUNT(*), 1),
  COUNT(*) > 0
)
FROM foodprint.ingredient_quality_feedback;

COMMIT;
