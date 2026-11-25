import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSampleLots,
  batch2Decision,
  ceilToThree,
  sampleAmountFor,
  sampleLines,
  samplePolicyWarnings,
  sampleRatio,
  seasoningSampleNeeds,
  sourceKey,
  splitRound2,
  type SampleStockLot,
} from "../src/modules/kitchen/sample-planner";

const str = (value: { toString(): string }) => value.toString();

void test("lượng mẫu theo đơn vị mốc chuẩn, mặc định 100 g / 150 ml khi chưa cấu hình (D8, D24)", () => {
  assert.equal(str(sampleAmountFor("g", null).amount), "100");
  assert.equal(str(sampleAmountFor(" ML ", null).amount), "150");
  assert.equal(
    str(
      sampleAmountFor("g", { sampleGrams: "80", sampleMilliliters: "200" })
        .amount,
    ),
    "80",
  );
  assert.throws(() => sampleAmountFor("hộp", null), { statusCode: 409 });
  assert.deepEqual(
    samplePolicyWarnings({ sampleGrams: "80", sampleMilliliters: "150" }),
    ["Thấp hơn mức tối thiểu 100 g theo QĐ 1246/QĐ-BYT"],
  );
  assert.deepEqual(
    samplePolicyWarnings({ sampleGrams: "100", sampleMilliliters: "150" }),
    [],
  );
});

void test("làm tròn lên 3 chữ số thập phân (D12)", () => {
  assert.equal(str(ceilToThree("0.0024")), "0.003");
  assert.equal(str(ceilToThree("0.175")), "0.175");
  assert.equal(str(ceilToThree("1.0001")), "1.001");
});

void test("tỉ lệ mẫu: món chỉ g/ml dùng r = M / S (D9)", () => {
  const result = sampleRatio("300", "150", [
    { requiredQuantity: "200", unit: "ml" },
    { requiredQuantity: "50", unit: "g" },
  ]);
  assert.equal(str(result.ratio), "0.5");
  assert.equal(str(result.sampleQuantity), "150");
  assert.equal(result.roundedUp, false);
});

void test("tỉ lệ mẫu: đơn vị đếm làm tròn lên, cả món tăng tỉ lệ thuận (D10, N1, N4)", () => {
  const milk = sampleRatio("180", "150", [
    { requiredQuantity: "1", unit: "hộp" },
  ]);
  assert.equal(str(milk.ratio), "1");
  assert.equal(str(milk.sampleQuantity), "180");
  assert.equal(milk.roundedUp, true);

  const egg = sampleRatio("120", "100", [
    { requiredQuantity: "2", unit: "quả" },
    { requiredQuantity: "10", unit: "g" },
  ]);
  assert.equal(str(egg.ratio), "1");
  assert.equal(str(egg.sampleQuantity), "120");
  const lines = sampleLines(
    [
      {
        ingredientEntryId: "egg",
        ingredientRole: "MAIN",
        requiredQuantity: "2",
        unit: "quả",
        wasteRate: 0,
      },
      {
        ingredientEntryId: "oil",
        ingredientRole: "SEASONING",
        requiredQuantity: "10",
        unit: "g",
        wasteRate: 0,
      },
    ],
    egg.ratio,
  );
  assert.deepEqual(
    lines.map((line) => [line.ingredientEntryId, str(line.net)]),
    [
      ["egg", "2"],
      ["oil", "10"],
    ],
  );
});

void test("lượng sống cho mẫu: nguyên liệu chính có hao hụt, gia vị luôn hao hụt 0 (D11, N2)", () => {
  const lines = sampleLines(
    [
      {
        ingredientEntryId: "chicken",
        ingredientRole: "MAIN",
        requiredQuantity: "120",
        unit: "g",
        wasteRate: "0.2",
      },
      {
        ingredientEntryId: "salt",
        ingredientRole: "SEASONING",
        requiredQuantity: "4.8",
        unit: "g",
        wasteRate: "0.05",
      },
    ],
    "0.5",
  );
  assert.equal(str(lines[0].net), "60");
  assert.equal(str(lines[0].gross), "75");
  assert.equal(str(lines[1].gross), "2.4");
});

