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
