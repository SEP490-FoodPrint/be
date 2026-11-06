BEGIN;

CREATE TABLE foodprint.school_academic_years (
    id            uuid NOT NULL DEFAULT gen_random_uuid(),
    school_id     uuid NOT NULL,
    academic_year varchar(30) NOT NULL,
    start_date    date NOT NULL,
    end_date      date NOT NULL,
    holidays      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at    timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT school_academic_years_pkey PRIMARY KEY (id),
    CONSTRAINT school_academic_years_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES foodprint.schools(id)
        ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT chk_school_academic_year_label
        CHECK (length(btrim(academic_year)) > 0),
    CONSTRAINT chk_school_academic_year_dates
        CHECK (start_date <= end_date),
    CONSTRAINT chk_school_academic_year_holidays_array
        CHECK (jsonb_typeof(holidays) = 'array')
);

CREATE UNIQUE INDEX uq_school_academic_year_school_year
    ON foodprint.school_academic_years(school_id, academic_year);

COMMIT;
