# Plan

Add nullable ingredient_role to existing recipe lines with a CHECK for MAIN/SEASONING, preserving old rows. Add scoped recipe catalog/options and recipe write APIs using existing menu permissions, repositories, DTOs and transaction reauthorization. Add a database recipe preview and recipe-based menu save, with Decimal unit conversion and per-meal aggregation. Connect frontend catalog and menu selection to APIs, preserving existing menu snapshots. Run schema generation, typecheck/build and focused tests before authorized Azure deployment.

Constitution Check: existing Express/Prisma architecture and response envelope; current grants checked inside transactions; additive migration only; no credentials; no Azure test writes. Integration checks require disposable PostgreSQL and must be reported if unavailable.

## Verification and deployment outcome

- Prisma schema validation, generation, backend typecheck/build and frontend build passed.
- Existing database-free suite passed 269 tests; three additional recipe tests passed, covering exact unit-aware sums, distinct stock identities, unknown legacy roles, incompatible units and input validation. Focused ESLint passed.
- Azure read-only inspection found 46 dishes, 43 recipe lines across 42 dishes and no meal seasoning lines. No seasoning classification can safely be inferred from handling_type.
- Preflight verified every applied migration checksum after restoring two working-tree SQL files to their unchanged Git LF bytes. Exactly the new migration was pending.
- Explicitly authorized Prisma migrate deploy failed on Windows TLS P1011, OS error -2146893042, before recording or applying the migration. Read-back confirmed ingredient_role absent, zero migration-history records for the new migration, and all 43 recipe lines retained. No manual SQL or migration-history workaround was used.
- New API requires the additive migration before use. Legacy recipe lines must be explicitly classified in the catalog before selecting them for new recipe-based meals. Existing menu snapshots are preserved; legacy standards APIs remain compatible.
- No disposable PostgreSQL or authenticated browser end-to-end test was executed. No commit or push was performed. README and gitignore are unchanged.

## Follow-up verification

The user confirmed shared meal seasonings rather than group-specific storage. The creation modal now checks all recipe ingredient IDs, displays per-class allergy conflicts and supports manual portion groups/substitutes. Menu writes persist explicit groups in the same transaction as recipe snapshots and recheck shared seasoning safety; submission rejects uncovered class allergies. Holiday range expansion is shared by calendar output, schedule flags and submission completeness. Frontend list/calendar reads use the stored reasons and red holiday borders. The database-free suite passed 274/274, including year-boundary holidays and a safe substitute rejected because a shared seasoning is allergenic. Backend typecheck and frontend build passed. No new Azure operation was performed during this follow-up; the earlier migration/TLS limitation remains.

Kitchen inspection confirmed the backend already plans all menu dishes from finalized per-group demand, including alternatives, and permits sampling a completed child without checking sibling completion. Frontend legacy single-dish matching was corrected to match dishes[] in each child and synchronize all affected meal dishes after planning. Completing a child opens its real sample form and continues to missing dish samples; no sample is generated automatically. Frontend API/adapter tests passed 26/26 and backend grouped planner/sample tests passed 9/9. No new schema or Azure change is required for this kitchen follow-up.

## Integration with current dev

Merged origin/dev at 09e688d, preserving both dish-recipes and meal-allocation unit test entries in the package script. Renumbered only this feature's spec and branch from 014 to 018 because dev already contains spec 014-meal-allocation-by-batch. Backend build and the combined 305-test database-free suite passed. No database deployment is part of this merge.
