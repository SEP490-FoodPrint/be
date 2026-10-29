-- Initial schema baseline for the existing FoodPrint v5.4 database.
-- Source: database/FoodPrint_PostgreSQL_Database_v5_4_FINAL_with_MOCK_DATA.sql
-- Source SHA-256: 770751bf506fa523b50bd6c51d235a6305b584c5e1fb63c3bd4e0eac040f5884
-- Schema only: no role/permission seeds, mock data, credentials or business records.
-- Existing matching databases must mark 0_init as applied before migrate deploy.
-- Do not replay this baseline on a populated database.

-- ============================================================================

-- FoodPrint PostgreSQL Database Schema

-- FoodPrint PostgreSQL Database v5.4 (RBAC permissions + role-permission seed; no database functions or triggers)
-- Based on v4 plus approved workflow extensions; intentionally excludes generic media/email logs
-- and the unconfirmed standalone investigation-team table.

-- PostgreSQL 15+ | SCHEMA DDL + 11 ACTOR-ALIGNED ROLE SEEDS | run in an empty database/schema

--

-- IMPORTANT MODELING NOTE

-- The conceptual ERD is converted into a physical PostgreSQL design here.

-- M:N relationships and relationships with attributes become physical tables.

-- Final receiving model: Delivery -> DeliveryItem -> IngredientLot, while

-- DeliveryApproval and InventoryTransaction remain separate audit/history tables.

-- Nutrition tracking is intentionally OUT OF SCOPE; quantity/portion data remains.

-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS foodprint;

SET LOCAL search_path TO foodprint, public;

-- ============================================================================

-- 1. ENUM TYPES

-- ============================================================================

CREATE TYPE role_type AS ENUM ('SYSTEM', 'SCHOOL', 'SUPPLIER', 'AUTHORITY');

CREATE TYPE account_status AS ENUM (

    'UNVERIFIED', 'ACTIVE', 'INACTIVE', 'LOCKED', 'DEACTIVATED'

);

CREATE TYPE registration_request_type AS ENUM ('SCHOOL', 'SUPPLIER');

CREATE TYPE registration_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE school_supplier_status AS ENUM ('ACTIVE', 'SUSPENDED', 'UNLINKED');

CREATE TYPE meal_portion_status AS ENUM ('DRAFT', 'FINALIZED');

CREATE TYPE entity_status AS ENUM ('ACTIVE', 'INACTIVE');

-- School-side handling rule: long-term dry storage vs same-day cooking.

CREATE TYPE ingredient_handling_type AS ENUM ('DRY_STOCK', 'DIRECT_USE');

CREATE TYPE supply_request_status AS ENUM (

    'DRAFT', 'SENT', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'

);

CREATE TYPE delivery_status AS ENUM (

    'CREATED',

    'IN_TRANSIT',

    'ARRIVED',

    'PENDING_APPROVAL',

    'APPROVED',

    'REJECTED',

    'CANCELLED_MEAL',

    'RECEIVED',

    'CANCELLED'

);

CREATE TYPE approval_decision AS ENUM ('APPROVE', 'REJECT');

CREATE TYPE ingredient_lot_status AS ENUM (

    'AVAILABLE', 'DEPLETED', 'EXPIRED', 'DISPOSED', 'BLOCKED'

);

CREATE TYPE inventory_movement_type AS ENUM (

    'RECEIPT', 'COOKING_USAGE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DISPOSAL'

);

CREATE TYPE weekly_menu_status AS ENUM (

    'DRAFT', 'PENDING_APPROVAL', 'REVISION_REQUIRED', 'APPROVED'

);

CREATE TYPE menu_review_decision AS ENUM ('APPROVED', 'REVISION_REQUESTED');

-- School-defined cooking policy and school meal slot.

CREATE TYPE cooking_mode AS ENUM ('SEPARATE_BY_LOT', 'COMBINE_LOTS');

CREATE TYPE meal_type AS ENUM ('LUNCH', 'AFTERNOON');

-- Lifecycle: prepare plan -> confirm plan before cooking -> record actual result.

CREATE TYPE cooking_batch_status AS ENUM ('UNCONFIRMED', 'CONFIRMED', 'COMPLETED');

CREATE TYPE retained_sample_status AS ENUM ('STORED', 'DISPOSED');

CREATE TYPE meal_allocation_status AS ENUM (

    'ALLOCATED', 'DISTRIBUTED', 'FINALIZED', 'CANCELLED'

);

CREATE TYPE meal_complaint_type AS ENUM (

    'MEAL_QUALITY', 'FOOD_HYGIENE', 'HEALTH_ISSUE', 'OTHER'

);

CREATE TYPE complaint_status AS ENUM (

    'SUBMITTED', 'IN_REVIEW', 'RESOLVED', 'CLOSED'

);

CREATE TYPE incident_status AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');
CREATE TYPE ingredient_quality_feedback_status AS ENUM ('SUBMITTED', 'RESPONDED');
CREATE TYPE blockchain_anchor_status AS ENUM ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED');
CREATE TYPE blockchain_verification_status AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'MISMATCH', 'FAILED');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED');

-- ============================================================================

-- BUSINESS LOGIC POLICY
-- Business rules, lifecycle transitions, inventory posting and updated_at handling
-- are implemented by Backend Services/ORM. This schema contains no functions or triggers.

-- ============================================================================

-- 3. ACCOUNT & ORGANIZATION

-- ============================================================================

CREATE TABLE roles (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    code            varchar(60) NOT NULL UNIQUE,

    name            varchar(120) NOT NULL,

    type            role_type NOT NULL,

    description     text,

    created_at      timestamptz NOT NULL DEFAULT now()

);

-- ============================================================================
-- RBAC: PERMISSIONS CATALOG + ROLE-PERMISSION ASSIGNMENTS
-- Permissions describe backend actions; role_permissions assigns them to roles.
-- Organization/resource scope must still be enforced by Backend services.
-- ============================================================================

CREATE TABLE permissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            varchar(100) NOT NULL UNIQUE,
    name            varchar(150) NOT NULL,
    module          varchar(80) NOT NULL,
    action          varchar(50) NOT NULL,
    description     text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_permission_code_format
        CHECK (code ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$')
);

