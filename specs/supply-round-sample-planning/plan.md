# Plan triển khai: TASK-10 — Lập mẻ theo đợt giao và lấy thêm nguyên liệu lưu mẫu

**Spec**: [spec.md](spec.md) (bản gốc: `.task_specs/TASK-10-supply-round-sample-planning.md`) (v7, không còn câu mở)
**Ngày lập**: 24/11/2026
**Repo**: `FoodPrintBE` (nhánh gốc `dev`), `FoodPrintFE` (nhánh gốc `main`)
**Tiền đề đã có**: `dish-standard-portion` đã gộp vào `dev` (BE, PR #194) và `main` (FE, PR #168): `Dish.standardQuantity/standardUnit`, `DishGradeRecipe.portionQuantity`, `src/utils/dish-portion.ts`, `src/utils/waste-rate.ts`.

## 1. Cách chia việc

Tính năng lớn, chạm nhiều module có transaction và khóa kho. Chia thành **7 PR nối tiếp** cho mỗi repo. Mỗi PR chạy được độc lập và không làm hỏng luồng cũ. Luồng cũ vẫn chạy cho dữ liệu cũ, mẻ lập thủ công và chuyến giao có `preparation_stage = NULL`.

| PR  | Nội dung                                                                    | Repo    | Phụ thuộc |
| --- | --------------------------------------------------------------------------- | ------- | --------- |
| PR1 | Spec-kit + migration + Prisma + hàm thuần (không đổi hành vi)               | BE      | —         |
| PR2 | Cấu hình lưu mẫu (BGH)                                                      | BE + FE | PR1       |
| PR3 | Lập mẻ theo món khi NCC khai báo lô + kho duyệt                             | BE + FE | PR1, PR2  |
| PR4 | NCC lấy thêm + chặn dispatch + kiểm nhận + mẻ chính thức + trừ kho phần mẫu | BE + FE | PR3       |
| PR5 | Xác nhận lưu mẫu chỉ còn bấm xác nhận                                       | BE + FE | PR4       |
| PR6 | Đợt 2: gộp phần, mẻ mới, tự bỏ qua Đợt 2, bỏ "Giao thêm"                    | BE + FE | PR4       |
| PR7 | Giao lại bằng chuyến `REQUEST` + xóa/lập lại phần/mẻ                        | BE + FE | PR4, PR6  |

**Tên nhánh**: spec-gate (`.github/scripts/spec-gate.mjs`) bắt PR sửa `src/**` hoặc `prisma/**` phải có nhánh `<type>/<feature-slug>`, khớp một thư mục `specs/<feature-slug>/` có đủ `spec.md`, `plan.md`, `tasks.md` và không còn dấu hiệu "cần làm rõ" mà spec-gate kiểm tra (`CLARIFICATION_MARKER`).

- PR1 dùng nhánh `feat/035-supply-round-sample-planning`.
- Các PR sau dùng `feat/supply-round-sample-planning-<phần>`, ví dụ `-sample-policy`, `-round-planning`. Spec đã nằm trên `dev` sau PR1, nên spec-gate khớp được theo tiền tố, như ca `fix/001-login-token-expiry` trong `tests/spec-gate.test.mjs`.

FE không có spec-gate. Nhánh FE đặt cùng tên với nhánh BE tương ứng.

## 2. Nguyên tắc chung

- Theo `FoodPrintBE/AGENTS.md`:
  - routes → controller → validation (Zod `strictObject`) → service → repository; Request và Response DTO tách hai file.
  - Service không viết query Prisma.
  - Mọi ghi liên quan dùng chung một transaction client.
  - Mã nghiệp vụ mới (nếu có) đăng ký ở `src/utils/business-code.ts`.
- **Migration chỉ thêm, không phá.** Không sửa migration đã apply, không `db push`, không deploy Azure. Chạy `npm run test:migrations` / `npm run test:local:migrations` trên DB local tạm.
- **Hàm thuần trước, DB sau**: mọi công thức (tỉ lệ mẫu, làm tròn, gán lô, khóa nguồn, gộp Đợt 2, kiểm tra đủ từ Đợt 1) viết thành hàm thuần ở `src/utils/` hoặc file `*-planner.ts` trong module `kitchen`, có unit test riêng. Service chỉ ghép dữ liệu và gọi hàm.
- **Khóa và thứ tự khóa**: giữ cách khóa lô hiện tại (`lockIngredientLots`, sắp theo id). Thêm advisory lock theo `(schoolId, deliveryDate, batchNo)` cho mọi thao tác ghi kế hoạch đợt. Thứ tự lấy khóa luôn là advisory lock của đợt → `menu_days` → lô.
- **Tương thích ngược**:
  - mẻ có `supply_round_id = NULL` giữ toàn bộ quy tắc cũ, kể cả bất biến "số suất bằng suất chốt";
  - chuyến có `preparation_stage = NULL` dispatch như cũ;
  - mẫu của mẻ có `sample_quantity = NULL` vẫn cho nhập lượng như cũ.
- Unit test BE chạy với `BLOCKCHAIN_ENABLED=false`, vì `.env` local làm hỏng 4 test kitchen.

## 2a. Constitution Check

Đối chiếu `.specify/memory/constitution.md`:

| Nguyên tắc                         | Đánh giá                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Kiến trúc module phân lớp       | Đạt. Module mới `supply-round` đủ routes/controller/validation/service/repository/request DTO/response DTO. Hàm tính toán thuần đặt ở `kitchen/sample-planner.ts`, không truy vấn DB. Repository giữ mọi query Prisma                                                                    |
| II. Phân quyền và cô lập tổ chức   | Đạt. Quyền mới `school_sample_policy.manage`, `cooking_plan.view`, `cooking_plan.approve` thêm vào catalog và `docs/AUTHORIZATION.md`. Mọi endpoint lấy phạm vi trường/NCC từ `AuthPrincipal`                                                                                            |
| III. An toàn cơ sở dữ liệu         | Đạt. Migration mới, chỉ thêm (expand-only), không sửa migration cũ, không `UPDATE`/`DELETE` dữ liệu cũ. Đổi một CHECK theo điều kiện rộng hơn và thay một partial unique (tạo mới trước, bỏ cũ sau). Test migration chỉ chạy trên DB local tạm khi người dùng cấu hình `.env.test.local` |
| IV. Transaction, cache, rate limit | Đạt. Lập mẻ, duyệt, lấy thêm, kiểm nhận chạy trong transaction có advisory lock theo đợt và khóa lô sắp theo id. Không thêm cache                                                                                                                                                        |
| V. Hợp đồng HTTP                   | Đạt. Giữ envelope, Decimal serialize thành chuỗi, Date thành ISO                                                                                                                                                                                                                         |
| VI. Spec-driven                    | Đạt. `specs/supply-round-sample-planning/{spec,plan,tasks}.md` cùng PR với code, không còn câu hỏi mở                                                                                                                                                                                    |
| VII. Mã nghiệp vụ                  | Không phát sinh bảng danh sách nghiệp vụ mới cần mã `FP-XX`. `supply_rounds`, `supply_round_dish_plans` là bảng nội bộ, hiển thị theo ngày/đợt. Mẻ vẫn dùng mã `FP-CB-` / `FP-BG-` hiện có                                                                                               |

### Complexity Tracking

| Điểm phức tạp                                              | Lý do                                                                  | Phương án đơn giản hơn đã cân nhắc                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Hai migration (enum riêng, bảng/cột riêng)                 | PostgreSQL không cho dùng giá trị enum vừa thêm trong cùng transaction | Một migration: bị lỗi khi CHECK/DEFAULT dùng giá trị mới    |
| Bảng `cooking_batch_round_parts` lưu phần Đợt 2 tách riêng | D20: lô Đợt 2 bị từ chối thì xóa phần Đợt 2 mà mẻ Đợt 1 giữ nguyên     | Cộng thẳng vào mẻ Đợt 1: không tách lại được khi bị từ chối |
| Đổi PK hay thêm cột `batch_no` vào `cooking_batch_lots`    | Không làm, vì `meal_allocation_materials` tham chiếu khóa hiện tại     | —                                                           |

## 3. PR1 — Nền tảng (BE)

### 3.1 Spec-kit

- T001 Tạo `FoodPrintBE/specs/supply-round-sample-planning/` gồm:
  - `spec.md`: chép nguyên TASK-10 v7;
  - `plan.md`: chép file plan này;
  - `tasks.md`: danh sách T001…T0xx ở dưới, dạng `- [ ] T001 …`.
- T002 Chạy `npm run test:spec-gate` để chắc thư mục hợp lệ.

### 3.2 Migration `2026120700xx_supply_round_sample_planning`

Mỗi migration là một file SQL, dùng cùng tên ở `prisma/migrations/`. Chia làm **hai migration**:

- **Migration A — enum**: `ALTER TYPE … ADD VALUE`. PostgreSQL không cho dùng giá trị enum mới trong cùng transaction vừa thêm nó, nên phải tách riêng.
  - `cooking_batch_status`: thêm `PENDING_APPROVAL`, `ROUND1_APPROVED`, `ROUND2_APPROVED`, `CANCELLED`.
  - Tạo các enum mới: `supply_round_status`, `dish_plan_status`, `round_part_status`, `delivery_preparation_stage`.
- **Migration B — bảng/cột** (spec mục 10):
  - T003 Bảng `school_sample_policies` (PK `school_id`, CHECK > 0).
  - T004 Bảng `supply_rounds` (UNIQUE `school_id, delivery_date, batch_no`, CHECK `batch_no IN (1,2)`, `not_needed_at`).
  - T005 Bảng `supply_round_dish_plans` (PK `supply_round_id, dish_id`).
  - T006 `cooking_batches.supply_batch_no`. `cooking_batch_groups.supply_round_id` FK.
  - T007 `cooking_batch_dishes`: `sample_quantity`, `sample_ratio`, `sample_unit`, `standard_quantity_snapshot` (NULL được).
  - T008 `cooking_batch_lots.sample_quantity` + thay CHECK `cooking_batch_lots_quantity_used_check` thành `quantity_used >= 0 AND (quantity_used > 0 OR sample_quantity > 0)`.
  - T009 `menu_meal_seasoning_lots.sample_quantity`.
  - T010 Bảng `cooking_batch_round_parts` + `cooking_batch_round_part_lots`.
  - T011 `deliveries`: `preparation_stage`, `replaces_delivery_id` (FK tự tham chiếu, CHECK chỉ với `REQUEST`), `top_up_confirmed_by_user_id/at`.
  - T012 Thay `uq_deliveries_request_mode` bằng partial unique `WHERE creation_mode = 'REQUEST' AND status NOT IN ('REJECTED','CANCELLED')`. **Tạo index mới trước rồi mới drop index cũ**, trong cùng migration.
  - T013 `ingredient_lots.sample_top_up_quantity`, `delivery_items.sample_top_up_quantity`, `supply_request_items.sample_top_up_quantity`.
- T014 Cập nhật `prisma/schema.prisma`:
  - partial index dùng `partialIndexes`;
  - comment `///` cho từng cột mới;
  - sửa comment cũ của `RetainedFoodSample` (_"one CookingBatch has at most one retained sample"_), vì ràng buộc thật là `(cooking_batch_id, dish_id)`.
- T015 `npm run prisma:validate`, `prisma:generate`, `typecheck`. Thêm ca kiểm tra vào `tests/migrations.test.ts`: dữ liệu cũ giữ nguyên, CHECK mới chặn số âm, partial unique cho tạo chuyến `REQUEST` thứ hai khi chuyến đầu `REJECTED`.

### 3.3 Hàm thuần + unit test

File mới `src/modules/kitchen/sample-planner.ts`, test `tests/sample-planner.test.ts` (thêm vào script `test:unit`):

- T016 `sampleRatio(standardQuantity, sampleAmount, lines)` → `{ r0, r, sampleQuantity }`. Làm tròn dòng đơn vị đếm (dùng `isScaledUnit`) lên số nguyên; `r = max(ceil(req × r0) / req)`; `M* = ceil3(r × S)`.
  - Test: sữa 180 ml / 1 hộp / 150 ml cho `r = 1`, `M* = 180`. Trứng 120 g / 2 quả / 10 g dầu / 100 g cho `r = 1`. Món chỉ g/ml thì `r = r0`.
- T017 `sampleLines(lines, r)` → lượng thành phẩm và lượng sống mỗi dòng; `sampleNeedInLotUnit(gross, lineUnit, lotUnit)` đổi sang đơn vị lô:
  - MAIN thì `grossFromNet`; SEASONING thì hao hụt 0 (N2);
  - đơn vị đếm lấy `ceil`;
  - đổi sang đơn vị lô bằng `convertQuantity`, làm tròn **lên** 3 chữ số.
  - Test: 2,4 g muối ra 0,003 kg. Gà 60 g thành phẩm với hao hụt 0,2 ra 75 g. Muối có hao hụt 5 % vẫn ra lượng như hao hụt 0.
- T018 `assignSampleLots(batches, stock, mode)` → thứ tự ưu tiên 1–5 ở spec 7.3, trả `CookingBatchLot.sampleQuantity`, `topUp` theo lô, phần giữ từ kho, hoặc lỗi thiếu. Test ví dụ 7.4 (`topUp(L_A) = 0,175 kg`), hai lô cùng nông trại chỉ gánh một lần, `SEPARATE_BY_LOT` không lấy lô khác nhóm nguồn.
- T019 `seasoningSampleNeeds(batches, sharedSeasoningIds, lotUnitOf)` → cộng dồn phần mẫu gia vị theo bữa.
- T020 `sourceKey(plan, stock)` và `splitRound2(plans, round1Batches)` → `{ parts, newBatches }` (spec 8.2). Test: `COMBINE_LOTS` luôn ra phần; gà cùng nguồn nhưng rau khác nguồn ra mẻ mới.
- T021 `batch2Decision(grades, ingredients)` (spec 8.1, D30) → `{ notNeeded, gradeShortage, shortages[], surplusByGrade[] }`. Test 6b, 6c và trường hợp một khối thiếu suất.

**Xong PR1**: `npm run validate`, `test:unit`, `test:spec-gate`, `test:local:migrations` pass. Không có hành vi nào đổi.

## 4. PR2 — Cấu hình lưu mẫu

### BE

- T022 Mở rộng module `organization`, theo cùng kiểu `/me/cooking-mode` (`organization.routes.ts`):
  - `GET|PATCH /api/schools/me/sample-policy`;
  - validation `sampleGrams`, `sampleMilliliters` (> 0, ≤ 3 chữ số);
  - trả `warnings` khi < 100 / 150;
  - chưa có dòng thì trả mặc định với `isDefault: true`.
- T023 Quyền `school_sample_policy.manage` (BGH) và `cooking_plan.view`, `cooking_plan.approve` trong `src/constants/permission-catalog.ts`. Cập nhật `docs/AUTHORIZATION.md`.
- T024 Repository hàm `findSamplePolicy(tx, schoolId)` dùng chung cho kitchen (trả mặc định 100/150 khi không có dòng, D24).
- T025 Test: quyền, strict body, cảnh báo, mặc định.

### FE

- T026 Trang `src/pages/SCHOOL/SamplePolicy/` (2 ô có hậu tố g/ml, cảnh báo vàng dưới ô, đoạn trích QĐ 1246 nhỏ, mờ, nghiêng ngay trước nút lưu). Service mới hoặc thêm vào service organization hiện có.
- T027 Route `ROUTER.SCHOOL_SAMPLE_POLICY` trong `router/AppRouter.jsx`. Mục "Lưu mẫu thực phẩm" trong nhóm `SCHOOL_CONFIGURATION` của `router/MenuItem.jsx`, sau "Khung giờ vận hành".

## 5. PR3 — Lập mẻ theo món + kho duyệt

### BE

- T028 Module mới `src/modules/supply-round/` (routes/controller/validation/service/repository/DTO). Đăng ký ở `src/routes/index.ts`.
- T029 **Kích hoạt theo món** (spec 6.1, 6.2):
  - Trong `supplier-order.service.ts` → `createFromRequest`: đặt `preparationStage = LOTS_DECLARED`.
  - Sau commit, gọi `supplyRoundService.onLotsDeclared(deliveryId)` trong transaction riêng có advisory lock.
  - Lỗi lập mẻ không làm hỏng response của NCC: bắt lỗi, ghi `PLAN_FAILED` + `failure_message`.
  - Tạo `supply_rounds` và `supply_round_dish_plans` (`WAITING_SUPPLIERS`) khi chưa có.
  - Xác định "NCC của món" từ `dish_ingredient_entries` và `SupplyRequestItem` của đợt.
- T030 **Lập mẻ theo món** trong `kitchen.service.ts`. Tách phần lõi của `executePlan` thành hàm nhận `(tx, meal, dishIds, demand, stock, mode, round)`, để cả kitchen (thủ công) và supply-round dùng chung, không nhân đôi logic.
  - `readPlanningStock` thêm lô `incoming`: lô của chuyến trong đợt có `preparationStage ≥ LOTS_DECLARED`, lấy `receivedQuantity`.
  - `reservedQuantities` tính thêm trạng thái mới, phần Đợt 2 chưa `MERGED` và `sample_quantity` (spec 10.4).
  - Nhu cầu Đợt 1 = Σ `SupplyBatch1GradePortion` theo khối áp thực đơn (spec 6.4).
  - Pha A giữ nguyên `planCookingBatches`/`groupDishPlans`. Pha B gọi `assignSampleLots`, `seasoningSampleNeeds`.
  - Ghi mẻ `PENDING_APPROVAL`, `supply_batch_no`, chụp `sample_*` vào `cooking_batch_dishes`, `sample_quantity` vào lô và gia vị.
  - Bỏ chặn "chỉ nấu hôm nay" cho đường lập theo đợt (vẫn giữ ở bước hoàn thành).
  - `planVersion` tính theo món.
- T031 `POST /api/cooking-batches` (thủ công) trả 409 nếu bữa đã có nhóm mẻ gắn `supply_round_id` còn hiệu lực.
- T032 **Kho duyệt**:
  - `GET /api/supply-rounds?date=&batchNo=` trả trạng thái đợt/món, chuyến từng NCC, và khung nguyên liệu – NCC (nguồn, lượng lấy thêm, tổng) cùng khung "Lấy từ kho" (spec 6.6).
  - `POST …/dishes/:dishId/approve` (`planVersion`): mẻ sang `ROUND1_APPROVED`.
  - `POST …/dishes/:dishId/plan` để thử lập lại.
- T033 Sau mỗi lần duyệt: chuyến nào có mọi món dùng nguyên liệu của mình đã duyệt thì sang `TOP_UP_PENDING`, hoặc `READY_TO_DISPATCH` nếu lấy thêm = 0 (spec 6.5).
- T034 Test integration (`test:local`):
  - kích hoạt theo món, 2 NCC khai báo đồng thời ra 1 kế hoạch;
  - thiếu nguyên liệu mẫu thì `PLAN_FAILED`, chuyến vẫn tạo được;
  - duyệt sai version thì 409;
  - chuyển `preparationStage` đúng.

### FE

- T035 Trang kho `src/pages/SCHOOL/SupplyRoundPlan/`: chọn ngày/đợt, trạng thái từng món và NCC còn thiếu, khung nguyên liệu – NCC có mở chi tiết theo mẻ, khung "Lấy từ kho", nút Duyệt / Thử lập lại. Thêm vào sidebar của `INGREDIENT_MANAGEMENT_DEPARTMENT`.
- T036 Nhãn trạng thái mẻ mới trong `KitchenCooking/*`: Chờ duyệt, Đã duyệt Đợt 1, Đã duyệt Đợt 2, Chính thức – sẵn sàng nấu. Ẩn nút hoàn thành ở mẻ chưa chính thức.

## 6. PR4 — Lấy thêm, vận chuyển, kiểm nhận, chính thức, trừ kho

### BE

- T037 `POST /api/deliveries/management/:id/top-up`:
  - kiểm tra `TOP_UP_PENDING`;
  - body khớp đúng `topUp` theo lô, idempotent theo fingerprint;
  - cộng `ingredient_lots.sample_top_up_quantity` và `received_quantity`, `delivery_items.sample_top_up_quantity`, `actual_quantity`, `supply_request_items.sample_top_up_quantity`;
  - chuyển `READY_TO_DISPATCH`.
- T038 `dispatch`: chuyến có `preparationStage` khác NULL phải ở `READY_TO_DISPATCH`.
- T039 `delivery.service.ts`:
  - `verifyRequestDeliveryReceipt` chấp nhận `actual = requested + sample_top_up`;
  - khi chuyến cuối cùng của ngày `RECEIVED` (hoặc Đợt 2 `NOT_NEEDED`), gộp phần Đợt 2 (`MERGED`) và chuyển mẻ sang `CONFIRMED` có chạy `checkReservedStock` (spec 8.1, 8.2). Ở PR4 chưa có Đợt 2, nên điều kiện chỉ kiểm tra được với dữ liệu test; PR6 hoàn thiện.
- T040 `assertMealPortions` / kiểm tra khi hoàn thành: mẻ có `supply_round_id` dùng "lớn hơn hoặc bằng", mẻ thủ công giữ "bằng" (D28).
- T041 `complete`: `COOKING_USAGE` = `quantityUsed + sampleQuantity`. Gia vị chung trừ cả `sample_quantity`. Kiểm tra index idempotency `uq_inventory_usage_per_batch_lot` không đổi.
- T042 Kiểm tra phân bổ suất (`meal-allocation`) không chia phần `sampleQuantity`. Thêm test vào `material-allocation` test hiện có.
- T043 Test: top-up sai/đúng/lặp; dispatch bị chặn; kiểm nhận cộng lượng; hoàn thành trừ đúng; mẻ cũ không đổi hành vi.

### FE

- T044 `SupplierDeliveries/*`: hiển thị `preparationStage`, panel xác nhận lấy thêm theo lô (chỉ đọc lượng, một nút xác nhận), khóa nút nhập vận chuyển tới `READY_TO_DISPATCH`.
- T045 Màn chi tiết đơn (trường và NCC): cột "Lưu mẫu" chỉ đọc.

## 7. PR5 — Xác nhận lưu mẫu

- T046 BE `retained-sample.validation.ts`:
  - với mẻ có `sample_quantity` thì body không có `quantity`/`unit` (strict, có thì 400);
  - bỏ `MINIMUM_SAMPLE_QUANTITY` cho mẻ này;
  - mẻ cũ giữ schema cũ. Cách làm: validation chấp nhận cả hai dạng, service quyết định theo mẻ.
- T047 BE `retained-sample.service.ts`: ghi `quantity = sample_quantity`, `unit = sample_unit`. Giữ kiểm tra tủ/ngăn/thời điểm/ảnh (D25).
- T048 FE `KitchenSamples`: ô lượng/đơn vị thành chỉ đọc. Ghi chú làm tròn đơn vị đếm, ví dụ _"Đã làm tròn lên 1 hộp, lượng mẫu 180 ml"_.
- T049 Test: body có `quantity` thì 400; mẫu dưới 100 g vẫn lưu; mẻ cũ vẫn bắt nhập.

## 8. PR6 — Đợt 2

### BE

- T050 Lập mẻ Đợt 2 (spec 8.2):
  - nhu cầu theo khối `max(0, thực tế − mốc Đợt 1)`;
  - pha A trên lô dư + đồ khô + lô Đợt 2;
  - `splitRound2` ghi `cooking_batch_round_parts` (không có phần mẫu) hoặc mẻ mới `PENDING_APPROVAL` (có pha B);
  - duyệt: phần sang `APPROVED`, mẻ mới sang `ROUND2_APPROVED`.
- T051 Tự bỏ qua Đợt 2 (D30):
  - trong transaction `finalize` của `meal-attendance.service.ts`, khi lớp cuối cùng của ngày chốt, gọi `batch2Decision` với `cần(i)` (thêm hàm vào `fresh-demand.service.ts`: theo sĩ số thực tế, không cộng phần lẻ) và `đã đặt(i)` (Σ `requested_quantity` Đợt 1 còn hiệu lực, không tính lưu mẫu);
  - đủ thì tạo `supply_rounds` Đợt 2 `NOT_NEEDED` và kích hoạt chuyển chính thức nếu Đợt 1 đã nhận.
- T052 `fresh-demand` Đợt 2 trả thêm `surplusByGrade` và `shortages`. Tạo đơn Đợt 2 khi đã `NOT_NEEDED` thì 409.
- T053 Bỏ "Giao thêm" ở BE: không có thay đổi schema (BE chưa từng lưu). Chỉ kiểm tra `createOrderDraft` không nhận trường thừa nào.
- T054 Test: trùng hết thì chỉ có phần, lấy thêm = 0; trùng một phần thì ra mẻ mới; 6b; 6c; phần gộp vào khi chính thức; dư suất vẫn hoàn thành được.

### FE

- T055 `IngredientOrders/component/CreateDeliveryView.jsx`:
  - **bỏ** cột "Giao thêm", nút/popup "Thêm nguyên liệu giao thêm", state `extraQty`, `extraQtyInput`, `isExtraItem`, `handleExtraQtyChange`, `handleAddExtraIngredient`;
  - sửa `services/IngredientOrderService` để `orderedQty` chỉ còn lượng theo suất.
- T056 Màn Đợt 2: hiển thị "Khối … đã đủ từ Đợt 1, thừa X suất", nguyên liệu thiếu bao nhiêu, và trạng thái "Đợt 2 không cần đặt" (khóa tạo đơn).

## 9. PR7 — Giao lại

### BE

- T057 `supplier-order.service.ts`:
  - `hasDeliveryForRequest` chỉ chặn khi còn chuyến hiệu lực;
  - nhận `replacesDeliveryId` (phải là chuyến `REJECTED` của cùng đơn);
  - tổng số lượng vẫn bằng số lượng đặt.
- T058 Khi `REJECTED` (`delivery.service.ts`):
  - xóa phần/mẻ dùng lô của chuyến theo spec 8.3 (D20, D27); món chuyển `REPLAN_REQUIRED`;
  - lần từ chối thứ 3 thì `cancelRemainder` như cũ và mẻ chờ chuyển `CANCELLED`.
  - Xóa mẻ: xóa `cooking_batch_lots`, `cooking_batch_dishes`, `cooking_batches`; nhóm rỗng thì xóa nhóm. Mã `FP-CB-` không tái sử dụng.
- T059 Khai báo lô thay thế thì lập lại **chỉ** các phần/mẻ đã xóa. Giữ lô gánh phần mẫu cũ cho nguyên liệu không bị từ chối.
- T060 Test kịch bản 12a, 14, 15 của spec.

### FE

- T061 `SupplierDeliveries/DeliveryDetailView.jsx` + `DeliveryCreateView.jsx`: chuyến `REQUEST` bị từ chối thì nút "Giao lại" mở form chuyến thay thế `sourceType = REQUEST`, điền sẵn nguyên liệu, cơ sở nguồn, số lượng, **ngày sản xuất và hạn dùng**. Bỏ đường giao lẻ cho trường hợp này.
- T062 FE trường: bỏ trạng thái giả `RE_DELIVER` và logic "≥ 2 bên từ chối là hủy" trong `IngredientOrders/*`, dùng `redeliveryRequiredCount` / `cancellationNotice` từ BE.

## 10. Kiểm tra cuối mỗi PR

BE:

```
npm run validate
npm run test:unit
npm run test:spec-gate
npm run test:local:check
npm run test:local -- unit
npm run test:local -- migrations
npm run test:local -- authorization
npm run test:local -- supplier-orders
```

FE: `npm run build` (FE chưa có script `lint`), các script test liên quan như `test:kitchen-nutrition`, `test:supplier-ingredient-handling`, rồi chạy dev server và kiểm tra trên trình duyệt từng màn đã sửa (BGH cấu hình, kho duyệt, NCC lấy thêm/giao lại, bếp lưu mẫu, đặt hàng Đợt 2).

**Test cần sửa vì hành vi cũ đổi** (kiểm tra khi làm từng PR):

- `supplier-order-creation*.test.ts`: chặn chuyến thứ hai, dispatch.
- `cooking-batch-groups.test.ts`, `kitchen-*.test.ts`: trạng thái mới, bất biến số suất.
- `delivery-inspections.test.ts`, `delivery-status.test.ts`: kiểm nhận có lấy thêm, giao lại.
- `sample-storage.test.ts` và test retained-sample: bỏ nhập lượng.
- `fresh-demand.test.ts`: thêm `surplusByGrade`, `cần(i)`.

## 11. Rủi ro

| Rủi ro                                                                     | Cách giảm                                                                                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lập mẻ sau commit của NCC thất bại hoặc bị bỏ dở (process chết giữa chừng) | Kế hoạch idempotent theo `(round, dish)`. Endpoint thử lập lại cho kho. Mỗi lần mở trang kho, BE kiểm tra món nào đủ điều kiện mà chưa có kế hoạch thì lập |
| Deadlock giữa lập mẻ, kiểm nhận và chốt điểm danh                          | Một thứ tự khóa duy nhất: advisory lock đợt → `menu_days` → lô (sắp id)                                                                                    |
| `ALTER TYPE ADD VALUE` không dùng được trong cùng transaction              | Tách migration enum riêng (3.2)                                                                                                                            |
| Đổi CHECK `quantity_used > 0` ảnh hưởng dữ liệu cũ                         | Điều kiện mới vẫn đúng với mọi dòng cũ (`sample_quantity` mặc định 0 và `quantity_used > 0`)                                                               |
| Thứ tự lập giữa các món dùng chung lô ảnh hưởng kết quả                    | Thứ tự xác định: thời điểm đủ điều kiện, rồi `displayOrder`. Test có ca hai món chung lô gà                                                                |
| Kế hoạch bị lập lại làm đổi phần lấy thêm đã gửi NCC                       | Phần lấy thêm chốt khi chuyến sang `TOP_UP_PENDING`. Sau mốc đó chỉ đường giao lại (PR7) mới được lập lại                                                  |
| FE NCC cũ (chưa cập nhật) vẫn dispatch được                                | Chặn ở BE (T038). FE chỉ ẩn nút                                                                                                                            |
| Khối lượng thay đổi lớn ở `kitchen.service.ts` (~2.150 dòng)               | Tách lõi lập mẻ thành hàm dùng chung (T030). Hàm thuần ở `sample-planner.ts`. Không viết lại phần thủ công                                                 |

## 12. Ngoài plan

Theo spec mục 15–16: đơn giá, hạn chót khai báo của NCC, ghi đè lượng mẫu theo món, giao lại một phần, xử lý bữa thiếu món khi đơn bị hủy, thông báo email/đẩy, báo cáo thừa suất.