const chickenLines = (requiredInStandard: string, ratio: string) =>
  sampleLines(
    [
      {
        ingredientEntryId: "chicken",
        ingredientName: "Thịt gà",
        ingredientRole: "MAIN",
        requiredQuantity: requiredInStandard,
        unit: "g",
        wasteRate: "0.2",
      },
    ],
    ratio,
  );

void test("pha B: ví dụ 7.4 — một lô gà cho 3 mẻ, tổng lấy thêm 0,175 kg (D3)", () => {
  const stock: SampleStockLot[] = [
    {
      id: "L_A",
      ingredientEntryId: "chicken",
      unit: "kg",
      free: "0",
      incoming: true,
      sourceFacilityId: "farm-a",
    },
  ];
  const used = [{ ingredientEntryId: "chicken", ingredientLotId: "L_A" }];
  const result = assignSampleLots(
    [
      {
        batchKey: "CB1",
        label: "CB1",
        dishId: "ga-kho",
        lines: chickenLines("120", "0.5"),
        usedLots: used,
      },
      {
        batchKey: "CB2",
        label: "CB2",
        dishId: "ga-kho",
        lines: chickenLines("120", "0.5"),
        usedLots: used,
      },
      {
        batchKey: "CB3",
        label: "CB3",
        dishId: "canh-ga",
        lines: chickenLines("80", "0.25"),
        usedLots: used,
      },
    ],
    stock,
    "SEPARATE_BY_LOT",
  );
  assert.equal(str(result.topUps.get("L_A")!), "0.175");
  assert.equal(result.fromStock.size, 0);
  assert.deepEqual(
    result.allocations.map((row) => [row.batchKey, str(row.sampleQuantity)]),
    [
      ["CB1", "0.075"],
      ["CB2", "0.075"],
      ["CB3", "0.025"],
    ],
  );
});

void test("pha B: mẻ dùng hai lô cùng nông trại chỉ tính phần mẫu một lần", () => {
  const stock: SampleStockLot[] = [
    {
      id: "L1",
      ingredientEntryId: "chicken",
      unit: "kg",
      free: "0",
      incoming: true,
      sourceFacilityId: "farm-a",
    },
    {
      id: "L2",
      ingredientEntryId: "chicken",
      unit: "kg",
      free: "0",
      incoming: true,
      sourceFacilityId: "farm-a",
    },
  ];
  const result = assignSampleLots(
    [
      {
        batchKey: "CB1",
        label: "CB1",
        dishId: "ga-kho",
        lines: chickenLines("120", "0.5"),
        usedLots: [
          { ingredientEntryId: "chicken", ingredientLotId: "L1" },
          { ingredientEntryId: "chicken", ingredientLotId: "L2" },
        ],
      },
    ],
    stock,
    "SEPARATE_BY_LOT",
  );
  assert.equal(result.allocations.length, 1);
  assert.equal(str(result.topUps.get("L1")!), "0.075");
  assert.equal(result.topUps.has("L2"), false);
});

