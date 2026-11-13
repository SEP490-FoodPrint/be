# Tasks

- [x] Align the retained-sample storage-unit index in Prisma with existing migration SQL; Prisma validate, build and typecheck passed. Local migration replay remains unavailable because MIGRATION_TEST_DATABASE_URL is not configured; CI must rerun both existing migration/diff paths.

- [x] Back up and clear only the explicitly confirmed current-week test menu/dependencies; verify inventory and attendance remain unchanged.
- [x] Enforce approved immutability across all menu writes and expose editability metadata.
- [x] Support pending edits with one atomic save-and-resubmit action and stale-submission review checks.
- [x] Fix frontend payloads, loading/error states and awaited saves; hide approved plus/edit controls.
- [x] Verify backend/frontend regressions and builds; record infrastructure test limitations.

- [x] Implement independent school-scoped delivery inspection list/detail reads and shared-screen API loading.
- [x] Resolve four-party receipt and cumulative redelivery rule: third distinct rejected delivery cancels the unreceived remainder of the SupplyRequest and shows an in-app cancellation notice.
- [x] Implement confirmed role decisions with per-delivery immutability, authorization and concurrency protection; verify two deliveries remain independent.
- [x] Validate atomic initial receipt against lot quantities, ownership, dates, units, previous inventory history and requested totals.
- [x] Show shared role history, server filters/statistics/pagination and persistent cancellation notices; remove mock data and hardcoded nutrition identity.
- [x] Add permission migration/bootstrap alignment and verify already-applied Azure grants through read-only queries.
- [x] Pass 333 backend unit/HTTP tests and 40 frontend API/SSR tests, backend build/typecheck, frontend runner build and focused ESLint; prepare real PostgreSQL coverage for CI. Record absent local DB/Docker and unperformed authenticated browser verification.

- [x] Add nullable dish categories, additive migration/guarded legacy backfill and bootstrap alignment.
- [x] Persist/read categories through existing dish APIs and expose canonical category options.
- [x] Wire catalog create/edit/filter and menu selection to saved categories; remove name inference.
- [x] Pass Prisma validation, backend build/typecheck, focused ESLint, 317 backend unit tests, 37 frontend API tests and frontend runner build. Add migration integration assertions; no disposable local PostgreSQL was available to execute them.
- [x] Verify the completed category migration and 45 classified dishes on Azure after concurrent deployment; all completed migration checksums now match source. Keep one ambiguous peanut demonstration dish unclassified. No commit or push was initiated by this task.

- [x] Fix selection-time allergy inspection independently of recipe preview; preserve all recipe ingredient IDs and show incomplete/error states.
- [x] Verify selection-time API regressions (35/35 frontend suite) and frontend production build (runner mode). Read-only Azure identity lookup confirmed the DEMO peanut recipe with ingredient_role NULL; no live mutation or authenticated browser test was performed.

- [x] Add server create-time allergy checks and explicit response DTO.
- [x] Verify draft creation/merging, ingredient/seasoning coverage, transaction failures and permissions.
- [x] Remove menu production mocks and local-only recipe persistence.
- [x] Connect the dish catalog and kitchen menu to live APIs without fabricated defaults.
- [x] Display server allergy warnings after draft saves.
- [x] Run relevant backend/frontend checks and record limitations.

No live Azure mutation was executed by this task; Azure verification used read-only queries. Database integration tests and authenticated browser verification remain unperformed locally. No commit or push was initiated by this task. Concurrent frontend commits by the user were retained.

## School allergy catalogue

- [x] Read Azure allergy rows for the school previously inspected: 3A peanut 1, 3B peanut 2, 4A peanut 1. No insert was needed or executed.
- [x] Add a bounded, school-only catalogue endpoint with actual class/ingredient labels and existing permissions; retain the legacy list.
- [x] Replace allergy page records, academic-year options, overview alert rows and the allergy KPI with API data.
- [x] Remove allergy mock datasets and public dish-name substitute guesses; preserve explicit saved portion-group identities.
- [x] Show per-ingredient counts without claiming unique pupils across allergens.
- [x] Pass backend build and 316 database-free tests, frontend runner build and 30 API/adapter tests; focused ESLint passed.
- [x] Add school category model and additive migration with existing dish backfill.
- [x] Implement school-scoped category CRUD and adapt dish/menu reads and writes.
- [x] Connect the black-and-white category popup and refresh dependent catalog state.
- [ ] Verify migration and authorization on disposable PostgreSQL and run applicable checks.
