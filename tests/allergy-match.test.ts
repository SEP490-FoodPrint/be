import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allergenMatches,
  allergyCountsFromGroups,
  expectedSpecialGroupCounts,
  normalizeAllergenName,
  splitPortionsIntoGroups,
  groupAllergies,
  totalAllergyPortions,
  allergyGroupTarget,
} from "../src/utils/allergy-match";
import {
  avoidanceCovers,
  matchClassAllergies,
} from "../src/modules/menu/menu.service";

void test("dị ứng so theo tên, không cần trùng 100%", () => {
  // Tên dài hơn vẫn là cùng thực phẩm.
  assert.equal(allergenMatches("Đậu xanh", "Đậu xanh hạt"), true);
  assert.equal(allergenMatches("Tôm", "Tôm nõn"), true);
  assert.equal(allergenMatches("đậu  XANH", " Đậu xanh (bóc vỏ) "), true);
  // Hai chiều: khai báo cụ thể hơn vẫn bắt được nguyên liệu tên ngắn.
  assert.equal(allergenMatches("Đậu xanh hạt", "Đậu xanh"), true);
  // Giữ dấu: "đậu" không khớp "dầu"; ranh giới từ: không khớp giữa chữ.
  assert.equal(allergenMatches("Đậu", "Dầu ăn"), false);
  assert.equal(allergenMatches("Tôm", "Tômato"), false);
  assert.equal(allergenMatches("Đậu xanh", "Đậu đỏ hạt"), false);
  assert.equal(allergenMatches("", "Đậu xanh"), false);
  assert.equal(normalizeAllergenName("  Sữa-Bò  tươi "), "sữa bò tươi");
});

void test("matchClassAllergies ghép từng dị ứng của lớp với nguyên liệu khớp tên trong bữa", () => {
  const rows = [
    { id: "a1", IngredientEntry: { Ingredient: { name: "Đậu xanh" } } },
    { id: "a2", IngredientEntry: { Ingredient: { name: "Tôm" } } },
  ];
  const pairs = matchClassAllergies(rows, [
    { id: "i1", name: "Đậu xanh hạt" },
    { id: "i2", name: "Thịt lợn nạc" },
    { id: "i3", name: "Tôm nõn" },
  ]);
  assert.deepEqual(
    pairs.map((p) => `${p.row.id}->${p.ingredient.id}`),
    ["a1->i1", "a2->i3"],
  );
});

void test("nhóm suất riêng tránh nguyên liệu khớp tên vẫn che được dị ứng (Tôm nõn ~ Tôm nõn tươi)", () => {
  const allergy = {
    ingredientEntryId: "entry-tom-non",
    allergenName: "Tôm nõn",
  };
  const avoidTomTuoi = [
    {
      ingredientEntryId: "entry-tom-non-tuoi",
      ingredientEntry: { Ingredient: { name: "Tôm nõn tươi" } },
    },
  ];
  assert.equal(avoidanceCovers(avoidTomTuoi, allergy, "Tôm nõn tươi"), true);
  // Tránh đúng mã nguyên liệu khai dị ứng.
  assert.equal(
    avoidanceCovers(
      [{ ingredientEntryId: "entry-tom-non" }],
      allergy,
      "Tôm nõn tươi",
    ),
    true,
  );
  // Nhóm tránh thứ khác thì không che được.
  assert.equal(
    avoidanceCovers(
      [
        {
          ingredientEntryId: "x",
          ingredientEntry: { Ingredient: { name: "Đậu phộng" } },
        },
      ],
      allergy,
      "Tôm nõn tươi",
    ),
    false,
  );
  // Thiếu tên nguyên liệu (truy vấn không lấy tên) không được văng lỗi.
  assert.equal(
    avoidanceCovers(
      [{ ingredientEntryId: "x", ingredientEntry: {} }],
      allergy,
      "Tôm nõn tươi",
    ),
    false,
  );
});

