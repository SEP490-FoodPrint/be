# Tasks: Cooking batch groups

## Setup

- [x] T001 Read repository rules, current cooking schema, planning and inventory lifecycle.
- [x] T002 Record approved grouping rule: school cooking mode applies to every dish in the meal.

## Database

- [x] T003 Add parent batch, child reference and child-dish/ingredient-lot models in `prisma/schema.prisma`.
- [x] T004 Add expand/backfill SQL migration preserving legacy UUIDs, batch codes and all traceability references.
- [x] T005 Generate Prisma client, validate the schema and prepare the migration integration contract without deploying to configured DB.

## Backend

- [x] T006 Define grouped plan request and response contracts in the kitchen validation and DTO files.
- [x] T007 Load approved meal, per-dish demand and recipes; plan child groups using school cooking mode.
- [x] T008 Persist parent, children and per-dish ingredient allocations atomically; preserve seasoning reservations.
- [x] T009 Update confirmation, completion, inventory posting, demand checks and parent/child serialization.
- [x] T010 Update kitchen reads, retained sample projections and meal-allocation reads to preserve dish-level identity and parent grouping.
- [x] T011 Preserve deletion, tenant authorization, locks, lifecycle constraints and idempotent inventory operations.

## Verification

- [x] T012 Run applicable Prisma validation/generation, formatting, typecheck, build and existing infrastructure-free tests.
- [x] T013 Record schema migration deployment limitation and final scope in this plan.

- [ ] T014 External verification: execute the migration/backfill suite and authorization integration suite on an explicitly selected disposable local PostgreSQL instance or CI. Local Docker was unavailable; installed PostgreSQL initdb was blocked by Windows sandbox restricted-token errors. No configured Azure database was used.

T012 completed the applicable local checks. Full validate stops at pre-existing formatting failures outside this change; see plan.md for exact results. T014 and database deployment are not claimed as completed.