CREATE TABLE role_permissions (
    role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    assigned_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_permission_id
    ON role_permissions (permission_id);

CREATE TABLE schools (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    name            varchar(255) NOT NULL,

    code            varchar(80) UNIQUE,

    email           citext,

    phone           varchar(30),

    address         text,

    website_url     text,

    cooking_mode    cooking_mode,

    lunch_time      time,

    afternoon_meal_time time,

    status          entity_status NOT NULL DEFAULT 'ACTIVE',

    created_at      timestamptz NOT NULL DEFAULT now(),

    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_school_meal_times_distinct

        CHECK (lunch_time IS NULL OR afternoon_meal_time IS NULL OR lunch_time < afternoon_meal_time)

);

CREATE TABLE suppliers (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    name            varchar(255) NOT NULL,

    tax_code        varchar(80) UNIQUE,

    email           citext,

    phone           varchar(30),

    address         text,

    status          entity_status NOT NULL DEFAULT 'ACTIVE',

    created_at      timestamptz NOT NULL DEFAULT now(),

    updated_at      timestamptz NOT NULL DEFAULT now()

);

-- Commune-level food-safety authority organizations that log into FoodPrint.
-- User accounts are linked through users.commune_food_safety_unit_id.
CREATE TABLE commune_food_safety_units (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code        varchar(80) NOT NULL UNIQUE,
    name        varchar(255) NOT NULL,
    address     text,
    email       citext,
    phone       varchar(30),
    status      entity_status NOT NULL DEFAULT 'ACTIVE',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Supplier-level business licenses / food-safety certificates.
-- Certifications belong to the Supplier, not to individual Ingredient catalog rows.
CREATE TABLE supplier_certifications (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

    certification_type  varchar(120) NOT NULL,

    certificate_no      varchar(120) NOT NULL,

    issued_date         date,

    expiry_date         date,

    document_url        text,

    status              entity_status NOT NULL DEFAULT 'ACTIVE',

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (supplier_id, certificate_no),

    CONSTRAINT chk_supplier_certificate_dates

        CHECK (expiry_date IS NULL OR issued_date IS NULL OR expiry_date >= issued_date)

);

CREATE TABLE users (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,

    school_id       uuid REFERENCES schools(id) ON DELETE RESTRICT,

    supplier_id     uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
    commune_food_safety_unit_id uuid REFERENCES commune_food_safety_units(id) ON DELETE RESTRICT,

    username        varchar(120) NOT NULL UNIQUE,

    email           citext NOT NULL UNIQUE,

    password_hash   text NOT NULL,

    full_name       varchar(255) NOT NULL,

    phone           varchar(30),

    status          account_status NOT NULL DEFAULT 'UNVERIFIED',

    email_verified_at timestamptz,

    last_login_at   timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),

    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_user_single_organization

        CHECK (num_nonnulls(school_id, supplier_id, commune_food_safety_unit_id) <= 1)

);

-- Supplier 1:N User: multiple Supplier Admin/Staff accounts may belong to one Supplier.

-- A pending applicant may temporarily have no supplier_id until registration is approved.

-- Supplier-owned source facilities. A source is recorded at lot level when known.
CREATE TABLE source_facilities (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    facility_code       varchar(80),
    name                varchar(255) NOT NULL,
    address             text,
    contact_name        varchar(255),
    contact_phone       varchar(30),
    contact_email       citext,
    status              entity_status NOT NULL DEFAULT 'ACTIVE',
    is_visible          boolean NOT NULL DEFAULT true,
    created_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,
    updated_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (supplier_id, name)
);

CREATE UNIQUE INDEX uq_source_facility_supplier_code
    ON source_facilities (supplier_id, facility_code)
    WHERE facility_code IS NOT NULL;

CREATE TABLE registration_requests (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    applicant_user_id   uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,

    request_type        registration_request_type NOT NULL,

    status              registration_request_status NOT NULL DEFAULT 'PENDING',

    profile_data        jsonb NOT NULL DEFAULT '{}'::jsonb,

    supporting_documents jsonb NOT NULL DEFAULT '[]'::jsonb,

    rejection_reason    text,

    reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    submitted_at        timestamptz NOT NULL DEFAULT now(),

    reviewed_at         timestamptz,

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_registration_review

        CHECK (

            (status = 'PENDING' AND reviewed_at IS NULL)

            OR

            (status IN ('APPROVED','REJECTED') AND reviewed_at IS NOT NULL)

        )

);

CREATE TABLE school_supplier_relationships (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    status              school_supplier_status NOT NULL DEFAULT 'ACTIVE',

    linked_by_user_id   uuid REFERENCES users(id) ON DELETE RESTRICT,

    unlinked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    suspended_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    link_note           text,

    unlink_reason       text,

    suspension_reason   text,

    linked_at           timestamptz NOT NULL DEFAULT now(),

    unlinked_at         timestamptz,

    suspended_at        timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_school_supplier_relationship_lifecycle

        CHECK (

            (status = 'ACTIVE' AND unlinked_at IS NULL AND suspended_at IS NULL)

            OR

            (status = 'SUSPENDED' AND unlinked_at IS NULL
                AND suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)

            OR

            (status = 'UNLINKED' AND unlinked_at IS NOT NULL AND unlink_reason IS NOT NULL)

        )

);

-- Preserve partnership history; only one current ACTIVE/SUSPENDED relationship per pair.

CREATE UNIQUE INDEX uq_school_supplier_current

    ON school_supplier_relationships (school_id, supplier_id)

    WHERE status IN ('ACTIVE', 'SUSPENDED');

-- ============================================================================

-- 4. CLASS, ALLERGY & DAILY MEAL DEMAND

-- ============================================================================

CREATE TABLE classes (

    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id               uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    name                    varchar(120) NOT NULL,

    academic_year           varchar(30),

    registered_meal_portions integer NOT NULL DEFAULT 0

                            CHECK (registered_meal_portions >= 0),

    status                  entity_status NOT NULL DEFAULT 'ACTIVE',

    created_at              timestamptz NOT NULL DEFAULT now(),

    updated_at              timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, name, academic_year)

);

