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

/**
 * Chia sĩ số đã chốt vào các nhóm suất của bữa: mỗi suất dị ứng GVCN khai lúc điểm danh vào nhóm suất
 * riêng đầu tiên tránh dị ứng đó (khớp mã hoặc tên); phần còn lại vào nhóm thường (mặc định).
 * Dị ứng không có nhóm riêng nào tránh thì bữa này không chứa nguyên liệu đó: tính vào nhóm thường.
 */
export function splitPortionsIntoGroups(
  groups: {
    id: string;
    isDefault: boolean;
    avoidances: Parameters<typeof avoidanceCovers>[0];
  }[],
  totalPortions: number,
  allergies: {
    ingredientEntryId: string;
    allergenName: string;
    portionCount: number;
  }[],
): Map<string, number> | null {
  const fallback = groups.find((group) => group.isDefault);
  if (!fallback) return null;
  const counts = new Map(groups.map((group) => [group.id, 0]));
  let special = 0;
  for (const allergy of allergies) {
    if (allergy.portionCount <= 0) continue;
    const group = groups.find(
      (g) => !g.isDefault && avoidanceCovers(g.avoidances, allergy, ""),
    );
    if (!group) continue;
    counts.set(group.id, counts.get(group.id)! + allergy.portionCount);
    special += allergy.portionCount;
  }
  if (special > totalPortions) return null;
  counts.set(fallback.id, totalPortions - special);
  return counts;
}
