# Grouped cooking API

The existing auth, permissions, school scope and success/error envelopes apply. API paths below use `/api/v1/kitchen`; the existing legacy kitchen alias remains mounted.

## Plan a whole meal

`POST /api/v1/kitchen`

```json
{
  "menuDayId": "<UUID>",
  "mealType": "LUNCH"
}
```

`mealType` is LUNCH or AFTERNOON. An optional legacy `dishId` is checked for membership; it does not narrow planning to that dish. No school ID, portions, lot IDs or cooking-mode override is accepted.

The response data contains `created`, `batchCount`, `groups[]` and `batches[]`. Each group has `id`, `batchCode`, `menuDayId`, `mealType`, derived `status`, and its `batches[]`. Status is COMPLETED only when every child is completed; all unconfirmed children produce UNCONFIRMED; every other combination is IN_PROGRESS. Child statuses retain UNCONFIRMED, CONFIRMED, COMPLETED.

Each child includes `batchGroupId`, `BatchGroup: {id,batchCode}` and `dishes[]`. A dish includes `dishId`, `name`, `plannedPortions`, and `cookingBatchLots[]`. Each lot allocation includes `dishId`, `ingredientLotId`, `quantityUsed`, `unit`, and the existing stock metadata. Quantities are decimal strings; timestamps are ISO strings. Child `plannedPortions` is the portion-range size, never the sum of unrelated dish portions.

COMBINE_LOTS produces one child with all needed dishes and permits multiple source lots per recipe ingredient. SEPARATE_BY_LOT splits at the union of recipe lot boundaries. For 100 servings, chicken split 60/40 and unsplit beef/rice/soup yields two children containing all four dishes with 60/40 servings respectively. If an allergy dish has only 10 servings it appears only in ranges assigned to those 10 servings, without fabricating equal demand for every dish. Recipe standards, finalized demand and the school's BGH-controlled mode are authoritative.

Retrying a fully planned meal returns `created:false` and existing groups/children. Partial historical plans are retained and only missing per-dish demand is allocated. Later changes to school policy do not rewrite the mode snapshot of an already planned meal. Shared meal seasonings retain their existing once-per-meal reservation/consumption rule and single-sufficient-lot restriction in SEPARATE_BY_LOT.

## Read and process a child/group

- `GET /api/v1/kitchen/groups/:id` reads a parent with every child, using `cooking_batch.view` and trusted school ownership. Cross-school/missing IDs return 404.
- Existing list/detail/statistics routes retain pagination and filters. Dish search/filter uses child dish rows, parent code is searchable, and every child row exposes its parent. `hasSample=true` means every dish in the child has a sample; false means at least one is missing.
- `POST /:id/confirm`, `POST /:id/complete`, and `DELETE /:id` act on a child. Deleting the last unconfirmed child also deletes its empty parent; business-history checks remain enforced.
- Completion consumes aggregate quantity once per child/stock lot. Individual dish allocations remain stored for traceability. Repeated completion does not post additional stock usage.

## Retained samples

`GET /:id/food-samples` now returns an array (empty if no samples).

`POST /:id/food-samples` retains quantity/unit/location/time fields and accepts `dishId`. It is required for a multi-dish child; it can be omitted only when the child contains exactly one dish. Each child/dish has one independent sample and its own 24-hour lifetime. Sample list rows include `dishId` and `CookingBatch.BatchGroup`, and the displayed dish/portion count comes from the sampled dish. Sample expiry/disposal/incident hold rules are unchanged.

## Storage and release

- Parent: `foodprint.cooking_batch_groups`; child: `cooking_batches`; child dishes: `cooking_batch_dishes`; ingredient allocations: `cooking_batch_lots` keyed by child/dish/lot.
- Composite FKs make each child day/meal agree with the parent and every dish agree with its child's menu slot. Child day/meal remain constrained compatibility fields; multi-dish children have NULL legacy `dish_id`.
- Samples and meal allocation links include dish IDs. Existing child IDs, sample IDs, codes, quantities, lifecycle timestamps and inventory reference IDs are preserved by backfill. Legacy children get individual parents rather than inferred historical grouping.
- Migration `20261111000100_cooking_batch_groups` requires coordinated backend rollout. Older backend writers cannot supply the new required group/dish IDs. This change prepares the migration; it does not apply it to Azure. Existing FE clients need to render `groups[]`/`dishes[]` and submit the sampled dish instead of assuming one dish/sample per child.