CREATE TABLE daily_meal_portions (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    class_id            uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,

    confirmed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    meal_date           date NOT NULL,

    meal_type           meal_type NOT NULL,

    total_portions      integer NOT NULL CHECK (total_portions >= 0),

    allergy_notes       text,

    status              meal_portion_status NOT NULL DEFAULT 'DRAFT',

    finalized_at        timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (class_id, meal_date, meal_type),

    CONSTRAINT chk_meal_portion_finalized

        CHECK (

            (status = 'DRAFT' AND finalized_at IS NULL)

            OR

            (status = 'FINALIZED' AND finalized_at IS NOT NULL)

        )

);

-- Daily actual meal demand cannot exceed the class's registered meal portions.

-- ============================================================================

-- 5. INGREDIENT CATALOG & SCHOOL-INTERNAL INGREDIENT ENTRY

-- ============================================================================

-- Supplier-side ingredient catalog. Nutrition and certification are intentionally

-- not stored here: nutrition is out of project scope; certifications belong to Supplier.

CREATE TABLE ingredients (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    name            varchar(255) NOT NULL,

    category        varchar(120),

    default_unit    varchar(30) NOT NULL,

    description     text,

    status          entity_status NOT NULL DEFAULT 'ACTIVE',

    created_at      timestamptz NOT NULL DEFAULT now(),

    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (supplier_id, name)

);

-- School-internal ingredient used by allergy, menu/recipe, procurement and inventory flows.

CREATE TABLE ingredient_entries (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    ingredient_id       uuid NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,

    storage_requirements text,

    shelf_life_days     integer CHECK (shelf_life_days IS NULL OR shelf_life_days >= 0),

    handling_type       ingredient_handling_type NOT NULL,

    status              entity_status NOT NULL DEFAULT 'ACTIVE',

    created_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, ingredient_id)

);

-- Physical table for conceptual relationship:

-- Class M:N IngredientEntry -- HAS ALLERGY [affectedCount]

-- Allergy is school-internal, so it references IngredientEntry instead of Supplier Ingredient.

CREATE TABLE class_allergies (

    class_id            uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,

    ingredient_entry_id uuid NOT NULL REFERENCES ingredient_entries(id) ON DELETE RESTRICT,

    affected_count      integer NOT NULL CHECK (affected_count >= 0),

    updated_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,

    updated_at          timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (class_id, ingredient_entry_id)

);

-- Ensure a Class can only use IngredientEntry belonging to the same School.

-- Daily number of allergy-specific portions required for a class on a concrete meal date.

-- This table refines the class-level allergy master data (class_allergies) into

-- the actual allergy portion count for one DailyMealPortion.

CREATE TABLE daily_allergy_portions (

    daily_meal_portion_id uuid NOT NULL REFERENCES daily_meal_portions(id) ON DELETE CASCADE,

    class_id              uuid NOT NULL,

    ingredient_entry_id   uuid NOT NULL,

    portion_count         integer NOT NULL CHECK (portion_count > 0),

    created_at            timestamptz NOT NULL DEFAULT now(),

    updated_at            timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (daily_meal_portion_id, class_id, ingredient_entry_id),

    CONSTRAINT fk_daily_allergy_class_entry

        FOREIGN KEY (class_id, ingredient_entry_id)

        REFERENCES class_allergies(class_id, ingredient_entry_id)

        ON DELETE RESTRICT

);

-- Ensure daily_allergy_portions.class_id matches the Class of DailyMealPortion.

-- ============================================================================

-- 6. SUPPLY REQUEST & DELIVERY

-- ============================================================================

CREATE TABLE supply_requests (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    request_no          varchar(80) NOT NULL UNIQUE,

    school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    created_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    status              supply_request_status NOT NULL DEFAULT 'DRAFT',

    requested_delivery_date date,

    note                text,

    supplier_response_note text,

    accepted_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    accepted_at         timestamptz,

    sent_at             timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now()

);

-- Physical table for conceptual relationship:

-- SupplyRequest M:N IngredientEntry -- REQUESTS [quantity, unit]

CREATE TABLE supply_request_items (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    supply_request_id   uuid NOT NULL REFERENCES supply_requests(id) ON DELETE CASCADE,

    ingredient_entry_id uuid NOT NULL REFERENCES ingredient_entries(id) ON DELETE RESTRICT,

    requested_quantity  numeric(14,3) NOT NULL CHECK (requested_quantity > 0),

    unit                varchar(30) NOT NULL,

    note                text,

    UNIQUE (supply_request_id, ingredient_entry_id)

);

CREATE TABLE deliveries (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    delivery_no         varchar(80) NOT NULL UNIQUE,

    supply_request_id   uuid NOT NULL REFERENCES supply_requests(id) ON DELETE RESTRICT,

    supplier_id         uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    status              delivery_status NOT NULL DEFAULT 'CREATED',

    created_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,

    expected_arrival_at timestamptz,

    arrived_at          timestamptz,

    received_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    received_at         timestamptz,

    vehicle_plate       varchar(40),

    note                text,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_delivery_received_fields

        CHECK (

            (status <> 'RECEIVED')

            OR (received_by_user_id IS NOT NULL AND received_at IS NOT NULL)

        )

);

-- A Delivery must belong to the same Supplier as its SupplyRequest.

-- ============================================================================

-- 7. FOUR-ROLE INCOMING APPROVAL

-- ============================================================================

-- Physical table for conceptual relationship:

-- User M:N Delivery -- APPROVES INCOMING [decision, reason, decidedAt]

CREATE TABLE delivery_approvals (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    delivery_id     uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,

    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,

    decision        approval_decision NOT NULL,

    reason          text,

    decided_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (delivery_id, user_id),

    UNIQUE (delivery_id, role_id),

    CONSTRAINT chk_reject_reason

        CHECK (decision <> 'REJECT' OR reason IS NOT NULL)

);

-- Confirmed business rule:

--   0 rejects + all 4 required role decisions => APPROVED

--   1 reject                            => REJECTED

--   2 or more rejects                   => CANCELLED_MEAL

--   otherwise                           => PENDING_APPROVAL

-- ============================================================================

-- 8. DELIVERY ITEMS, LOTS & INVENTORY

-- ============================================================================

-- Actual ingredient lines delivered in one Delivery.

