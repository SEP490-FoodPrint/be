# Verification

From be: run npm run lint, npm run typecheck, npm run build and npm run test:unit. Run Prettier on modified feature files. Windows checkouts with core.autocrlf=true can make repository-wide format:check report existing CRLF files; do not reformat unrelated files.

From fe: run node --test tests/kitchen-nutrition-api.test.mjs and the Vite production build.

Manual scenarios:

1. Configure two grade recipes for one dish with 80 g and 100 g. Select both grades, choose a common week once and switch the grade quantity preview. Save; verify independent menu IDs and own quantities.
2. Choose Toàn trường. All configured grade IDs participate; missing profiles identify the affected grade and prevent a partial write.
3. Introduce an allergy in only one grade. The preview checks that grade's actual ingredient IDs; an unresolved saved report leaves every grade in draft.
4. Save a complete safe week with submit=true. Every menu transitions to pending together. Make a later menu incomplete in grouped submission and verify no earlier transition remains.
5. Reopen unchanged drafts after changing catalogue quantities. Snapshots remain unchanged. Copying into a new week derives each selected grade's own recipe.
6. Matching schedules/statuses show one item with combined scopes. Selecting a grade opens its real record; changing one schedule or workflow status separates the display.

No disposable local PostgreSQL test URL is configured in this session. Real PostgreSQL authorization/migration tests and visual browser verification must run in the normal local/CI environment; Azure data is not modified.

## Results (2026-11-15)

- Backend unit suite: 531 passed, including 30 menu creation/batch tests.
- Backend lint, typecheck and build passed. Modified feature files pass Prettier.
- Repository-wide npm run validate reached format:check and stopped on existing Windows CRLF working-copy files. A read-only LF-normalized Prettier verification checked 596 tracked files with zero formatting discrepancies; no unrelated files were rewritten.
- Frontend service/SSR suite: 67 passed; production build passed.
- Frontend UI edits occurring in another session are retained. Only feature logic and the new per-grade preview component are included in the feature commit.
- Spec gate passed for feat/multi-grade-menu-authoring against origin/dev.

## Reopening correction (2026-11-16)

- Read-only Azure inspection found two 16/11 menus already marked APPROVED with one lunch day each, identical create/submit/approval timestamps and no review records. One contains both grade links; the other has no links and isSchoolWide=false. The 23/11 single-grade menu is DRAFT with one day. No Azure writes were performed.
- Unassigned records are now labelled “Chưa gán khối” and excluded from selected-grade authoring/filtering. Matching drafts retain each grade's snapshot; real dish or parent/day status differences still block common editing with a clearer message.
- Both approval paths and submission require both meals on every non-holiday weekday. Week schedule completeness uses both meals; frontend cards retain parent status independently and missing days remain “Chưa tạo”. The list uses unfiltered rows for completeness even while filtering a meal.
- Backend: 605/605 unit tests; lint, typecheck, build and modified-file Prettier passed after regenerating the current Prisma client. Frontend: 78/78 API/SSR tests and Vite production build passed (`--configLoader runner` avoids restricted parent-directory reads during configuration bundling).
- Generated Prisma code, build output, local logs/backups and the pre-existing package-lock.json change are excluded from commits. Real PostgreSQL integration and browser interaction were not run; no disposable local test URL is configured.

## Hide unassigned records (2026-11-16 follow-up)

- Per user clarification, unassigned records are hidden entirely from internal menu lists and weekly choices. The scope predicate is applied before pagination and counts; it retains explicit school-wide menus and menus with grade links. Historical records are not deleted or updated.
- Frontend cards, all-grade lists, kitchen schedules, grade choices and stored-recipe comparisons also filter unassigned records, including older/cached API responses. School grades without menus remain available in the grade filter without being mapped to an unassigned record.
- Frontend API/SSR tests: 79 passed; production build passed. Backend unit tests: 606 passed; build/typecheck and modified-file lint passed. No schema changes or Azure writes.

## Dish meal classification (2026-11-16 follow-up)

- User confirmed LUNCH, AFTERNOON and BOTH. Add nullable Dish.mealType using the separate foodprint.dish_meal_type enum through 20261120000100_dish_meal_classification. The migration is transactional, adds one nullable column, and does not backfill or change recipes/history.
- Recipe writes validate the classification; omitted updates preserve it and explicit null clears it. Catalogue/list responses include it. Current FE create/edit forms require choosing a meal; existing unknown dishes remain visible as “Chưa phân loại”. List and detail reuse existing meal badges, category grouping, newest order and grade recipe snapshots.
- Backend: 607 unit tests passed; lint, typecheck, schema validation, client generation and build passed. Frontend: 81 API/SSR tests and production build passed. Chrome desktop/mobile checks cover edit prefill, BOTH, create validation, successful save/reload and unchanged grade quantities. Form columns shrink on mobile while ingredient tables scroll within their own wrapper.
- Migration integration coverage was added to tests/migrations.test.ts; it is not run here because no disposable local PostgreSQL test URL is configured. Read-only Azure checks found 15 school dishes and exactly this one pending migration; applied migration checksums match. The standard db:deploy:check command cannot run without a local AZURE_DATABASE_HOST variable, so an equivalent read-only history/checksum check used the existing configured Azure connection. No Azure DDL/data writes have run; deployment awaits task-specific confirmation under AGENTS.md.
