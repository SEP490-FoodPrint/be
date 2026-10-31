-- Additive supplier onboarding; retain legacy relationships and historical orders.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Azure already has this shared directory. Fresh installations need it as well.
CREATE TABLE IF NOT EXISTS foodprint.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(255) NOT NULL, type varchar(50) NOT NULL, level smallint NOT NULL,
  parent_id uuid REFERENCES foodprint.locations(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_locations_parent_id ON foodprint.locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_level ON foodprint.locations(level);
CREATE INDEX IF NOT EXISTS idx_locations_type ON foodprint.locations(type);
ALTER TABLE foodprint.suppliers ADD COLUMN location_id uuid REFERENCES foodprint.locations(id) ON DELETE RESTRICT;
CREATE TABLE foodprint.supplier_service_areas (
  supplier_id uuid NOT NULL REFERENCES foodprint.suppliers(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES foodprint.locations(id) ON DELETE RESTRICT,
  PRIMARY KEY (supplier_id, location_id)
);
CREATE INDEX supplier_service_areas_location_id_idx ON foodprint.supplier_service_areas(location_id);

CREATE TABLE foodprint.supplier_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES foodprint.schools(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES foodprint.suppliers(id) ON DELETE RESTRICT,
  relationship_id uuid REFERENCES foodprint.school_supplier_relationships(id) ON DELETE RESTRICT,
  number varchar(120), signed_on date, starts_on date, ends_on date, scope_note text,
  certification_id uuid REFERENCES foodprint.supplier_certifications(id) ON DELETE RESTRICT,
  exemption_note text, status varchar(20) NOT NULL DEFAULT 'DRAFT',
  revision integer NOT NULL DEFAULT 1,
  snapshot jsonb,
  created_by_user_id uuid NOT NULL REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  activated_by_user_id uuid REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  activated_at timestamptz, closed_at timestamptz, close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contracts_id_school_id_supplier_id_key UNIQUE (id, school_id, supplier_id),
  CONSTRAINT supplier_contracts_school_id_supplier_id_number_key UNIQUE (school_id, supplier_id, number),
  CONSTRAINT chk_supplier_contract_status CHECK (status IN ('DRAFT','ACTIVE','CLOSED')),
  CONSTRAINT chk_supplier_contract_revision CHECK (revision > 0),
  CONSTRAINT chk_supplier_contract_dates CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on),
  CONSTRAINT chk_supplier_contract_activation CHECK (status = 'DRAFT' OR
    (number IS NOT NULL AND signed_on IS NOT NULL AND starts_on IS NOT NULL AND ends_on IS NOT NULL
      AND activated_at IS NOT NULL AND activated_by_user_id IS NOT NULL AND relationship_id IS NOT NULL AND snapshot IS NOT NULL)),
  CONSTRAINT chk_supplier_contract_closure CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND close_reason IS NOT NULL AND length(trim(close_reason)) > 0))
);
CREATE INDEX supplier_contracts_school_id_supplier_id_status_idx ON foodprint.supplier_contracts(school_id,supplier_id,status);
CREATE TABLE foodprint.supplier_contract_items (
  contract_id uuid NOT NULL REFERENCES foodprint.supplier_contracts(id) ON DELETE RESTRICT,
  ingredient_id uuid NOT NULL REFERENCES foodprint.ingredients(id) ON DELETE RESTRICT,
  PRIMARY KEY (contract_id, ingredient_id)
);
CREATE TABLE foodprint.supplier_contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES foodprint.supplier_contracts(id) ON DELETE RESTRICT,
  kind varchar(30) NOT NULL, file_name varchar(255) NOT NULL, mime_type varchar(80) NOT NULL,
  size integer NOT NULL, sha256 varchar(64) NOT NULL, content bytea NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_contract_document_kind CHECK (kind IN ('SIGNED_CONTRACT','COMPLIANCE','APPENDIX')),
  CONSTRAINT chk_contract_document_size CHECK (size > 0 AND size <= 10485760 AND size = octet_length(content)),
  CONSTRAINT chk_contract_document_mime CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  CONSTRAINT chk_contract_document_sha CHECK (sha256 ~ '^[a-f0-9]{64}$')
);
CREATE INDEX supplier_contract_documents_contract_id_idx ON foodprint.supplier_contract_documents(contract_id);
CREATE TABLE foodprint.supplier_relationship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES foodprint.school_supplier_relationships(id) ON DELETE RESTRICT,
  contract_id uuid REFERENCES foodprint.supplier_contracts(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES foodprint.users(id) ON DELETE RESTRICT,
  actor_name varchar(255) NOT NULL, action varchar(40) NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_relationship_events_relationship_id_created_at_idx ON foodprint.supplier_relationship_events(relationship_id,created_at);
ALTER TABLE foodprint.supply_requests ADD COLUMN contract_id uuid, ADD COLUMN contract_snapshot jsonb;
ALTER TABLE foodprint.supply_requests ADD CONSTRAINT supply_requests_contract_id_school_id_supplier_id_fkey
  FOREIGN KEY (contract_id,school_id,supplier_id) REFERENCES foodprint.supplier_contracts(id,school_id,supplier_id) ON DELETE RESTRICT;
ALTER TABLE foodprint.supply_requests ADD CONSTRAINT chk_supply_contract_snapshot
  CHECK (contract_id IS NULL OR contract_snapshot IS NOT NULL);
COMMIT;
