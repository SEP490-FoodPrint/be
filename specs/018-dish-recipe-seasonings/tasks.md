# Tasks

- [x] Add additive migration and schema field; leave legacy classification NULL.
- [x] Add scoped database recipe catalog, options, writes and aggregation.
- [x] Snapshot database recipes on explicit recipe-based menu saves.
- [x] Connect catalog and weekly menu selection to real APIs.
- [x] Verify source and report tests and deployment status.
- [ ] Apply migration using Prisma from an environment with working TLS; the authorized attempt here failed before changing Azure.
- [ ] Execute disposable PostgreSQL integration and browser verification with a signed-in nutrition account.

## Confirmed follow-up

- [x] Expand BGH holiday ranges, preserve reasons, expose schedule holiday flags and exclude holidays from submission completeness.
- [x] Display holiday reasons and red borders in the list and creation grid.
- [x] Check database recipe ingredients and seasonings against class allergy records in the creation modal.
- [x] Accept explicit portion groups atomically with menu writes and preserve finalized-group locks.
- [x] Keep seasonings shared as confirmed by the user; reject any shared seasoning or substitute dish containing a group's avoided ingredient.
- [x] Require coverage for recorded allergy conflicts before submission.
- [x] Pass the 274-test database-free suite, backend typecheck and frontend build; retain the earlier Azure deployment blocker until an operator applies the migration.

## Kitchen follow-up

- [x] Verify finalized group demand includes manually chosen allergy substitute dishes.
- [x] Match grouped child dishes when loading existing plans and updating the whole meal after planning.
- [x] Open the real sample-entry form immediately after the selected child completes; continue with unsampled dishes in that child.
- [x] Pass 26 frontend API/adapter tests and nine existing backend grouped-planning/sample tests. Database integration and authenticated UI verification remain external prerequisites.