void test("allergyCountsFromGroups quy suất nhóm riêng về dị ứng của lớp theo tên", () => {
  const groups = [
    { id: "default", isDefault: true, avoidances: [] },
    {
      id: "tom",
      isDefault: false,
      avoidances: [
        {
          ingredientEntryId: "e-tom-tuoi",
          ingredientEntry: { Ingredient: { name: "Tôm nõn tươi" } },
        },
      ],
    },
  ];
  const counts: Record<string, number> = { default: 31, tom: 1 };
  const ok = allergyCountsFromGroups(groups, (id) => counts[id], [
    { ingredientEntryId: "e-tom-non", allergenName: "Tôm nõn" },
  ]);
  assert.equal(ok.byAllergy.get("e-tom-non"), 1);
  assert.equal(ok.uncovered, false);
  // Lớp không có dị ứng tôm mà vẫn chia suất vào nhóm riêng -> uncovered.
  const bad = allergyCountsFromGroups(groups, (id) => counts[id], []);
  assert.equal(bad.uncovered, true);
  // Nhóm riêng 0 suất thì không tính.
  counts.tom = 0;
  assert.equal(
    allergyCountsFromGroups(groups, (id) => counts[id], []).uncovered,
    false,
  );
});

void test("splitPortionsIntoGroups: suất dị ứng khai lúc điểm danh vào nhóm riêng, còn lại vào nhóm thường", () => {
  const groups = [
    { id: "default", isDefault: true, avoidances: [] },
    {
      id: "dau-xanh",
      isDefault: false,
      avoidances: [
        {
          ingredientEntryId: "e-dx-hat",
          ingredientEntry: { Ingredient: { name: "Đậu xanh hạt" } },
        },
      ],
    },
  ];
  const split = splitPortionsIntoGroups(groups, 30, [
    {
      ingredientEntryId: "e-dau-xanh",
      allergenName: "Đậu xanh",
      portionCount: 1,
    },
  ]);
  assert.deepEqual(Object.fromEntries(split!), { default: 29, "dau-xanh": 1 });
  // Bữa không có nhóm riêng cho dị ứng đó: toàn bộ vào nhóm thường.
  const onlyDefault = splitPortionsIntoGroups([groups[0]], 30, [
    {
      ingredientEntryId: "e-dau-xanh",
      allergenName: "Đậu xanh",
      portionCount: 1,
    },
  ]);
  assert.deepEqual(Object.fromEntries(onlyDefault!), { default: 30 });
  // Suất dị ứng vượt sĩ số -> null (BE báo lỗi).
  assert.equal(
    splitPortionsIntoGroups(groups, 0, [
      {
        ingredientEntryId: "e-dau-xanh",
        allergenName: "Đậu xanh",
        portionCount: 1,
      },
    ]),
    null,
  );
});

void test("danh sách dị ứng chung: số học sinh dị ứng chỉ tính một lần dù dị ứng nhiều nguyên liệu", () => {
  const groups = [
    { id: "default", isDefault: true, avoidances: [] },
    {
      id: "kieng-tom",
      isDefault: false,
      avoidances: [
        {
          ingredientEntryId: "e-tom",
          ingredientEntry: { Ingredient: { name: "Tôm nõn" } },
        },
      ],
    },
    {
      id: "kieng-dau-xanh",
      isDefault: false,
      avoidances: [
        {
          ingredientEntryId: "e-dau-xanh",
          ingredientEntry: { Ingredient: { name: "Đậu xanh" } },
        },
      ],
    },
  ];
  // Em A dị ứng cả đậu xanh và đậu xanh hạt: lớp khai 1 học sinh chung cho cả danh sách.
  const oneStudent = [
    {
      ingredientEntryId: "e-dau-xanh",
      allergenName: "Đậu xanh",
      portionCount: 1,
    },
    {
      ingredientEntryId: "e-dau-xanh-hat",
      allergenName: "Đậu xanh hạt",
      portionCount: 1,
    },
  ];
  assert.deepEqual(
    [...expectedSpecialGroupCounts(groups, oneStudent)],
    [
      ["kieng-tom", 0],
      ["kieng-dau-xanh", 1],
    ],
  );
  const split = splitPortionsIntoGroups(groups, 30, oneStudent);
  assert.equal(split?.get("kieng-dau-xanh"), 1);
  assert.equal(split?.get("default"), 29);

  // Bữa không có nhóm riêng nào tránh nguyên liệu dị ứng của lớp: không có suất riêng.
  const noMatch = splitPortionsIntoGroups(groups.slice(0, 2), 30, oneStudent);
  assert.equal(noMatch?.get("kieng-tom"), 0);
  assert.equal(noMatch?.get("default"), 30);

  // Không khai suất dị ứng hôm đó.
  assert.equal(
    expectedSpecialGroupCounts(groups, [
      {
        ingredientEntryId: "e-dau-xanh",
        allergenName: "Đậu xanh",
        portionCount: 0,
      },
    ]).get("kieng-dau-xanh"),
    0,
  );
});

