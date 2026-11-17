# Kitchen meal workflow: cook one dish at a time

## Context

The kitchen progress screen lists today's dishes with a "Nấu" (cook) action per dish. The system plans batches from stock automatically; the kitchen staff no longer reviews a separate plan dialog. Previously `POST /cooking-batches` and `GET /cooking-batches/plan` accepted `dishId` but always planned the whole meal, so cooking one dish moved every dish of the meal to "Đang nấu".

## Requirements

- **FR-001**: When `dishId` is provided to `GET /cooking-batches/plan` or `POST /cooking-batches`, the plan covers only that dish of the meal (remaining unplanned portions of that dish). Without `dishId`, behavior is unchanged (whole meal).
- **FR-002**: All existing guards still apply to the whole meal before planning: approved menu, active dishes, finalized class portions, positive demand, consistent cooking mode, existing plans not exceeding demand, allergy safety and stock availability.
- **FR-003**: `planVersion` is computed from the dish-scoped plan, so a preview requested with `dishId` matches the create request with the same `dishId`.
- **FR-004**: `batchNumber` is numbered per dish within the meal, starting at 1 and continuing after that dish's existing batches (e.g. a dish with existing Lô 1 gets Lô 2 next). Multi-dish legacy children keep a separate counter.
- **FR-005**: Meal seasonings stay reserved once per meal; consumption still happens only when every dish with demand has fully planned portions and all its batches are completed.
- **FR-006**: No schema or migration change; response envelopes are unchanged.
- **FR-007**: Each cooking batch lot (`cookingBatchLots[]` in list/detail responses) exposes read-only `supplierName`: the name of the supplier of the lot's ingredient (via its delivery item), or `null` when unknown. Batch detail shows the supplier column and the source lot code under the ingredient name.

## Acceptance

1. A meal with dishes A and B: cooking A creates batches only for A; B remains plannable.
2. Cooking B afterwards creates B's batches with `batchNumber` starting at 1.
3. Calling the endpoint again for a fully planned dish returns `created: false` without new batches.
4. Seasoning consumption is not posted until both A and B batches are completed.