void test("pha B: lô đồ khô còn chỗ thì giữ từ kho, không lấy thêm; thiếu thì báo đúng mẻ và nguyên liệu", () => {
  const rice = sampleLines(
    [
      {
        ingredientEntryId: "rice",
        ingredientName: "Gạo",
        ingredientRole: "MAIN",
        requiredQuantity: "100",
        unit: "g",
        wasteRate: 0,
      },
    ],
    "1",
  );
  const used = [{ ingredientEntryId: "rice", ingredientLotId: "DRY" }];
  const enough = assignSampleLots(
    [
      {
        batchKey: "CB1",
        label: "CB1",
        dishId: "com",
        lines: rice,
        usedLots: used,
      },
    ],
    [
      {
        id: "DRY",
        ingredientEntryId: "rice",
        unit: "kg",
        free: "0.5",
        incoming: false,
        sourceFacilityId: null,
      },
    ],
    "SEPARATE_BY_LOT",
  );
  assert.equal(str(enough.fromStock.get("DRY")!), "0.1");
  assert.equal(enough.topUps.size, 0);
  assert.equal(enough.allocations[0].topUp, false);

  assert.throws(
    () =>
      assignSampleLots(
        [
          {
            batchKey: "CB1",
            label: "FP-CB-00001",
            dishId: "com",
            lines: rice,
            usedLots: used,
          },
        ],
        [
          {
            id: "DRY",
            ingredientEntryId: "rice",
            unit: "kg",
            free: "0.05",
            incoming: false,
            sourceFacilityId: null,
          },
        ],
        "SEPARATE_BY_LOT",
      ),
    {
      statusCode: 409,
      message: "Không đủ Gạo để lưu mẫu cho mẻ FP-CB-00001.",
    },
  );
});

void test("pha B: SEPARATE_BY_LOT chỉ lấy lô incoming cùng nhóm nguồn; COMBINE_LOTS lấy bất kỳ", () => {
  const used = [{ ingredientEntryId: "chicken", ingredientLotId: "OLD" }];
  const stock: SampleStockLot[] = [
    {
      id: "OLD",
      ingredientEntryId: "chicken",
      unit: "kg",
      free: "0",
      incoming: false,
      sourceFacilityId: "farm-a",
    },
    {
      id: "OTHER",
      ingredientEntryId: "chicken",
      unit: "kg",
      free: "0",
      incoming: true,
      sourceFacilityId: "farm-b",
    },
    {
      id: "SAME",
      ingredientEntryId: "chicken",
      unit: "kg",
      free: "0",
      incoming: true,
      sourceFacilityId: "farm-a",
    },
  ];
  const batch = {
    batchKey: "CB1",
    label: "CB1",
    dishId: "ga-kho",
    lines: chickenLines("120", "0.5"),
    usedLots: used,
  };
  assert.equal(
    assignSampleLots([batch], stock, "SEPARATE_BY_LOT").allocations[0]
      .ingredientLotId,
    "SAME",
  );
  assert.equal(
    assignSampleLots([batch], stock, "COMBINE_LOTS").allocations[0]
      .ingredientLotId,
    "OTHER",
  );
  assert.throws(
    () =>
      assignSampleLots(
        [batch],
        stock.filter((lot) => lot.id !== "SAME"),
        "SEPARATE_BY_LOT",
      ),
    { statusCode: 409 },
  );
});

void test("gia vị dùng chung: cộng phần mẫu theo bữa, mỗi mẻ làm tròn lên (D13)", () => {
  const salt = (ratio: string) =>
    sampleLines(
      [
        {
          ingredientEntryId: "salt",
          ingredientRole: "SEASONING",
          requiredQuantity: "4.8",
          unit: "g",
          wasteRate: "0.05",
        },
        {
          ingredientEntryId: "chicken",
          ingredientRole: "MAIN",
          requiredQuantity: "120",
          unit: "g",
          wasteRate: "0.2",
        },
      ],
      ratio,
    );
  const totals = seasoningSampleNeeds(
    [{ lines: salt("0.5") }, { lines: salt("0.5") }, { lines: salt("0.5") }],
    new Set(["salt"]),
    () => "kg",
  );
  assert.deepEqual([...totals.keys()], ["salt"]);
  assert.equal(str(totals.get("salt")!), "0.009");
});

