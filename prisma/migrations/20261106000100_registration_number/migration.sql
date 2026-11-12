BEGIN;

LOCK TABLE foodprint.registration_requests IN ACCESS EXCLUSIVE MODE;

-- Backfill explicitly before attaching a volatile sequence default.
ALTER TABLE foodprint.registration_requests ADD COLUMN registration_number BIGINT;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY submitted_at ASC, id ASC) AS number
  FROM foodprint.registration_requests
)
UPDATE foodprint.registration_requests AS registration
SET registration_number = numbered.number
FROM numbered
WHERE registration.id = numbered.id;

CREATE SEQUENCE foodprint.registration_requests_registration_number_seq
  AS BIGINT INCREMENT BY 1 MINVALUE 1 START WITH 1 CACHE 1 NO CYCLE
  OWNED BY foodprint.registration_requests.registration_number;

ALTER TABLE foodprint.registration_requests
  ALTER COLUMN registration_number SET DEFAULT nextval('foodprint.registration_requests_registration_number_seq'::regclass),
  ALTER COLUMN registration_number SET NOT NULL,
  ADD CONSTRAINT registration_requests_registration_number_positive CHECK (registration_number > 0);

CREATE UNIQUE INDEX registration_requests_registration_number_key
  ON foodprint.registration_requests(registration_number);

SELECT setval(
  'foodprint.registration_requests_registration_number_seq'::regclass,
  COALESCE(MAX(registration_number), 1),
  COUNT(*) > 0
) FROM foodprint.registration_requests;

COMMIT;