-- A DeliveryItem references the expected SupplyRequestItem and stores actual quantity.

CREATE TABLE delivery_items (

    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    delivery_id             uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,

    supply_request_item_id  uuid NOT NULL REFERENCES supply_request_items(id) ON DELETE RESTRICT,

    actual_quantity         numeric(14,3) NOT NULL CHECK (actual_quantity > 0),

    unit                    varchar(30) NOT NULL,

    note                    text,

    UNIQUE (delivery_id, supply_request_item_id)

);

-- A DeliveryItem must belong to a SupplyRequestItem of the Delivery's SupplyRequest.

-- One delivered ingredient line can contain multiple supplier lots/batches.

CREATE TABLE ingredient_lots (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    delivery_item_id    uuid NOT NULL REFERENCES delivery_items(id) ON DELETE RESTRICT,

    source_facility_id  uuid REFERENCES source_facilities(id) ON DELETE RESTRICT,

    qr_token            varchar(160) NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,

    lot_code            varchar(120) NOT NULL,

    manufacture_date    date,

    expiry_date         date,

    received_quantity   numeric(14,3) NOT NULL CHECK (received_quantity > 0),

    available_quantity  numeric(14,3) NOT NULL DEFAULT 0 CHECK (available_quantity >= 0),

    unit                varchar(30) NOT NULL,

    status              ingredient_lot_status NOT NULL DEFAULT 'BLOCKED',

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (delivery_item_id, lot_code),

    CONSTRAINT chk_lot_dates

        CHECK (expiry_date IS NULL OR manufacture_date IS NULL OR expiry_date >= manufacture_date),

    CONSTRAINT chk_lot_available_quantity

        CHECK (available_quantity <= received_quantity)

);

-- The selected source facility must belong to the Supplier that delivered the lot.

CREATE TABLE inventory_transactions (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    ingredient_lot_id   uuid NOT NULL REFERENCES ingredient_lots(id) ON DELETE RESTRICT,

    movement_type       inventory_movement_type NOT NULL,

    quantity            numeric(14,3) NOT NULL CHECK (quantity > 0),

    unit                varchar(30) NOT NULL,

    created_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,

    reference_type      varchar(80),

    reference_id        uuid,

    note                text,

    occurred_at         timestamptz NOT NULL DEFAULT now(),

    created_at          timestamptz NOT NULL DEFAULT now()

);

-- There is exactly one initial RECEIPT inventory transaction per lot.

CREATE UNIQUE INDEX uq_inventory_initial_receipt_per_lot

    ON inventory_transactions (ingredient_lot_id)

    WHERE movement_type = 'RECEIPT';

-- Before marking a Delivery as RECEIVED:

--   * it must previously be APPROVED;

--   * receiving actor/time must be recorded;

--   * every DeliveryItem must have Lot data;

--   * the sum of Lot quantities for each DeliveryItem must equal actual_quantity.

-- When an APPROVED Delivery is confirmed as RECEIVED, release its lots into

-- inventory and create the initial RECEIPT movement for each lot.

-- ============================================================================

-- 9. MENU, DISH & MENU REVIEW RECORD

-- ============================================================================

CREATE TABLE weekly_menus (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    created_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    week_start_date     date NOT NULL,

    title               varchar(255),

    status              weekly_menu_status NOT NULL DEFAULT 'DRAFT',

    submitted_at        timestamptz,

    approved_at         timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, week_start_date)

);

CREATE TABLE menu_days (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    weekly_menu_id  uuid NOT NULL REFERENCES weekly_menus(id) ON DELETE CASCADE,

    menu_date       date NOT NULL,

    note            text,

    created_at      timestamptz NOT NULL DEFAULT now(),

    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (weekly_menu_id, menu_date)

);

-- school_id is a physical scoping key. It makes it possible to enforce that

-- a Dish and its IngredientEntry recipe belong to the same School. This does

-- not change the conceptual ERD's main business relationships.

CREATE TABLE dishes (

    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    name            varchar(255) NOT NULL,

    description     text,

    status          entity_status NOT NULL DEFAULT 'ACTIVE',

    created_at      timestamptz NOT NULL DEFAULT now(),

    updated_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (school_id, name)

);

-- Physical table for conceptual relationship:

-- MenuDay M:N Dish -- CONTAINS [portion]

CREATE TABLE menu_day_dishes (

    menu_day_id     uuid NOT NULL REFERENCES menu_days(id) ON DELETE CASCADE,

    dish_id         uuid NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT,

    meal_type       meal_type NOT NULL,

    portion_size    numeric(12,3),

    portion_unit    varchar(30),

    display_order   integer CHECK (display_order IS NULL OR display_order > 0),

    PRIMARY KEY (menu_day_id, dish_id, meal_type)

);

-- Physical table for conceptual relationship:

-- Dish M:N IngredientEntry -- CONTAINS [requiredQuantity]

CREATE TABLE dish_ingredient_entries (

    dish_id             uuid NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,

    ingredient_entry_id uuid NOT NULL REFERENCES ingredient_entries(id) ON DELETE RESTRICT,

    required_quantity   numeric(14,3) NOT NULL CHECK (required_quantity > 0),

    unit                varchar(30) NOT NULL,

    PRIMARY KEY (dish_id, ingredient_entry_id)

);

CREATE TABLE menu_review_records (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    weekly_menu_id      uuid NOT NULL REFERENCES weekly_menus(id) ON DELETE CASCADE,

    reviewer_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    decision            menu_review_decision NOT NULL,

    feedback            text,

    reviewed_at         timestamptz NOT NULL DEFAULT now(),

    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_revision_feedback

        CHECK (decision <> 'REVISION_REQUESTED' OR feedback IS NOT NULL)

);

-- MenuReviewRecord itself is the review transaction/history row.

-- ============================================================================

-- 10. COOKING & TRACEABILITY

-- ============================================================================

