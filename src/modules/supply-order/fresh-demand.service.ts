/**
 * TASK-08 — Tính lượng nguyên liệu tươi (DIRECT_USE) cần đặt theo khối cho Đợt 1 / Đợt 2.
 *
 * - Chọn thực đơn đã duyệt có ngày khớp; toàn trường áp cho mọi khối, thực đơn tách khối áp đúng khối gán.
 * - Định lượng lấy từ công thức mới nhất `dish_grade_recipe_lines` theo (dish, grade); thiếu thì báo lỗi.
 * - Đợt 1 = floor(suất kế hoạch / 2) từng khối, lưu mốc khi tạo đơn. Đợt 2 = max(0, thực tế − mốc Đợt 1).
 * - Cùng một số suất của khối áp cho cả bữa chính và bữa xế. Không làm tròn số lượng đặt.
 */
import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";

type Tx = Prisma.TransactionClient;
type MealType = "LUNCH" | "AFTERNOON";

export type GradePortion = {
  gradeId: string;
  gradeName: string;
  plannedPortions: number;
  batch1Portions: number;
  actualPortions: number | null;
  batchPortions: number;
};

export type DemandDetail = {
  dishId: string;
  dishName: string;
  mealType: MealType;
  gradeId: string;
  gradeName: string;
  quantityPerPortion: number;
  recipeUnit: string;
  portions: number;
  quantity: number;
};

export type DemandItem = {
  ingredientEntryId: string;
  ingredientId: string;
  name: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  /** Lượng tính theo suất của đợt (chưa làm tròn). */
  quantity: number;
  /**
   * Đợt 1: phần lẻ sau khi làm tròn xuống, chuyển sang Đợt 2.
   * Đợt 2: phần lẻ Đợt 1 đã lưu, cộng vào lượng đặt.
   */
  carryOverQuantity: number;
  /** Lượng đặt: Đợt 1 = floor(quantity); Đợt 2 = quantity + carryOverQuantity. */
  orderQuantity: number;
  details: DemandDetail[];
};

export type CarryOverRow = {
  ingredientEntryId: string;
  ingredientId: string;
  name: string;
  unit: string;
  supplierId: string;
  supplierName: string;
  quantity: number;
};

export type FreshDemandResult = {
  date: string;
  batchNo: 1 | 2;
  batch1Saved: boolean;
  /** Mọi thực đơn áp dụng trong ngày đều là toàn trường. */
  schoolWide: boolean;
  grades: GradePortion[];
  items: DemandItem[];
};

// ---------- Thuần tính toán (test được không cần DB) ----------

export type CalcInput = {
  batchNo: 1 | 2;
  grades: { id: string; name: string }[];
  planned: Map<string, number>;
  /** Mốc Đợt 1 đã lưu theo khối (null nếu chưa lưu). */
  savedBatch1: Map<string, number> | null;
  /** Ngày đã có đơn Đợt 1 tạo trước khi có bảng mốc: dùng mốc bù floor(kế hoạch / 2). */
  legacyBatch1?: boolean;
  /** Suất thực tế đã chốt theo khối (chỉ cần cho Đợt 2). */
  actual: Map<string, number> | null;
  menus: {
    id: string;
    title: string | null;
    isSchoolWide: boolean;
    gradeIds: string[];
    dishes: { dishId: string; dishName: string; mealType: MealType }[];
  }[];
  recipes: Map<
    string,
    {
      ingredientEntryId: string;
      ingredientId: string;
      name: string;
      handlingType: string;
      active: boolean;
      requiredQuantity: number;
      unit: string;
      orderUnit: string;
      supplierId: string;
      supplierName: string;
    }[]
  >;
};

