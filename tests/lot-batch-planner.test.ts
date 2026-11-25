import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import {
  distributePortions,
  planBatchesByLots,
  splitLotByDemand,
  type SupplyLot,
} from "../src/modules/kitchen/lot-batch-planner";

const D = (value: string | number) => new Prisma.Decimal(value);
const lot = (
  id: string,
  entry: string,
  quantity: string,
  source: string | null = id,
): SupplyLot => ({
  id,
  ingredientEntryId: entry,
  quantity: D(quantity),
  unit: "kg",
  sourceFacilityId: source,
});
const summary = (result: ReturnType<typeof planBatchesByLots>) =>
  result.batches.map((batch) =>
    batch.lots
      .map((row) => `${row.ingredientLotId}:${row.quantity.toFixed(3)}`)
      .sort()
      .join(" "),
  );

void test("gà a3 b7 + nấm c2 d8 tỉ lệ 1:1 ra 3 mẻ bd 7, ad 1, ac 2 (V23)", () => {
  const result = planBatchesByLots({
    portions: D(100),
    mode: "SEPARATE_BY_LOT",
    fresh: [
      {
        ingredientEntryId: "ga",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("a", "ga", "3"), lot("b", "ga", "7")],
      },
      {
        ingredientEntryId: "nam",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("c", "nam", "2"), lot("d", "nam", "8")],
      },
    ],
    stock: [],
  });
  assert.deepEqual(summary(result), [
    "b:7.000 d:7.000",
    "a:1.000 d:1.000",
    "a:2.000 c:2.000",
  ]);
  assert.deepEqual(
    result.batches.map((batch) => batch.plannedPortions.toFixed(2)),
    ["70.00", "10.00", "20.00"],
  );
  assert.equal(result.leftovers.length, 0);
});

void test("ghép nhóm bằng nhau trước: a3 b7 + c7 d3 ra 2 mẻ ad, bc (V25)", () => {
  const result = planBatchesByLots({
    portions: D(100),
    mode: "SEPARATE_BY_LOT",
    fresh: [
      {
        ingredientEntryId: "ga",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("a", "ga", "3"), lot("b", "ga", "7")],
      },
      {
        ingredientEntryId: "nam",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("c", "nam", "7"), lot("d", "nam", "3")],
      },
    ],
    stock: [],
  });
  assert.deepEqual(summary(result), ["b:7.000 c:7.000", "a:3.000 d:3.000"]);
});

void test("lệch tỉ lệ: phần dư trả về leftovers hoặc cộng vào mẻ cùng nguồn (V35, V30)", () => {
  const input = {
    portions: D(104),
    mode: "SEPARATE_BY_LOT" as const,
    fresh: [
      {
        ingredientEntryId: "ga",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("a", "ga", "10")],
      },
      {
        ingredientEntryId: "nam",
        perPortion: D("0.105"),
        unit: "kg",
        lots: [lot("c", "nam", "10")],
      },
    ],
    stock: [],
  };
  const separated = planBatchesByLots(input);
  assert.equal(separated.batches.length, 1);
  assert.equal(separated.batches[0].plannedPortions.toFixed(2), "104.00");
  assert.equal(separated.leftovers.length, 1);
  const kept = separated.batches[0].lots.find(
    (row) => row.ingredientLotId === "a",
  )!;
  assert.equal(
    kept.quantity.add(separated.leftovers[0].quantity).toFixed(3),
    "10.000",
  );
  const absorbed = planBatchesByLots({
    ...input,
    fresh: input.fresh.map((line) => ({
      ...line,
      lots: line.lots.map((row) => ({ ...row })),
    })),
    absorbLeftovers: true,
  });
  assert.equal(absorbed.leftovers.length, 0);
  assert.equal(
    absorbed.batches[0].lots
      .find((row) => row.ingredientLotId === "a")!
      .quantity.toFixed(3),
    "10.000",
  );
});

void test("mẻ nhỏ hơn phần mẫu được gộp vào mẻ chung nguồn (V28)", () => {
  const result = planBatchesByLots({
    portions: D(100),
    mode: "SEPARATE_BY_LOT",
    fresh: [
      {
        ingredientEntryId: "ga",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("a", "ga", "0.03"), lot("b", "ga", "9.97")],
      },
      {
        ingredientEntryId: "nam",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("c", "nam", "10")],
      },
    ],
    stock: [],
    minimumPerBatch: new Map([
      ["ga", D("0.05")],
      ["nam", D("0.05")],
    ]),
  });
  assert.equal(result.batches.length, 1);
  assert.equal(result.batches[0].plannedPortions.toFixed(2), "100.00");
});

void test("nấu chung: một mẻ dùng hết lô; đồ khô lấy theo suất từ kho", () => {
  const result = planBatchesByLots({
    portions: D(80),
    mode: "COMBINE_LOTS",
    fresh: [
      {
        ingredientEntryId: "ga",
        perPortion: D("0.1"),
        unit: "kg",
        lots: [lot("a", "ga", "3"), lot("b", "ga", "5.15")],
      },
    ],
    stock: [
      {
        ingredientEntryId: "gao",
        perPortion: D("0.08"),
        unit: "kg",
        lots: [lot("g1", "gao", "5", null), lot("g2", "gao", "20", null)],
      },
    ],
  });
  assert.deepEqual(summary(result), ["a:3.000 b:5.150 g1:5.000 g2:1.400"]);
  assert.throws(
    () =>
      planBatchesByLots({
        portions: D(80),
        mode: "COMBINE_LOTS",
        fresh: [],
        stock: [
          {
            ingredientEntryId: "gao",
            perPortion: D("0.08"),
            unit: "kg",
            lots: [lot("g1", "gao", "1", null)],
          },
        ],
      }),
    { statusCode: 409 },
  );
});

void test("chia suất 2 chữ số theo phần dư lớn nhất, tổng khớp", () => {
  const parts = distributePortions(D(100), [D(1), D(1), D(1)]);
  assert.deepEqual(
    parts.map((part) => part.toFixed(2)),
    ["33.34", "33.33", "33.33"],
  );
  const shares = splitLotByDemand(D("10"), [D(3), D(7)]);
  assert.deepEqual(
    shares.map((share) => share.toFixed(3)),
    ["3.000", "7.000"],
  );
});
