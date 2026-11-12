# Dish recipes and meal seasonings

Nutrition staff maintain per-serving dish recipes in the database. Each recipe line explicitly identifies MAIN or SEASONING. Menu creation can select database recipes and the backend snapshots main quantities and aggregates seasonings separately for each date and meal. Client totals are not authoritative. Existing menus retain their snapshots and consumption history.

Legacy recipe classification remains NULL until explicitly reviewed; never infer seasoning from DRY_STOCK or names. New recipes require explicit classification, positive numeric(14,3) quantities, school ownership, active ingredients and linked suppliers for MAIN. Recipe-based menu creation rejects incomplete or unclassified recipes. Unknown units or unrepresentable conversions fail rather than round. Existing legacy API callers retain their explicit standards contract.

Azure additive migration is explicitly authorized by the user. Apply only this new migration after code checks and a read-only migration history check. Do not seed, reset, modify applied migrations, rewrite history or expose credentials.

## Follow-up: allergy checks and school holidays

Recipe preview must supply all database ingredient IDs, including seasoning, for the existing class-allergy check. Creation UI must show loading, failure and per-ingredient/per-class conflicts without claiming unique student totals. Never infer substitute dishes. User confirmed keeping shared meal seasonings: manually chosen substitute dishes contribute their recipe seasonings to the shared standard; saving must reject any shared seasoning containing an avoided ingredient. Explicit portion groups may be written atomically with the menu, using existing tables and lifecycle rules. Submission requires avoidance coverage for class allergy conflicts.

Academic-calendar output must include every date in BGH holiday ranges with the stored reason, supporting legacy single-date records. Weekly list and creation grid must display holiday reasons with a red border. Submission completeness excludes configured holidays, preserving menus already present on such dates.

## Kitchen follow-up

Approved substitute dishes participate in cooking through their teacher-finalized portion-group demand, using the existing grouped planner. Frontend must match every child dish in dishes[], including substitutes, when showing existing plans and after creating a whole-meal plan. Each completed child supports real retained-sample entry immediately without waiting for its parent or siblings. Completion opens the sample form for that child; never fabricate a sample record or reuse another child's sample. Existing per-child/per-dish sample identity, input validation and idempotency remain authoritative.
