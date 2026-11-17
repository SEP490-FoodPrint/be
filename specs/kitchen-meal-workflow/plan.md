# Plan

## Constitution Check

- Business logic stays in `kitchen.service.ts`; no Prisma query arguments are added to the service, no repository or schema change.
- Validation keeps `z.strictObject`; only the comment describing `dishId` changes.
- The planning transaction, row lock on `menu_days`, tenant scope from `AuthPrincipal`, stock reservation and seasoning rules are unchanged.
- No migration, seed, reset or remote database operation.

## Approach

1. In `executePlan`, filter `menu.menuDayDishes` by `input.dishId` (when present) before building recipes. Meal-level guards run before the filter.
2. Compute `batchNumber` from a per-dish counter seeded with the meal's existing batches.
3. Frontend sends `dishId` to the preview and create calls from the "Nấu" button.

## Verification

- `npm run typecheck`, ESLint and Prettier on changed files.
- `npm run test:unit`.
- PostgreSQL integration tests (`test:local` kitchen groups) when a disposable local instance is configured.
