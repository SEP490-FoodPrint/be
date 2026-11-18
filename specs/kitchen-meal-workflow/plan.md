# Plan

## Constitution Check

- Business logic stays in `kitchen.service.ts`; no Prisma query arguments are added to the service, no repository or schema change.
- Validation keeps `z.strictObject`; only the comment describing `dishId` changes.
- The planning transaction, row lock on `menu_days`, tenant scope from `AuthPrincipal`, stock reservation and seasoning rules are unchanged.
- No migration, seed, reset or remote database operation.
- FR-008 is a request-validation rule in `retained-sample.validation.ts` (`superRefine` on `foodSampleSchema`); no service, repository or schema change.
- FR-009 reuses `expandMenuHolidays` and `repository.academicYears`; the guard runs on the client-submitted days only, so existing holiday days already stored do not block editing other days.
- FR-010/FR-011 live in `meal-attendance.service.ts` (business rules) with two read-only repository queries; the service gains an injectable clock for tests. No schema change.
- FR-012 compares submitted past days with stored days by `(mealType, dishId)`; ingredient quantity edits on an unchanged dish list are not detected (the frontend locks past days).
- FR-013 uses existing `menu_review_records` (decision `REVISION_REQUESTED`) as the exception signal, because `submittedAt` is reset on every edit. No schema change.
- FR-014 reuses `assertReceipt` and `verifyRequestDeliveryReceipt` inside a non-writing `receiptIssue` helper; standalone deliveries simulate the entry attachment in memory. The final-approval write path is unchanged. No schema change.
- FR-015 is a business rule in `kitchen.service.ts` `executePlan`, checked after the menu approval guard and before any stock read or write. No schema change.
- FR-016 uses the existing `retained_food_samples.storage_unit_id` column and `sample_storage_units`; no migration. The capacity check counts `STORED` samples in the transaction after locking the unit row.
- FR-017 extends the existing lot date check in `assertReceipt`; it runs both in the read-only `receiptIssue` and in the final approval. No schema change.
- FR-018 is opt-in so the default safe list projection and its tests stay unchanged; the extra fields match the existing school detail response. No schema change.
- FR-019 writes the existing `ingredient_lots.manufacture_date`/`expiry_date` columns; handling type comes from the school ingredient entry. No schema change.
- FR-020 derives the status at read time instead of a scheduled write, so no background job is needed and stored history stays unchanged.
- FR-021 needs no migration: codes are computed from existing columns (`lot_code`, `batch_code`, `code`) with `pg_advisory_xact_lock(hashtext('foodprint:fp-code:<type>'))`; regex filtering precedes the numeric cast so legacy codes never break the query.

## Approach

1. In `executePlan`, filter `menu.menuDayDishes` by `input.dishId` (when present) before building recipes. Meal-level guards run before the filter.
2. Compute `batchNumber` from a per-dish counter seeded with the meal's existing batches.
3. Frontend sends `dishId` to the preview and create calls from the "Nấu" button.

## Verification

- `npm run typecheck`, ESLint and Prettier on changed files.
- `npm run test:unit`.
- PostgreSQL integration tests (`test:local` kitchen groups) when a disposable local instance is configured.