const recipeKey = (dishId: string, gradeId: string) => `${dishId}:${gradeId}`;
const norm = (u: string) => u.trim().toLowerCase();
const UNIT_FACTORS: Record<string, [string, number]> = {
  g: ["kg", 1 / 1000],
  gram: ["kg", 1 / 1000],
  gam: ["kg", 1 / 1000],
  mg: ["kg", 1 / 1_000_000],
  ml: ["l", 1 / 1000],
  mililit: ["l", 1 / 1000],
};
const UNIT_ALIASES: Record<string, string> = {
  kilogram: "kg",
  kí: "kg",
  lít: "l",
  lit: "l",
  liter: "l",
};
const canon = (u: string) => UNIT_ALIASES[norm(u)] ?? norm(u);

/** Hệ số quy đổi từ đơn vị công thức sang đơn vị đặt hàng; null nếu không quy đổi được. */
export function unitFactor(from: string, to: string): number | null {
  const f = canon(from);
  const t = canon(to);
  if (f === t) return 1;
  const conv = UNIT_FACTORS[f];
  if (conv && conv[0] === t) return conv[1];
  const back = UNIT_FACTORS[t];
  if (back && back[0] === f) return 1 / back[1];
  return null;
}

/** Cộng số thập phân tránh sai số dấu phẩy động (giữ 6 chữ số, không làm tròn nghiệp vụ). */
const add = (a: number, b: number) => Number((a + b).toFixed(6));
const mul = (a: number, b: number) => Number((a * b).toFixed(6));

