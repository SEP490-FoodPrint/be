import assert from "node:assert/strict";
import test from "node:test";
import { grossFromNet, netFromGross } from "../src/utils/waste-rate";
import {
  computeFreshDemand,
  type CalcInput,
} from "../src/modules/supply-order/fresh-demand.service";
import { planCookingBatches } from "../src/modules/kitchen/kitchen.service";
import { ingredientWasteRateBodySchema } from "../src/modules/ingredient-entry/ingredient-entry.validation";

void test("TASK-09: quy đổi thành phẩm ↔ lượng sống theo tỷ lệ hao hụt", () => {
  assert.equal(grossFromNet("100", "0.2").toString(), "125");
  assert.equal(netFromGross("125", "0.2").toString(), "100");
  assert.equal(grossFromNet("12.5", 0).toString(), "12.5");
  assert.equal(netFromGross("12.5", null).toString(), "12.5");
  assert.throws(() => grossFromNet("1", "1"), RangeError);
  assert.throws(() => grossFromNet("1", "-0.1"), RangeError);
});

void test("TASK-09: validate tỷ lệ 0 <= r < 1, tối đa 2 chữ số thập phân theo %", () => {
  assert.equal(
    ingredientWasteRateBodySchema.parse({ wasteRate: 0.2 }).wasteRate,
    "0.2000",
  );
  assert.equal(
    ingredientWasteRateBodySchema.parse({ wasteRate: 0.1225 }).wasteRate,
    "0.1225",
  );
  for (const wasteRate of [1, -0.01, 0.12345, "0.2", Number.NaN])
    assert.equal(
      ingredientWasteRateBodySchema.safeParse({ wasteRate }).success,
      false,
      String(wasteRate),
    );
  assert.equal(
    ingredientWasteRateBodySchema.safeParse({ wasteRate: 0.2, extra: 1 })
      .success,
    false,
  );
});

const line = (
  id: string,
  qty: number,
  wasteRate?: number,
): CalcInput["recipes"] extends Map<string, (infer L)[]> ? L : never => ({
  ingredientEntryId: id,
  ingredientId: `ing-${id}`,
  name: id,
  handlingType: "DIRECT_USE",
  active: true,
  requiredQuantity: qty,
  wasteRate,
  unit: "g",
  orderUnit: "kg",
  supplierId: "s1",
  supplierName: "NCC",
});

void test("TASK-09: đặt hàng theo lượng sống, tỷ lệ 0 giữ nguyên kết quả cũ", () => {
  const input = (wasteRate?: number): CalcInput => ({
    batchNo: 2,
    grades: [{ id: "g1", name: "Khối 1" }],
    planned: new Map([["g1", 100]]),
    savedBatch1: new Map([["g1", 0]]),
    actual: new Map([["g1", 100]]),
    menus: [
      {
        id: "m",
        title: "Toàn trường",
        isSchoolWide: true,
        gradeIds: [],
        dishes: [{ dishId: "ga", dishName: "Gà", mealType: "LUNCH" }],
      },
    ],
    recipes: new Map([["ga:g1", [line("chicken", 100, wasteRate)]]]),
  });
  const raw = computeFreshDemand(input(0.2)).items[0];
  assert.equal(raw.quantity, 12.5);
  assert.equal(raw.orderQuantity, 12.5);
  // Chi tiết theo món vẫn giữ định lượng thành phẩm để dinh dưỡng đối chiếu.
  assert.equal(raw.details[0].quantityPerPortion, 100);
  assert.equal(computeFreshDemand(input()).items[0].quantity, 10);
  assert.equal(computeFreshDemand(input(0)).items[0].quantity, 10);
});

void test("TASK-09: bếp lấy lượng sống từ lô, làm tròn lên ở 3 chữ số", () => {
  const plans = planCookingBatches(
    100,
    "COMBINE_LOTS",
    [
      {
        ingredientEntryId: "chicken",
        quantityPerPortion: grossFromNet("100", "0.2").toString(),
        unit: "g",
      },
      {
        ingredientEntryId: "mushroom",
        quantityPerPortion: grossFromNet("30", "0.1").toString(),
        unit: "g",
      },
    ],
    [
      {
        id: "lot-chicken",
        ingredientEntryId: "chicken",
        availableQuantity: "20",
        reservedQuantity: "0",
        unit: "kg",
      },
      {
        id: "lot-mushroom",
        ingredientEntryId: "mushroom",
        availableQuantity: "5",
        reservedQuantity: "0",
        unit: "kg",
      },
    ],
  );
  assert.equal(plans.length, 1);
  const used = Object.fromEntries(
    plans[0].lots.map((lot) => [lot.ingredientLotId, lot.quantityUsed]),
  );
  assert.equal(used["lot-chicken"], "12.500");
  assert.equal(used["lot-mushroom"], "3.334");
  // 12,5 kg sống quy về đúng 10 kg thành phẩm cho phân bổ.
  assert.equal(netFromGross(used["lot-chicken"], "0.2").toString(), "10");
});

void test("TASK-09: lô vừa đủ lượng sống không bị báo thiếu do làm tròn", () => {
  const plans = planCookingBatches(
    100,
    "COMBINE_LOTS",
    [
      {
        ingredientEntryId: "mushroom",
        quantityPerPortion: grossFromNet("30", "0.1").toString(),
        unit: "g",
      },
    ],
    [
      {
        id: "lot-a",
        ingredientEntryId: "mushroom",
        availableQuantity: "3.334",
        reservedQuantity: "0",
        unit: "kg",
      },
    ],
  );
  assert.equal(plans[0].lots[0].quantityUsed, "3.334");
});
