# Tasks

- [x] Restrict planning to the requested dish when `dishId` is provided (preview and create).
- [x] Number batches per dish within the meal, continuing after existing batches.
- [x] Update the `dishId` comment in `kitchen.validation.ts`.
- [x] Frontend "Nấu" sends `dishId` to plan preview and create.
- [x] Add `supplierName` to cooking batch lot DTO (repository select + service mapping) and show it in batch detail.
- [x] Unit tests: dish-scoped planning (separate and combine) creates only the requested dish, numbers lots per dish, and retry does not re-plan.
- [x] Run typecheck, lint, format check and unit tests.
- [ ] Run PostgreSQL integration tests for cooking batches on a disposable local instance.