void test("khóa nguồn: cùng nông trại thì trùng, khác nguồn rau thì khác (D5)", () => {
  const source: Record<string, string | null> = {
    g1: "farm-a",
    g2: "farm-a",
    v1: "veg-x",
    v2: "veg-y",
    noSrc: null,
  };
  const sourceOf = (id: string) => source[id];
  const round1 = sourceKey(
    "ga-xao",
    [
      { ingredientEntryId: "chicken", ingredientLotId: "g1" },
      { ingredientEntryId: "veg", ingredientLotId: "v1" },
    ],
    sourceOf,
  );
  const same = sourceKey(
    "ga-xao",
    [
      { ingredientEntryId: "veg", ingredientLotId: "v1" },
      { ingredientEntryId: "chicken", ingredientLotId: "g2" },
    ],
    sourceOf,
  );
  const otherVeg = sourceKey(
    "ga-xao",
    [
      { ingredientEntryId: "chicken", ingredientLotId: "g2" },
      { ingredientEntryId: "veg", ingredientLotId: "v2" },
    ],
    sourceOf,
  );
  assert.equal(same, round1);
  assert.notEqual(otherVeg, round1);
  assert.notEqual(
    sourceKey(
      "ga-xao",
      [{ ingredientEntryId: "x", ingredientLotId: "noSrc" }],
      sourceOf,
    ),
    sourceKey(
      "ga-xao",
      [{ ingredientEntryId: "x", ingredientLotId: "g1" }],
      sourceOf,
    ),
  );
});

void test("Đợt 2: trùng khóa thì thành phần gộp (cộng dồn), không trùng thì mẻ mới; mẻ đã hoàn thành không nhận gộp", () => {
  const split = splitRound2(
    [
      { dishId: "ga-xao", key: "K1", plannedPortions: 10, lots: ["a"] },
      { dishId: "ga-xao", key: "K1", plannedPortions: 5, lots: ["b"] },
      { dishId: "ga-xao", key: "K2", plannedPortions: 7, lots: ["c"] },
      { dishId: "canh", key: "K3", plannedPortions: 4, lots: ["d"] },
    ],
    [
      {
        cookingBatchId: "CB1",
        dishId: "ga-xao",
        key: "K1",
        status: "ROUND1_APPROVED",
      },
      { cookingBatchId: "CB9", dishId: "canh", key: "K3", status: "COMPLETED" },
    ],
  );
  assert.deepEqual(split.parts, [
    {
      cookingBatchId: "CB1",
      dishId: "ga-xao",
      plannedPortions: 15,
      lots: ["a", "b"],
    },
  ]);
  assert.deepEqual(
    split.newBatches.map((plan) => plan.key),
    ["K2", "K3"],
  );
});

void test("Đợt 2 không cần: phải thừa suất ở mọi khối VÀ đủ nguyên liệu (6b, 6c, D30, N22)", () => {
  const grades = [
    {
      gradeId: "k1",
      gradeName: "Khối 1",
      batch1Portions: 100,
      actualPortions: 40,
    },
    {
      gradeId: "k2",
      gradeName: "Khối 2",
      batch1Portions: 80,
      actualPortions: 30,
    },
  ];
  const enough = batch2Decision(grades, [
    {
      ingredientEntryId: "chicken",
      name: "Thịt gà",
      unit: "kg",
      needed: "6.1",
      ordered: "7",
    },
  ]);
  assert.equal(enough.notNeeded, true);
  assert.deepEqual(
    enough.surplusByGrade.map((row) => row.surplus),
    [60, 50],
  );

  const short = batch2Decision(grades, [
    {
      ingredientEntryId: "chicken",
      name: "Thịt gà",
      unit: "kg",
      needed: "7.2",
      ordered: "7",
    },
  ]);
  assert.equal(short.notNeeded, false);
  assert.equal(short.shortages.length, 1);
  assert.equal(str(short.shortages[0].missing), "0.2");

  const gradeShort = batch2Decision(
    [grades[0], { ...grades[1], actualPortions: 90 }],
    [],
  );
  assert.equal(gradeShort.notNeeded, false);
  assert.equal(gradeShort.gradeShortage, true);
  assert.equal(batch2Decision([], []).notNeeded, false);
});
