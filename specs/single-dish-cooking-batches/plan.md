# Plan

## Constitution Check

Preserve API shape, tenant checks, transaction and inventory behavior. Introduce a database trigger which blocks insertion of an additional dish row, but does not change historic rows. No automatic remote deployment; versioned SQL only. Preserve reads and sampling of historical multi-dish batches. Test planner, lifecycle, UI, and migration behavior.