CREATE TABLE cooking_batches (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    batch_code          varchar(100) NOT NULL UNIQUE,

    menu_day_id         uuid NOT NULL REFERENCES menu_days(id) ON DELETE RESTRICT,

    dish_id             uuid NOT NULL REFERENCES dishes(id) ON DELETE RESTRICT,

    meal_type           meal_type NOT NULL,

    cooking_mode_applied cooking_mode NOT NULL,

    created_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    status              cooking_batch_status NOT NULL DEFAULT 'UNCONFIRMED',

    planned_portions    integer CHECK (planned_portions IS NULL OR planned_portions >= 0),

    prepared_portions   integer CHECK (prepared_portions IS NULL OR prepared_portions >= 0),

    note                text,

    confirmed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    confirmed_at        timestamptz,

    completed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    completed_at        timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_cooking_batch_menu_dish_meal

        FOREIGN KEY (menu_day_id, dish_id, meal_type)

        REFERENCES menu_day_dishes(menu_day_id, dish_id, meal_type) ON DELETE RESTRICT,

    CONSTRAINT chk_cooking_batch_lifecycle CHECK (

        (status = 'UNCONFIRMED'

            AND confirmed_at IS NULL AND confirmed_by_user_id IS NULL

            AND completed_at IS NULL AND completed_by_user_id IS NULL

            AND prepared_portions IS NULL)

        OR (status = 'CONFIRMED'

            AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL

            AND completed_at IS NULL AND completed_by_user_id IS NULL

            AND prepared_portions IS NULL AND planned_portions IS NOT NULL AND planned_portions > 0)

        OR (status = 'COMPLETED'

            AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL

            AND completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL

            AND prepared_portions IS NOT NULL AND prepared_portions >= 0

            AND planned_portions IS NOT NULL AND planned_portions > 0)

    )

);

-- CookingBatch must use a menu dish of the selected meal, school policy snapshot,

-- and school-configured service time. The policy snapshot never changes afterwards.

-- Strict progression. Plan cannot be edited after confirmation; only result fields

-- and status may change during the CONFIRMED -> COMPLETED transition.

-- IMPORTANT: this function references cooking_batch_lots that is created below;

-- PostgreSQL validates PL/pgSQL relations when the function executes, not at declaration.

-- Physical table for conceptual relationship:

-- CookingBatch M:N IngredientLot -- USES [quantityUsed]

CREATE TABLE cooking_batch_lots (

    cooking_batch_id    uuid NOT NULL REFERENCES cooking_batches(id) ON DELETE CASCADE,

    ingredient_lot_id   uuid NOT NULL REFERENCES ingredient_lots(id) ON DELETE RESTRICT,

    planned_quantity    numeric(14,3) NOT NULL CHECK (planned_quantity > 0),

    quantity_used       numeric(14,3) CHECK (quantity_used IS NULL OR quantity_used > 0),

    unit                varchar(30) NOT NULL,

    PRIMARY KEY (cooking_batch_id, ingredient_lot_id)

);

-- One batch uses one lot per ingredient when School chooses SEPARATE_BY_LOT.

-- Different recipe ingredients can (and usually must) coexist within one batch.

-- Every selected lot must belong to the batch's School and to the recipe.

-- Deduct actual stock exactly once when a batch is completed, within one DB transaction.

-- IMPORTANT: the API MUST NOT subtract inventory a second time.

CREATE UNIQUE INDEX uq_inventory_usage_per_batch_lot

ON inventory_transactions (ingredient_lot_id, reference_id)

WHERE movement_type = 'COOKING_USAGE' AND reference_type = 'COOKING_BATCH';

CREATE TABLE retained_food_samples (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    cooking_batch_id    uuid NOT NULL UNIQUE REFERENCES cooking_batches(id) ON DELETE RESTRICT,

    recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    sampled_at          timestamptz NOT NULL DEFAULT now(),

    quantity            numeric(12,3),

    unit                varchar(30),

    storage_location    varchar(255),

    status              retained_sample_status NOT NULL DEFAULT 'STORED',

    disposed_at         timestamptz,

    disposal_note       text,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_sample_disposal

        CHECK (

            (status = 'STORED' AND disposed_at IS NULL)

            OR

            (status = 'DISPOSED' AND disposed_at IS NOT NULL)

        )

);

-- ============================================================================

-- 11. MEAL ALLOCATION, COMPLAINT & SAFETY

-- ============================================================================

CREATE TABLE meal_allocations (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    daily_meal_portion_id uuid NOT NULL UNIQUE REFERENCES daily_meal_portions(id) ON DELETE RESTRICT,

    created_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    status              meal_allocation_status NOT NULL DEFAULT 'ALLOCATED',

    allocated_at        timestamptz NOT NULL DEFAULT now(),

    distributed_at      timestamptz,

    distributed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    finalized_at        timestamptz,

    note                text,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_meal_allocation_dates

        CHECK (

            (status = 'ALLOCATED' AND distributed_at IS NULL AND distributed_by_user_id IS NULL AND finalized_at IS NULL)

            OR (status = 'DISTRIBUTED' AND distributed_at IS NOT NULL AND distributed_by_user_id IS NOT NULL AND finalized_at IS NULL)

            OR (status = 'FINALIZED' AND distributed_at IS NOT NULL AND distributed_by_user_id IS NOT NULL AND finalized_at IS NOT NULL)

            OR (status = 'CANCELLED' AND distributed_at IS NULL AND finalized_at IS NULL)

        )

);

-- Physical table for conceptual relationship:

-- MealAllocation M:N CookingBatch -- ALLOCATED FROM [allocatedQuantity]

CREATE TABLE meal_allocation_batches (

    meal_allocation_id  uuid NOT NULL REFERENCES meal_allocations(id) ON DELETE CASCADE,

    cooking_batch_id    uuid NOT NULL REFERENCES cooking_batches(id) ON DELETE RESTRICT,

    allocated_portions  integer NOT NULL CHECK (allocated_portions > 0),

    PRIMARY KEY (meal_allocation_id, cooking_batch_id)

);

-- Distribution is explicitly acknowledged by a kitchen-staff user; time from database.

-- Protect batch capacity across concurrent allocations by locking the batch row.

-- Ensure same School / meal date / meal slot before writing a line.

-- Complete-meal rule: every Dish assigned to that meal slot must contribute

-- exactly total_portions portions; sums across dishes are NOT meal counts.

-- Deferred check lets API create header + all lines in ONE transaction.

