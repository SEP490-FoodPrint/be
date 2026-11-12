# Feature Specification: Lô chế biến cha và các mẻ món

**Feature Branch**: `feat/013-cooking-batch-groups`  
**Status**: Implemented; PostgreSQL integration and deployment pending

## User story

Nhân viên bếp tạo một lô chế biến B1 cho một ngày và bữa ăn. Backend chia món trong bữa thành một hoặc nhiều mẻ con CB1, CB2 theo cấu hình chế biến do BGH đặt cho trường. Mỗi mẻ con có thể chứa nhiều món; mỗi món giữ số suất và phân bổ nguyên liệu riêng để xác nhận, hoàn thành, truy xuất và trừ kho đúng.

Ví dụ chế độ tách theo lô nguyên liệu có thể tạo B1 với CB1 gồm gà từ lô 1, bò, cơm, canh và CB2 gồm phần gà từ lô 2 cùng phần bò, cơm, canh được phân cho mẻ đó. Chế độ gộp lô nguyên liệu tạo các mẻ theo cách gộp được cấu hình. Số và thành phần mẻ do dữ liệu nhu cầu, công thức và tồn kho quyết định; không cố định luôn hai mẻ.

## Functional requirements

- **FR-001**: Database MUST store batch header, child cooking batches, child dish rows, and ingredient-lot allocations per child dish.
- **FR-002**: Header MUST identify a menu day and meal; children MUST reference one header; child dish rows MUST identify the dish and its planned portions.
- **FR-003**: Create MUST load all approved dishes and finalized demand for the requested menu day/meal in the trusted school scope. It MUST apply the school's configured cooking mode; caller cannot override it.
- **FR-004**: Planning MUST allocate portions and inventory by dish across child batches. Repeated dishes across children MUST represent disjoint portions; each recipe and ingredient lot allocation is recorded once per child dish. No duplicate stock deduction is allowed.
- **FR-005**: Batch child confirmation and completion MUST preserve stock reservation, row locks, tenant authorization, transaction atomicity, idempotency, and lifecycle rules. Completion consumes only its dish allocations once.
- **FR-006**: Listing, details, retained samples, meal allocation, and traceability MUST retain child-dish identity and parent grouping. Parent/child status aggregation MUST be explicit and not hide an incomplete child.
- **FR-007**: Add a versioned expand/backfill migration that preserves existing batches and their codes, dishes, status, ingredient allocations, samples, allocation references, and inventory traceability. Do not deploy the migration to a database in this change.
- **FR-008**: Preserve existing HTTP envelope and school authorization; update only contracts required for grouped creation and grouped reads.

## Acceptance scenarios

1. Given an approved meal with multiple dishes and `COMBINE_LOTS`, when the kitchen plans it, then one parent is created with child batches and per-dish inventory allocations computed under that mode.
2. Given the same meal and `SEPARATE_BY_LOT`, when one or more recipes require separate ingredient lots, then child batches group the corresponding portions for every dish and retain each dish's individual ingredient allocations.
3. Given an insufficient recipe ingredient or finalized demand, when planning, then the transaction creates no partial header, child, allocation, or reservation.
4. Given a child is completed and the request is retried, then inventory is consumed at most once and only for that child's recorded dish allocations.
5. Given legacy rows, when the expand/backfill migration runs on a disposable database, then every old cooking batch remains addressable with its original code and links, represented as a one-child parent group.

## Constraints and edge cases

- BGH cooking mode is authoritative; NULL/unconfigured mode blocks planning.
- A meal can contain different dish portion demands due to portion groups and allergies. Never infer equal portions across dishes or sum portions across different dishes as a single meal total.
- Lot splitting boundaries can differ by recipe. The planner must form child groups without duplicating any dish portions or stock allocations.
- Existing one-sample-per-cooking-batch uniqueness and meal-allocation-per-cooking-batch links require an explicit compatibility mapping during migration and API changes.
- No destructive drop, reset, `db push`, seed, remote deployment, or inventory data rewrite is part of this task.

## Confirmed implementation decisions

- Parent entity is `CookingBatchGroup` / `cooking_batch_groups`, referenced by `batchGroupId`; each child has its own stable UUID and `batch_code`. `batch_code` is never reused as a foreign key.
- Planning accepts `menuDayId` and `mealType`, with optional legacy `dishId` checked for membership. Every request plans the whole meal and returns `groups[]` and `batches[]`. A retry returns the already recorded plan.
- `COMBINE_LOTS` creates one child containing every needed dish. `SEPARATE_BY_LOT` aligns the union of all recipe lot boundaries into child portion ranges. Shared dishes are proportionally allocated to each range; different allergy demands remain independent per dish. Unsupported numeric splits are rejected instead of rounded.
- Required child day/meal columns remain as constrained compatibility fields. Composite FKs make them agree with the parent and make every child dish belong to the same approved menu slot. The parent is the aggregate identity; this release does not destructively remove compatibility columns.
- A multi-dish child has NULL in its legacy `dish_id`; `dishes[]` is authoritative. `planned_portions` on the child describes its range size, not the sum of different dishes.
- Each child dish has its own retained sample and allocation count. Sample creation requires `dishId` for multi-dish children; old single-dish requests can omit it. GET child food-samples returns an array.
- Inventory usage is aggregated once per child/ingredient lot while dish-level allocations remain recorded separately. Existing idempotency index remains authoritative.
- Legacy children are wrapped individually; no historical grouping is inferred. Existing UUIDs, codes, timestamps, NULL/zero unknown plans, sample IDs, inventory records, and allocation amounts are preserved.