export function computeFreshDemand(
  input: CalcInput,
): Omit<FreshDemandResult, "date" | "schoolWide"> {
  const errors: string[] = [];
  const gradeName = new Map(input.grades.map((g) => [g.id, g.name]));
  const activeGrades = input.grades.filter(
    (g) => (input.planned.get(g.id) ?? 0) > 0,
  );

  // 1. Xác định thực đơn áp dụng cho từng (khối, buổi); chồng nhau thì báo lỗi.
  const assigned = new Map<string, (typeof input.menus)[number]>();
  for (const grade of activeGrades) {
    for (const mealType of ["LUNCH", "AFTERNOON"] as const) {
      const covering = input.menus.filter(
        (m) =>
          (m.isSchoolWide || m.gradeIds.includes(grade.id)) &&
          m.dishes.some((d) => d.mealType === mealType),
      );
      if (covering.length > 1)
        errors.push(
          `${grade.name} (${mealType === "LUNCH" ? "bữa chính" : "bữa xế"}) có ${covering.length} thực đơn đã duyệt chồng nhau: ${covering.map((m) => m.title ?? m.id).join(", ")}`,
        );
      else if (covering.length === 1)
        assigned.set(`${grade.id}:${mealType}`, covering[0]);
    }
    if (
      !assigned.has(`${grade.id}:LUNCH`) &&
      !assigned.has(`${grade.id}:AFTERNOON`) &&
      !errors.some((e) => e.startsWith(grade.name))
    )
      errors.push(`${grade.name} chưa có thực đơn đã duyệt cho ngày này`);
  }

  // 2. Số suất của đợt theo khối.
  const grades: GradePortion[] = activeGrades.map((g) => {
    const planned = input.planned.get(g.id) ?? 0;
    const batch1 = input.savedBatch1?.get(g.id) ?? Math.floor(planned / 2);
    let actual: number | null = null;
    let batchPortions = batch1;
    if (input.batchNo === 2) {
      if (!input.savedBatch1?.has(g.id) && !input.legacyBatch1)
        errors.push(`${g.name} chưa có mốc suất Đợt 1 đã lưu`);
      actual = input.actual?.get(g.id) ?? 0;
      batchPortions = Math.max(0, actual - batch1);
    }
    return {
      gradeId: g.id,
      gradeName: g.name,
      plannedPortions: planned,
      batch1Portions: batch1,
      actualPortions: actual,
      batchPortions,
    };
  });

  // 3. Nhân định lượng × suất, quy đổi đơn vị, cộng theo ingredient_entry_id.
  const items = new Map<string, DemandItem>();
  const missingRecipes = new Set<string>();
  for (const g of grades) {
    for (const mealType of ["LUNCH", "AFTERNOON"] as const) {
      const menu = assigned.get(`${g.gradeId}:${mealType}`);
      if (!menu) continue;
      for (const dish of menu.dishes.filter((d) => d.mealType === mealType)) {
        const lines = input.recipes.get(recipeKey(dish.dishId, g.gradeId));
        if (!lines || lines.length === 0) {
          missingRecipes.add(`${dish.dishName} — ${g.gradeName}`);
          continue;
        }
        for (const line of lines) {
          if (line.handlingType !== "DIRECT_USE") continue;
          if (!line.active) {
            errors.push(
              `Nguyên liệu ${line.name} (món ${dish.dishName}) không còn hoạt động trong danh mục trường`,
            );
            continue;
          }
          const factor = unitFactor(line.unit, line.orderUnit);
          if (factor === null) {
            errors.push(
              `Không quy đổi được ${line.unit} sang ${line.orderUnit} cho ${line.name} (món ${dish.dishName}, ${g.gradeName})`,
            );
            continue;
          }
          const perPortion = mul(line.requiredQuantity, factor);
          const quantity = mul(perPortion, g.batchPortions);
          const item = items.get(line.ingredientEntryId) ?? {
            ingredientEntryId: line.ingredientEntryId,
            ingredientId: line.ingredientId,
            name: line.name,
            unit: line.orderUnit,
            supplierId: line.supplierId,
            supplierName: line.supplierName,
            quantity: 0,
            carryOverQuantity: 0,
            orderQuantity: 0,
            details: [],
          };
          item.quantity = add(item.quantity, quantity);
          item.details.push({
            dishId: dish.dishId,
            dishName: dish.dishName,
            mealType,
            gradeId: g.gradeId,
            gradeName: gradeName.get(g.gradeId) ?? g.gradeName,
            quantityPerPortion: line.requiredQuantity,
            recipeUnit: line.unit,
            portions: g.batchPortions,
            quantity,
          });
          items.set(line.ingredientEntryId, item);
        }
      }
    }
  }
  if (missingRecipes.size)
    errors.push(`Thiếu công thức theo khối: ${[...missingRecipes].join("; ")}`);
  if (errors.length) throw new HttpError(422, errors.join(". "));

  for (const item of items.values()) {
    if (input.batchNo === 1) {
      // Đợt 1 làm tròn xuống số nguyên của đơn vị đặt; phần lẻ để dành cho Đợt 2.
      const whole = Math.floor(item.quantity + 1e-9);
      item.orderQuantity = whole;
      item.carryOverQuantity = Math.max(
        0,
        Number((item.quantity - whole).toFixed(3)),
      );
    } else {
      item.orderQuantity = item.quantity;
    }
  }

  return {
    batchNo: input.batchNo,
    batch1Saved: input.savedBatch1 !== null && input.savedBatch1.size > 0,
    grades,
    items: [...items.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Đợt 2: cộng phần lẻ Đợt 1 đã lưu vào lượng đặt; nguyên liệu chỉ có phần lẻ vẫn được thêm dòng. */
export function applyCarryOver(
  items: DemandItem[],
  carry: CarryOverRow[],
): DemandItem[] {
  const byEntry = new Map(items.map((i) => [i.ingredientEntryId, i]));
  for (const c of carry) {
    const item = byEntry.get(c.ingredientEntryId) ?? {
      ingredientEntryId: c.ingredientEntryId,
      ingredientId: c.ingredientId,
      name: c.name,
      unit: c.unit,
      supplierId: c.supplierId,
      supplierName: c.supplierName,
      quantity: 0,
      carryOverQuantity: 0,
      orderQuantity: 0,
      details: [],
    };
    item.carryOverQuantity = add(item.carryOverQuantity, c.quantity);
    item.orderQuantity = add(item.quantity, item.carryOverQuantity);
    byEntry.set(c.ingredientEntryId, item);
  }
  return [...byEntry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Nạp dữ liệu ----------

const dateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

export async function loadFreshDemand(
  tx: Tx,
  schoolId: string,
  date: string,
  batchNo: 1 | 2,
): Promise<FreshDemandResult> {
  const day = dateOnly(date);
  const [classes, gradeRows, menus, saved] = await Promise.all([
    tx.class.findMany({
      where: { schoolId, status: "ACTIVE", registeredMealPortions: { gt: 0 } },
      select: {
        name: true,
        gradeId: true,
        registeredMealPortions: true,
        // Điểm danh cả ngày: tạm đọc bản ghi LUNCH cho tới khi bỏ meal_type khỏi daily_meal_portions.
        dailyMealPortions: {
          where: { mealDate: day, mealType: "LUNCH", status: "FINALIZED" },
          select: { totalPortions: true },
        },
      },
    }),
    tx.schoolGrade.findMany({
      where: { schoolId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    tx.weeklyMenu.findMany({
      where: {
        schoolId,
        status: "APPROVED",
        menuDays: { some: { menuDate: day } },
      },
      select: {
        id: true,
        title: true,
        isSchoolWide: true,
        grades: { select: { gradeId: true } },
        menuDays: {
          where: { menuDate: day },
          select: {
            menuDayDishes: {
              select: {
                dishId: true,
                mealType: true,
                Dish: { select: { name: true } },
              },
              orderBy: { displayOrder: "asc" },
            },
          },
        },
      },
    }),
    tx.supplyBatch1GradePortion.findMany({
      where: { schoolId, deliveryDate: day },
      select: { gradeId: true, portions: true },
    }),
  ]);
  const legacyBatch1 =
    batchNo === 2 &&
    saved.length === 0 &&
    (await tx.supplyRequest.count({
      where: {
        schoolId,
        requestedDeliveryDate: day,
        orderType: "DIRECT_USE",
        batchNo: 1,
        status: { not: "CANCELLED" },
      },
    })) > 0;

  const noGrade = classes.filter((c) => !c.gradeId);
  if (noGrade.length)
    throw new HttpError(
      422,
      `Lớp chưa gán khối: ${noGrade.map((c) => c.name).join(", ")}`,
    );
  if (menus.length === 0)
    throw new HttpError(422, `Không có thực đơn đã duyệt cho ngày ${date}`);

  const planned = new Map<string, number>();
  const actual = new Map<string, number>();
  const notFinalized: string[] = [];
  for (const c of classes) {
    const g = c.gradeId!;
    planned.set(g, (planned.get(g) ?? 0) + c.registeredMealPortions);
    if (c.dailyMealPortions.length === 0) notFinalized.push(c.name);
    actual.set(
      g,
      (actual.get(g) ?? 0) + (c.dailyMealPortions[0]?.totalPortions ?? 0),
    );
  }
  if (batchNo === 2 && notFinalized.length)
    throw new HttpError(
      409,
      `Chưa thể tính Đợt 2: còn ${notFinalized.length} lớp chưa chốt điểm danh (${notFinalized.sort().join(", ")})`,
    );

  const menuInputs = menus.map((m) => ({
    id: m.id,
    title: m.title,
    isSchoolWide: m.isSchoolWide,
    gradeIds: m.grades.map((g) => g.gradeId),
    dishes: m.menuDays.flatMap((d) =>
      d.menuDayDishes.map((x) => ({
        dishId: x.dishId,
        dishName: x.Dish.name,
        mealType: x.mealType,
      })),
    ),
  }));
  const dishIds = [
    ...new Set(menuInputs.flatMap((m) => m.dishes.map((d) => d.dishId))),
  ];
  const recipeRows = await tx.dishGradeRecipeLine.findMany({
    where: {
      dishId: { in: dishIds },
      gradeId: { in: [...planned.keys()] },
      recipe: { schoolId },
    },
    select: {
      dishId: true,
      gradeId: true,
      ingredientEntryId: true,
      requiredQuantity: true,
      unit: true,
      entry: {
        select: {
          handlingType: true,
          status: true,
          Ingredient: {
            select: {
              id: true,
              name: true,
              defaultUnit: true,
              supplierId: true,
              Supplier: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  const recipes: CalcInput["recipes"] = new Map();
  for (const r of recipeRows) {
    const key = recipeKey(r.dishId, r.gradeId);
    const list = recipes.get(key) ?? [];
    list.push({
      ingredientEntryId: r.ingredientEntryId,
      ingredientId: r.entry.Ingredient.id,
      name: r.entry.Ingredient.name,
      handlingType: r.entry.handlingType,
      active: r.entry.status === "ACTIVE",
      requiredQuantity: Number(r.requiredQuantity),
      unit: r.unit,
      orderUnit: r.entry.Ingredient.defaultUnit,
      supplierId: r.entry.Ingredient.supplierId,
      supplierName: r.entry.Ingredient.Supplier.name,
    });
    recipes.set(key, list);
  }

  const result = computeFreshDemand({
    batchNo,
    grades: gradeRows,
    planned,
    savedBatch1: saved.length
      ? new Map(saved.map((s) => [s.gradeId, s.portions]))
      : null,
    legacyBatch1,
    actual: batchNo === 2 ? actual : null,
    menus: menuInputs,
    recipes,
  });
  if (batchNo === 2) {
    const carryRows = await tx.supplyBatch1Carryover.findMany({
      where: { schoolId, deliveryDate: day },
      select: {
        ingredientEntryId: true,
        quantity: true,
        unit: true,
        entry: {
          select: {
            Ingredient: {
              select: {
                id: true,
                name: true,
                supplierId: true,
                Supplier: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    result.items = applyCarryOver(
      result.items,
      carryRows.map((r) => ({
        ingredientEntryId: r.ingredientEntryId,
        ingredientId: r.entry.Ingredient.id,
        name: r.entry.Ingredient.name,
        unit: r.unit,
        supplierId: r.entry.Ingredient.supplierId,
        supplierName: r.entry.Ingredient.Supplier.name,
        quantity: Number(r.quantity),
      })),
    );
  }
  return {
    date,
    schoolWide: menus.every((m) => m.isSchoolWide),
    ...result,
  };
}

/**
 * Lưu mốc suất Đợt 1 và phần lẻ chuyển Đợt 2 nếu chưa có;
 * các đơn cùng ngày (nhiều NCC) dùng chung mốc đã lưu đầu tiên.
 */
export async function saveBatch1Snapshot(
  tx: Tx,
  schoolId: string,
  date: string,
  grades: GradePortion[],
  items: DemandItem[] = [],
) {
  const carry = items.filter((i) => i.carryOverQuantity > 0);
  if (carry.length)
    await tx.supplyBatch1Carryover.createMany({
      data: carry.map((i) => ({
        schoolId,
        deliveryDate: dateOnly(date),
        ingredientEntryId: i.ingredientEntryId,
        quantity: i.carryOverQuantity,
        unit: i.unit,
      })),
      skipDuplicates: true,
    });
  await tx.supplyBatch1GradePortion.createMany({
    data: grades.map((g) => ({
      schoolId,
      deliveryDate: dateOnly(date),
      gradeId: g.gradeId,
      portions: g.batch1Portions,
    })),
    skipDuplicates: true,
  });
}

export async function getFreshDemand(
  principal: AuthPrincipal,
  query: { date: string; batchNo: 1 | 2 },
) {
  assertPermission(principal, "supply_request.create");
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Tài khoản chưa thuộc phạm vi trường học.");
  const schoolId = principal.schoolId;
  const db = await databaseOperation(getPrisma);
  return authorizationTransaction(db, (tx) =>
    loadFreshDemand(tx, schoolId, query.date, query.batchNo),
  );
}