void test("nhóm dị ứng theo lớp: A: 1, B: 1, (A, B): 1 là 3 suất, mỗi nhóm tính một lần vào nhóm suất sát nhất", () => {
  const entry = (id: string, name: string) => ({
    ingredientEntryId: id,
    ingredientEntry: { Ingredient: { name } },
  });
  const groups = [
    { id: "default", isDefault: true, avoidances: [] },
    { id: "tranh-sua", isDefault: false, avoidances: [entry("e-a", "Sữa")] },
    { id: "tranh-lac", isDefault: false, avoidances: [entry("e-b", "Lạc")] },
    {
      id: "tranh-ca-hai",
      isDefault: false,
      avoidances: [entry("e-a", "Sữa"), entry("e-b", "Lạc")],
    },
  ];
  const rows = [
    {
      groupNo: 1,
      ingredientEntryId: "e-a",
      allergenName: "Sữa",
      portionCount: 1,
    },
    {
      groupNo: 2,
      ingredientEntryId: "e-b",
      allergenName: "Lạc",
      portionCount: 1,
    },
    {
      groupNo: 3,
      ingredientEntryId: "e-a",
      allergenName: "Sữa",
      portionCount: 1,
    },
    {
      groupNo: 3,
      ingredientEntryId: "e-b",
      allergenName: "Lạc",
      portionCount: 1,
    },
  ];
  assert.equal(groupAllergies(rows).length, 3);
  assert.equal(totalAllergyPortions(rows), 3);
  // Nhóm A vào "tránh sữa" (sát nhất, không vào nhóm tránh cả hai); nhóm (A, B) vào "tránh cả hai".
  assert.equal(
    allergyGroupTarget(groups, groupAllergies(rows)[0]),
    "tranh-sua",
  );
  assert.equal(
    allergyGroupTarget(groups, groupAllergies(rows)[2]),
    "tranh-ca-hai",
  );
  assert.deepEqual(
    Object.fromEntries(splitPortionsIntoGroups(groups, 30, rows)!),
    {
      default: 27,
      "tranh-sua": 1,
      "tranh-lac": 1,
      "tranh-ca-hai": 1,
    },
  );
  // Thực đơn chỉ có nhóm tránh cả hai: cả 3 nhóm dị ứng vào đó (3 suất, không đếm trùng).
  assert.deepEqual(
    Object.fromEntries(
      splitPortionsIntoGroups([groups[0], groups[3]], 30, rows)!,
    ),
    { default: 27, "tranh-ca-hai": 3 },
  );
  // Nhóm B nghỉ hôm nay (0 suất): còn 2 suất.
  const absentB = rows.map((r) =>
    r.groupNo === 2 ? { ...r, portionCount: 0 } : r,
  );
  assert.equal(totalAllergyPortions(absentB), 2);
  assert.equal(
    splitPortionsIntoGroups(groups, 30, absentB)?.get("tranh-lac"),
    0,
  );
  // Tổng suất dị ứng vượt sĩ số -> null.
  assert.equal(splitPortionsIntoGroups(groups, 2, rows), null);
});