CREATE TABLE meal_complaints (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    meal_allocation_id  uuid NOT NULL REFERENCES meal_allocations(id) ON DELETE RESTRICT,

    submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    complaint_type      meal_complaint_type NOT NULL,

    description         text NOT NULL,

    status              complaint_status NOT NULL DEFAULT 'SUBMITTED',

    handled_by_user_id  uuid REFERENCES users(id) ON DELETE RESTRICT,

    resolution          text,

    submitted_at        timestamptz NOT NULL DEFAULT now(),

    resolved_at         timestamptz,

    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_complaint_resolution

        CHECK (

            status NOT IN ('RESOLVED','CLOSED')

            OR resolution IS NOT NULL

        )

);

CREATE TABLE food_safety_incidents (

    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id           uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,

    reported_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,

    title               varchar(255) NOT NULL,

    description         text NOT NULL,

    status              incident_status NOT NULL DEFAULT 'OPEN',

    occurred_at         timestamptz,

    resolved_at         timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),

    updated_at          timestamptz NOT NULL DEFAULT now()

);

-- A food-safety incident can affect one or more served class meals.

-- From MealAllocation we can trace:

--   MealAllocation -> DailyMealPortion -> Class

--   MealAllocation -> CookingBatch -> IngredientLot

CREATE TABLE food_safety_incident_allocations (

    incident_id        uuid NOT NULL REFERENCES food_safety_incidents(id) ON DELETE CASCADE,

    meal_allocation_id uuid NOT NULL REFERENCES meal_allocations(id) ON DELETE RESTRICT,

    note               text,

    PRIMARY KEY (incident_id, meal_allocation_id)

);

-- Ensure the linked MealAllocation belongs to the same School as the incident.

-- ============================================================================

-- Supplier-facing feedback about ingredient quality at delivery.
-- This is separate from meal_complaints, which is about served meals.
CREATE TABLE ingredient_quality_feedback (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id         uuid NOT NULL REFERENCES deliveries(id) ON DELETE RESTRICT,
    ingredient_lot_id   uuid REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
    submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title               varchar(255) NOT NULL,
    description         text NOT NULL,
    status              ingredient_quality_feedback_status NOT NULL DEFAULT 'SUBMITTED',
    supplier_response   text,
    responded_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    responded_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ingredient_feedback_response
        CHECK (
            (status = 'SUBMITTED' AND supplier_response IS NULL
                AND responded_by_user_id IS NULL AND responded_at IS NULL)
            OR
            (status = 'RESPONDED' AND supplier_response IS NOT NULL
                AND responded_by_user_id IS NOT NULL AND responded_at IS NOT NULL)
        )
);

CREATE TABLE food_safety_report_forwardings (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             uuid NOT NULL REFERENCES food_safety_incidents(id) ON DELETE RESTRICT,
    recipient_commune_food_safety_unit_id uuid REFERENCES commune_food_safety_units(id) ON DELETE RESTRICT,
    recipient_organization  varchar(255) NOT NULL,
    recipient_name          varchar(255),
    recipient_email         citext,
    recipient_phone         varchar(30),
    forwarding_channel      varchar(60),
    reference_number        varchar(120),
    status                  notification_status NOT NULL DEFAULT 'PENDING',
    forwarded_by_user_id    uuid REFERENCES users(id) ON DELETE RESTRICT,
    attempted_at            timestamptz,
    forwarded_at            timestamptz,
    note                    text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_report_forwarding_sent
        CHECK (status <> 'SENT' OR forwarded_at IS NOT NULL)
);

CREATE TABLE food_analysis_results (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id             uuid NOT NULL REFERENCES food_safety_incidents(id) ON DELETE RESTRICT,
    ingredient_lot_id       uuid REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
    retained_food_sample_id uuid REFERENCES retained_food_samples(id) ON DELETE RESTRICT,
    laboratory_name         varchar(255),
    report_number           varchar(120),
    test_type               varchar(160),
    sample_description      text,
    sampled_at              timestamptz,
    tested_at               timestamptz,
    result_summary          text NOT NULL,
    document_url            text,
    recorded_by_user_id     uuid REFERENCES users(id) ON DELETE RESTRICT,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_food_analysis_target
        CHECK (
            ingredient_lot_id IS NOT NULL
            OR retained_food_sample_id IS NOT NULL
            OR sample_description IS NOT NULL
        )
);

CREATE TABLE incident_school_alerts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         uuid NOT NULL REFERENCES food_safety_incidents(id) ON DELETE CASCADE,
    target_school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
    sent_by_user_id     uuid REFERENCES users(id) ON DELETE RESTRICT,
    message             text NOT NULL,
    status              notification_status NOT NULL DEFAULT 'PENDING',
    attempted_at        timestamptz,
    sent_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_incident_alert_sent
        CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);

