# Multi-grade menu contracts

## POST /api/v1/menus/grade-batch

Requires live SCHOOL identity, menu.create and class_allergy.view; menu.update is also required for existing drafts or submit=true. The body extends MenuWrite: unique gradeIds (1–100) are required and submit is an optional boolean (default false). No client-selected school ID is accepted.

Each grade receives an independent WeeklyMenu and snapshot derived from its own catalogue profile. Existing unchanged meals retain their stored snapshot; edited/new meals read current profiles. Group IDs from another grade are never reused. Existing shared/legacy scopes cannot be silently divided. One Serializable school transaction covers every write.

Response data contains menus [{id, gradeIds, gradeNames, status}], submitted, hasUnresolvedAllergies, and allergyChecks with gradeId/gradeName plus the existing menu allergy report fields. If allergies are unresolved, all saved menus remain DRAFT even when submit was requested. Other business errors roll back the complete operation. Safe complete submissions transition every menu together.

## POST /api/v1/menus/submit-group

Requires live SCHOOL identity, menu.update and class_allergy.view. Body: unique menuIds (1–100). Ownership and status of all targets are read first; each is validated before commit. An error in any menu rolls back prior transitions. PENDING_APPROVAL is idempotent. Response: menus [{id, gradeIds, status}].

## Preview and grouped presentation

Existing dish recipe-preview and menu allergy-check endpoints are called independently per grade; a combined request never substitutes the first grade's quantity for another grade. Saved unchanged grade snapshots are used when reopening a common draft. Catalogue changes do not mutate historical menus.

Grouping uses the full date/meal/dish/portion-plan schedule and status; quantities and tenant-owned record IDs remain separate. Different status, feedback or allergy portion plan is never hidden by grouping. The group retains all physical menu IDs for atomic submission; detail edits remain scoped to the selected actual menu.
