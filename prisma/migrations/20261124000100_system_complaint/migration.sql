-- CreateTable: foodprint.system_complaints
CREATE TABLE foodprint.system_complaints (
    id uuid NOT NULL,
    kind foodprint.complaint_kind NOT NULL DEFAULT 'SYSTEM'::foodprint.complaint_kind,
    CONSTRAINT system_complaints_pkey PRIMARY KEY (id),
    CONSTRAINT chk_system_complaints_kind CHECK (kind = 'SYSTEM'::foodprint.complaint_kind),
    CONSTRAINT uq_system_complaints_id_kind UNIQUE (id, kind),
    CONSTRAINT fk_system_complaints_complaints FOREIGN KEY (id, kind)
        REFERENCES foodprint.complaints(id, kind) ON DELETE RESTRICT ON UPDATE NO ACTION
);