CREATE TABLE traceability_anchors (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id                 uuid REFERENCES deliveries(id) ON DELETE RESTRICT,
    ingredient_lot_id           uuid REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
    cooking_batch_id            uuid REFERENCES cooking_batches(id) ON DELETE RESTRICT,
    meal_allocation_id          uuid REFERENCES meal_allocations(id) ON DELETE RESTRICT,
    food_safety_incident_id     uuid REFERENCES food_safety_incidents(id) ON DELETE RESTRICT,
    payload_hash                varchar(128) NOT NULL,
    hash_algorithm              varchar(30) NOT NULL DEFAULT 'SHA-256',
    network_name                varchar(80) NOT NULL,
    contract_address            varchar(100),
    transaction_hash            varchar(100),
    block_number                bigint CHECK (block_number IS NULL OR block_number >= 0),
    anchor_status               blockchain_anchor_status NOT NULL DEFAULT 'PREPARED',
    verification_status         blockchain_verification_status NOT NULL DEFAULT 'NOT_VERIFIED',
    verified_at                 timestamptz,
    verification_result         text,
    created_by_user_id          uuid REFERENCES users(id) ON DELETE RESTRICT,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_traceability_anchor_target
        CHECK (num_nonnulls(
            delivery_id, ingredient_lot_id, cooking_batch_id,
            meal_allocation_id, food_safety_incident_id
        ) = 1),
    CONSTRAINT chk_traceability_anchor_tx
        CHECK (anchor_status NOT IN ('SUBMITTED', 'CONFIRMED') OR transaction_hash IS NOT NULL),
    CONSTRAINT chk_traceability_verification_time
        CHECK (verification_status NOT IN ('VERIFIED', 'MISMATCH') OR verified_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_traceability_anchor_tx_hash
    ON traceability_anchors (transaction_hash)
    WHERE transaction_hash IS NOT NULL;

-- No updated_at triggers: Backend/ORM owns updated_at values.

-- ============================================================================

-- 13. INDEXES

-- ============================================================================

CREATE INDEX idx_users_school_id ON users(school_id);
CREATE INDEX idx_users_supplier_id ON users(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX idx_users_commune_food_safety_unit_id ON users(commune_food_safety_unit_id) WHERE commune_food_safety_unit_id IS NOT NULL;
CREATE INDEX idx_source_facilities_supplier_status ON source_facilities(supplier_id, status);
CREATE INDEX idx_source_facilities_visibility ON source_facilities(supplier_id, is_visible);
CREATE INDEX idx_ingredient_lots_source_facility ON ingredient_lots(source_facility_id);
CREATE INDEX idx_supply_requests_accepted_by ON supply_requests(accepted_by_user_id);
CREATE INDEX idx_deliveries_created_by ON deliveries(created_by_user_id);
CREATE INDEX idx_ingredient_quality_feedback_delivery ON ingredient_quality_feedback(delivery_id, created_at DESC);
CREATE INDEX idx_ingredient_quality_feedback_status ON ingredient_quality_feedback(status, created_at DESC);
CREATE INDEX idx_food_safety_forwardings_incident ON food_safety_report_forwardings(incident_id, created_at DESC);
CREATE INDEX idx_food_safety_forwardings_recipient_unit ON food_safety_report_forwardings(recipient_commune_food_safety_unit_id, created_at DESC) WHERE recipient_commune_food_safety_unit_id IS NOT NULL;
CREATE INDEX idx_food_analysis_results_incident ON food_analysis_results(incident_id, tested_at DESC);

CREATE INDEX idx_incident_school_alerts_target ON incident_school_alerts(target_school_id, created_at DESC);
CREATE INDEX idx_traceability_anchors_lot ON traceability_anchors(ingredient_lot_id);
CREATE INDEX idx_traceability_anchors_batch ON traceability_anchors(cooking_batch_id);
CREATE INDEX idx_traceability_anchors_allocation ON traceability_anchors(meal_allocation_id);

CREATE INDEX idx_users_role_id ON users(role_id);

CREATE INDEX idx_classes_school_id ON classes(school_id);

CREATE INDEX idx_daily_meal_portions_date ON daily_meal_portions(meal_date);

CREATE INDEX idx_daily_allergy_portions_class_entry ON daily_allergy_portions(class_id, ingredient_entry_id);

CREATE INDEX idx_supplier_certifications_supplier ON supplier_certifications(supplier_id);

CREATE INDEX idx_ingredients_supplier_id ON ingredients(supplier_id);

CREATE INDEX idx_ingredient_entries_school_id ON ingredient_entries(school_id);

CREATE INDEX idx_ingredient_entries_ingredient_id ON ingredient_entries(ingredient_id);

CREATE INDEX idx_supply_requests_school_status ON supply_requests(school_id, status);

CREATE INDEX idx_supply_requests_supplier_status ON supply_requests(supplier_id, status);

CREATE INDEX idx_deliveries_request_status ON deliveries(supply_request_id, status);

CREATE INDEX idx_delivery_approvals_delivery ON delivery_approvals(delivery_id);

CREATE INDEX idx_delivery_items_delivery ON delivery_items(delivery_id);

CREATE INDEX idx_delivery_items_request_item ON delivery_items(supply_request_item_id);

CREATE INDEX idx_ingredient_lots_delivery_item ON ingredient_lots(delivery_item_id);

CREATE INDEX idx_ingredient_lots_expiry_date ON ingredient_lots(expiry_date);

CREATE INDEX idx_inventory_transactions_lot_time ON inventory_transactions(ingredient_lot_id, occurred_at DESC);

CREATE INDEX idx_weekly_menus_school_week ON weekly_menus(school_id, week_start_date);

CREATE INDEX idx_menu_days_menu_date ON menu_days(weekly_menu_id, menu_date);

CREATE INDEX idx_menu_review_records_menu_time ON menu_review_records(weekly_menu_id, reviewed_at DESC);

CREATE INDEX idx_cooking_batches_menu_day ON cooking_batches(menu_day_id);

CREATE INDEX idx_cooking_batches_dish ON cooking_batches(dish_id);

CREATE INDEX idx_cooking_batch_lots_lot ON cooking_batch_lots(ingredient_lot_id);

CREATE INDEX idx_meal_complaints_allocation ON meal_complaints(meal_allocation_id);

CREATE INDEX idx_food_safety_incidents_school_status ON food_safety_incidents(school_id, status);

CREATE INDEX idx_food_safety_incident_allocations_allocation ON food_safety_incident_allocations(meal_allocation_id);

CREATE INDEX idx_dmp_class_date_meal ON daily_meal_portions(class_id, meal_date, meal_type);

CREATE INDEX idx_menu_day_dishes_meal ON menu_day_dishes(menu_day_id, meal_type);

CREATE INDEX idx_cooking_batches_meal_state ON cooking_batches(menu_day_id, meal_type, status);

CREATE INDEX idx_meal_allocation_batches_batch ON meal_allocation_batches(cooking_batch_id);

-- ============================================================================

-- 14. DATABASE COMMENTS FOR IMPORTANT MODELING RULES

-- ============================================================================

COMMENT ON COLUMN roles.type IS

'Organizational role group: SYSTEM for System Admin, SCHOOL for school-side actors, SUPPLIER for Ingredient Supplier.';

COMMENT ON COLUMN ingredient_entries.handling_type IS

'School-specific handling method: DRY_STOCK = dry goods kept across days (rice, salt, spices); DIRECT_USE = fresh ingredients received and prepared the same day. Both types retain lots and inventory movement/traceability records.';

COMMENT ON TABLE class_allergies IS

'Physical table for conceptual M:N relationship Class HAS ALLERGY IngredientEntry. No Student entity; affected_count is a class-level aggregate.';

COMMENT ON TABLE daily_allergy_portions IS

'Daily allergy-specific portion count for one DailyMealPortion and one class-level allergy pair (Class, IngredientEntry).';

COMMENT ON TABLE supply_request_items IS

'Physical table for conceptual M:N relationship SupplyRequest REQUESTS IngredientEntry.';

COMMENT ON TABLE delivery_approvals IS

'Physical table for conceptual User APPROVES INCOMING Delivery relationship. One decision per required role per Delivery.';

COMMENT ON TABLE delivery_items IS

'Actual ingredient lines in a Delivery. Each row references the corresponding SupplyRequestItem and can contain multiple IngredientLot rows.';

COMMENT ON TABLE menu_review_records IS

'Each row is one menu review transaction/decision. No separate MenuReviewTransaction table is needed.';

COMMENT ON TABLE cooking_batch_lots IS

'Physical table for conceptual M:N relationship CookingBatch USES IngredientLot.';

COMMENT ON TABLE retained_food_samples IS

'Current project rule: one CookingBatch has at most one retained sample; enforced by UNIQUE(cooking_batch_id).';

COMMENT ON TABLE meal_allocation_batches IS

'Physical table for conceptual M:N relationship MealAllocation ALLOCATED FROM CookingBatch.';

COMMENT ON TABLE food_safety_incidents IS

'Food-safety incident header at School level. Affected class meals are linked through food_safety_incident_allocations for traceability to Class, CookingBatch and IngredientLot.';

COMMENT ON TABLE food_safety_incident_allocations IS

'Links a food-safety incident to affected MealAllocation records; trace Class via DailyMealPortion and source batches/lots via MealAllocationBatch and CookingBatchLot.';

-- Version 4 decisions retained in v5.1. SRS must align with this implementation:

COMMENT ON COLUMN schools.cooking_mode IS

'Configured by authorized school actor; SEPARATE_BY_LOT or COMBINE_LOTS. NULL until configured; kitchen cannot override in CookingBatch.';

COMMENT ON COLUMN schools.lunch_time IS 'School local time for lunch service; setup before lunch batch creation.';

COMMENT ON COLUMN schools.afternoon_meal_time IS 'School local time for afternoon meal; setup before afternoon batch creation.';

COMMENT ON COLUMN daily_meal_portions.meal_type IS 'Demand scoped to LUNCH or AFTERNOON; unique per Class/date/meal.';

COMMENT ON COLUMN menu_day_dishes.meal_type IS 'Dish inclusion scoped to meal slot. A Dish can appear in both meal slots of one MenuDay.';

COMMENT ON COLUMN dish_ingredient_entries.required_quantity IS

'Ingredient quantity for ONE standard serving of this Dish. Total demand = required_quantity times serving count (convert units consistently).';

COMMENT ON COLUMN menu_day_dishes.portion_size IS

'Optional planned dish portion presentation/size, NOT a recipe multiplier by default. Do not multiply required_quantity by portion_size and serving count again.';

COMMENT ON COLUMN cooking_batches.meal_type IS 'Meal slot inherited from selected MenuDay-Dish entry.';

COMMENT ON COLUMN cooking_batches.cooking_mode_applied IS 'Snapshot of school policy at creation; old batches unaffected by later school configuration changes.';

COMMENT ON COLUMN cooking_batches.confirmed_at IS 'Time kitchen confirmed the PLAN, BEFORE cooking (not completion time).';

COMMENT ON COLUMN cooking_batches.completed_at IS 'Time cooking result was recorded; COMPLETED is required for meal allocation.';

COMMENT ON COLUMN cooking_batches.prepared_portions IS 'Actual cooked portions, NULL until COMPLETED; never use planned_portions for allocation.';

COMMENT ON COLUMN cooking_batch_lots.planned_quantity IS 'Planned ingredient quantity from this IngredientLot before cooking.';

COMMENT ON COLUMN cooking_batch_lots.quantity_used IS 'Actual quantity consumed; written after plan confirmation and before completion, NULL earlier.';

COMMENT ON COLUMN meal_allocations.distributed_by_user_id IS

'School Kitchen Staff user who explicitly confirmed actual class meal distribution.';

COMMENT ON TABLE meal_allocation_batches IS

'Batch portions from completed CookingBatch. Complete meal validation totals portions PER Dish; allocation aggregate lacks allergen-specific batch split, so app must validate allergy safety separately.';

-- ============================================================================

COMMENT ON COLUMN schools.website_url IS
'Optional public website URL for the School profile.';

COMMENT ON TABLE source_facilities IS
'Supplier-owned source/production facilities. IngredientLot may record the facility that supplied that specific lot.';

COMMENT ON COLUMN ingredient_lots.source_facility_id IS
'Optional origin facility for this lot; when set, it must belong to the Supplier that delivered the lot.';

COMMENT ON COLUMN ingredient_lots.qr_token IS
'Stable opaque token suitable for generating a QR link; the QR image itself is generated by the application.';

COMMENT ON TABLE ingredient_quality_feedback IS
'Feedback about ingredient quality on delivery/lot. Separate from meal_complaints, which concerns served meals. Only the Delivery Supplier may respond.';

COMMENT ON TABLE food_safety_report_forwardings IS
'Audit trail of food-safety reports forwarded to external recipients; recipient details are stored as text because external authorities are not platform users.';

COMMENT ON TABLE food_analysis_results IS
'Records food or ingredient analysis/test results associated with a FoodSafetyIncident. Does not imply any laboratory integration.';

COMMENT ON TABLE incident_school_alerts IS
'Tracks food-safety alerts intended for other schools. No Student-level data is introduced.';

COMMENT ON TABLE traceability_anchors IS
'Optional Blockchain evidence metadata. PostgreSQL remains the business source of truth; rows may be PREPARED without a submitted transaction.';

COMMENT ON COLUMN users.supplier_id IS
'Many Supplier users may reference one Supplier; role and organization authorization must be enforced by the application and relevant service logic.';

COMMENT ON TABLE school_supplier_relationships IS
'Stores School-Supplier partnership history. SUSPENDED means temporarily paused; UNLINKED means the relationship has ended.';

-- ============================================================================

COMMIT;
