/**
 * So khớp dị ứng của lớp với nguyên liệu theo TÊN, không bắt buộc trùng 100%.
 * Ví dụ dị ứng "Đậu xanh" phải bắt được nguyên liệu "Đậu xanh hạt", "Tôm" bắt được "Tôm nõn".
 *
 * Chuẩn hóa: Unicode NFC, chữ thường, ký tự không phải chữ/số thành khoảng trắng, gộp khoảng trắng.
 * GIỮ NGUYÊN DẤU tiếng Việt để "đậu" không khớp nhầm "dầu".
 * Khớp khi một tên chứa trọn tên kia theo ranh giới từ (cả hai chiều), nên "đậu xanh" khớp
 * "đậu xanh hạt" nhưng "đậu" không khớp "đậuu" và "tôm" không khớp "tômato".
 */
export function normalizeAllergenName(
  value: string | null | undefined,
): string {
  return String(value ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function allergenMatches(
  allergenName: string | null | undefined,
  ingredientName: string | null | undefined,
): boolean {
  const allergen = normalizeAllergenName(allergenName);
  const ingredient = normalizeAllergenName(ingredientName);
  if (!allergen || !ingredient) return false;
  return (
    ` ${ingredient} `.includes(` ${allergen} `) ||
    ` ${allergen} `.includes(` ${ingredient} `)
  );
}

/**
 * Nhóm suất riêng "che" được một xung đột dị ứng khi nó tránh đúng nguyên liệu khai dị ứng, hoặc tránh
 * một nguyên liệu khớp tên với dị ứng/với nguyên liệu gây xung đột (vd. tránh "Tôm nõn tươi" cho dị ứng "Tôm nõn").
 */
export function avoidanceCovers(
  avoidances: {
    ingredientEntryId: string;
    ingredientEntry?: { Ingredient?: { name: string } | null } | null;
  }[],
  allergy: { ingredientEntryId: string; allergenName: string },
  ingredientName: string,
) {
  return avoidances.some((a) => {
    if (a.ingredientEntryId === allergy.ingredientEntryId) return true;
    const name = a.ingredientEntry?.Ingredient?.name;
    return (
      !!name &&
      (allergenMatches(allergy.allergenName, name) ||
        allergenMatches(name, ingredientName))
    );
  });
}

/**
 * Quy số suất của các nhóm suất riêng về từng dị ứng khai báo của lớp (khớp theo mã hoặc theo tên).
 * `uncovered` = có nhóm suất riêng được chia suất nhưng không ứng với dị ứng nào của lớp.
 */
export function allergyCountsFromGroups(
  groups: {
    id: string;
    isDefault: boolean;
    avoidances: Parameters<typeof avoidanceCovers>[0];
  }[],
  countOf: (groupId: string) => number,
  allergies: { ingredientEntryId: string; allergenName: string }[],
) {
  const byAllergy = new Map<string, number>();
  // Dị ứng liên quan tới bữa này: có ít nhất một nhóm suất riêng tránh nó (dù đang 0 suất).
  const relevant = new Set(
    allergies
      .filter((allergy) =>
        groups.some(
          (group) =>
            !group.isDefault && avoidanceCovers(group.avoidances, allergy, ""),
        ),
      )
      .map((allergy) => allergy.ingredientEntryId),
  );
  let uncovered = false;
  for (const group of groups) {
    const count = countOf(group.id);
    if (group.isDefault || count <= 0) continue;
    const covered = allergies.filter((allergy) =>
      avoidanceCovers(group.avoidances, allergy, ""),
    );
    if (!covered.length) uncovered = true;
    for (const allergy of covered)
      byAllergy.set(
        allergy.ingredientEntryId,
        (byAllergy.get(allergy.ingredientEntryId) ?? 0) + count,
      );
  }
  return { byAllergy, uncovered, relevant };
}

/** Một dòng dị ứng của lớp (hoặc của ngày): thuộc nhóm `groupNo`, mọi dòng cùng nhóm cùng một số. */
export interface AllergyGroupRow {
  /** Số thứ tự nhóm dị ứng trong lớp; thiếu thì coi là nhóm 1 (danh sách chung kiểu cũ). */
  groupNo?: number;
  ingredientEntryId: string;
  allergenName: string;
  portionCount: number;
}

/** Nhóm dị ứng: tập nguyên liệu cùng tránh + số suất (học sinh) của nhóm, tính một lần. */
export interface AllergyGroup {
  groupNo: number;
  portions: number;
  allergens: { ingredientEntryId: string; allergenName: string }[];
}

/**
 * Gom các dòng dị ứng thành nhóm. Ví dụ A: 1, B: 1, (A, B): 1 là 3 nhóm, tổng 3 suất.
 * Số suất của nhóm là số lớn nhất trên các dòng của nhóm (các dòng cùng nhóm cùng một số);
 * nguyên liệu 0 suất (GVCN bỏ khỏi danh sách hôm nay) không tính vào nhóm.
 */
export function groupAllergies(rows: AllergyGroupRow[]): AllergyGroup[] {
  const byGroup = new Map<number, AllergyGroup>();
  for (const row of rows) {
    const groupNo = row.groupNo ?? 1;
    const group = byGroup.get(groupNo) ?? {
      groupNo,
      portions: 0,
      allergens: [],
    };
    if (row.portionCount > 0) {
      group.portions = Math.max(group.portions, row.portionCount);
      if (
        !group.allergens.some(
          (a) => a.ingredientEntryId === row.ingredientEntryId,
        )
      )
        group.allergens.push({
          ingredientEntryId: row.ingredientEntryId,
          allergenName: row.allergenName,
        });
    }
    byGroup.set(groupNo, group);
  }
  return [...byGroup.values()]
    .filter((group) => group.portions > 0 && group.allergens.length > 0)
    .sort((a, b) => a.groupNo - b.groupNo);
}

/** Tổng số suất dị ứng của lớp: mỗi nhóm tính một lần. */
export function totalAllergyPortions(rows: AllergyGroupRow[]): number {
  return groupAllergies(rows).reduce((sum, group) => sum + group.portions, 0);
}

type PortionGroupLike = {
  id: string;
  isDefault: boolean;
  avoidances: Parameters<typeof avoidanceCovers>[0];
};

/**
 * Nhóm suất riêng nhận suất của một nhóm dị ứng: tránh được nhiều nguyên liệu của nhóm nhất;
 * bằng nhau thì chọn nhóm suất tránh ít nguyên liệu hơn (sát nhất), rồi nhóm đứng trước.
 * Không nhóm riêng nào tránh nguyên liệu nào của nhóm thì bữa này không chứa chúng: suất vào nhóm thường.
 */
export function allergyGroupTarget(
  groups: PortionGroupLike[],
  allergyGroup: AllergyGroup,
): string | null {
  let best: { id: string; covered: number; size: number } | null = null;
  for (const group of groups) {
    if (group.isDefault) continue;
    const covered = allergyGroup.allergens.filter((allergy) =>
      avoidanceCovers(group.avoidances, allergy, ""),
    ).length;
    const size = group.avoidances.length;
    if (
      covered > 0 &&
      (!best ||
        covered > best.covered ||
        (covered === best.covered && size < best.size))
    )
      best = { id: group.id, covered, size };
  }
  return best?.id ?? null;
}

/**
 * Chia sĩ số đã chốt vào các nhóm suất của bữa: mỗi nhóm dị ứng của lớp vào nhóm suất riêng theo
 * allergyGroupTarget (tính một lần); còn lại vào nhóm thường. Suất dị ứng vượt sĩ số -> null.
 */
export function splitPortionsIntoGroups(
  groups: PortionGroupLike[],
  totalPortions: number,
  allergies: AllergyGroupRow[],
): Map<string, number> | null {
  const fallback = groups.find((group) => group.isDefault);
  if (!fallback) return null;
  const counts = new Map(groups.map((group) => [group.id, 0]));
  let special = 0;
  for (const [groupId, portions] of expectedSpecialGroupCounts(
    groups,
    allergies,
  )) {
    counts.set(groupId, portions);
    special += portions;
  }
  if (special > totalPortions) return null;
  counts.set(fallback.id, totalPortions - special);
  return counts;
}

/** Số suất mỗi nhóm suất riêng phải có theo các nhóm dị ứng đã khai (quy tắc allergyGroupTarget). */
export function expectedSpecialGroupCounts(
  groups: PortionGroupLike[],
  allergies: AllergyGroupRow[],
): Map<string, number> {
  const expected = new Map(
    groups.filter((g) => !g.isDefault).map((g) => [g.id, 0]),
  );
  for (const allergyGroup of groupAllergies(allergies)) {
    const target = allergyGroupTarget(groups, allergyGroup);
    if (target)
      expected.set(target, (expected.get(target) ?? 0) + allergyGroup.portions);
  }
  return expected;
}
