# Implementation Plan: Cooking batch groups

**Branch**: `feat/013-cooking-batch-groups` | **Spec**: [spec.md](spec.md)

## Design

Extend the existing model without rewriting historical identities: `CookingBatchGroup` owns menu day/meal and parent display code; each existing `CookingBatch` is a child execution unit linked by `batchGroupId`; `CookingBatchDish` stores one recipe/demand allocation in that child; ingredient allocations identify the child dish so multiple recipes may consume the same stock lot without key collisions. Expand `cooking_batch_lots` with `dish_id` and a composite dish FK, preserving every old quantity through a backfill. Samples, meal allocations, traceability and inventory references remain addressable by child IDs; API DTOs additionally expose the parent and child dishes.

Planning reads the authoritative school mode and all dish recipes and finalized per-dish demand for one approved meal. For each dish independently, run the existing inventory planner to determine portions and lot allocations. Merge the resulting portions across recipes into child execution groups by matching portion ranges; a dish portion/lot allocation must occur in exactly one child. Keep writes and seasonings in the existing school transaction. Aggregate usage by child/lot; parent grouping does not change the existing consumption idempotency key.

## Constitution Check

| Principle               | Result | Design                                                                                                          |
| ----------------------- | ------ | --------------------------------------------------------------------------------------------------------------- |
| I. Layered architecture | PASS   | Add operation-specific persistence and separate request/response DTOs in kitchen; callers use stable contracts. |
| II. Tenant isolation    | PASS   | Existing trusted school scope and ownership checks remain authoritative.                                        |
| III. Database safety    | PASS   | New immutable versioned expand/backfill migration only; no migration deployment or DB push.                     |
| IV. Atomicity           | PASS   | Header, children, dish/lot allocations and reservations use the existing transaction.                           |
| V. HTTP contract        | PASS   | Preserve envelope; expose grouping and dish detail explicitly.                                                  |
| VI. Spec-driven         | PASS   | Spec, plan, tasks precede source changes on matching branch.                                                    |

## Migration strategy

Add nullable `batch_group_id` to existing cooking batches, create one parent for each legacy child with the same UUID and the old child `batch_code` as the initial parent code, backfill child dish rows and per-dish lot rows, then make new relations required. Keep child UUIDs stable so foreign keys, samples, meal allocations, anchors, and inventory transaction references remain valid. Preserve each old `batch_code` as a child code during expand phase; do not guess aggregate parent codes from UUID strings. Validate row counts and orphan checks before tightening nullability. Keep prior migrations immutable.

## Validation strategy

Run formatting, Prisma schema validation/client generation, typecheck, build, and existing infrastructure-free unit tests. Add focused planner and migration tests only if they can run without an existing database; otherwise document that integration migration checks require an explicitly selected disposable local PostgreSQL database. Never connect to or migrate the configured Azure database.

## Verification results

- Prisma schema validation and client generation PASS. No schema introspection, database push, seed, reset, or Azure connection was performed.
- Typecheck PASS and backend build PASS. The full infrastructure-free unit script reports 260/260 PASS, including nine new grouped-cooking regressions: B1 with two complete child meals, unequal recipe boundaries, differing allergy dish demand, combined mode, invalid precision, school-policy enforcement, shared stock aggregation, completion retries, stock shortage and per-dish retained samples.
- Full repository ESLint PASS. Formatting of changed files PASS. Full npm validate stops at Prettier on 13 pre-existing files outside this change: four spec010 files, src/config/prisma.ts, seven menu module files, and src/utils/database.ts. These files were not reformatted.
- Working-tree spec-gate evaluation PASS for feat/011-cooking-batch-groups; git diff --check PASS. No commit or push was performed.
- Migration SQL was reviewed against a schema-to-schema Prisma SQL diff. A backfill integration case was added to tests/migrations.test.ts and existing authorization/wire fixtures were updated for grouped children, but those PostgreSQL suites were NOT executed here.
- Disposable PostgreSQL setup was attempted only inside ignored node_modules/.cache/cooking-groups. Docker daemon was unavailable. PostgreSQL18 initdb failed while creating a restricted token (Windows error87) and could not create the cluster under the sandbox identity. No PostgreSQL server was started and no existing database was modified.
- Existing FE code was outside this DB/BE task. Its single-dish rendering and single-sample assumptions must be updated to the grouped contract before rollout. contracts.md documents request, response and migration compatibility changes.

## Remaining release prerequisite

Run the PostgreSQL migration/backfill and authorization integration suites on a disposable local instance or CI, then coordinate migration and backend release. The configured Azure database is unchanged. Old backend writers must be stopped during the migration because required group/dish IDs and sample uniqueness have changed.
