import { resolveMeasurementUnit } from "../measurement-unit/measurement-unit.service";
import type { AuthPrincipal } from "../../types/auth";
import { Prisma as RecipePrisma } from "../../generated/prisma/client";
import { withSchoolTransaction } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../kitchen/kitchen.service";
import { scaleDishLines } from "../../utils/dish-portion";
import {
  DUPLICATE_DISH_NAME,
  dishRecipeRepository as recipes,
} from "./dish.repository";
import type { DishRecipeWrite } from "./dish.request.dto";
import type { DishRecipeDTO } from "./dish.response.dto";
import type { DishCategoryOptionDTO } from "./dish.response.dto";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  schoolId: true,
  name: true,
  category: true,
  mealType: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DishSelect;

type ListRow = Prisma.DishGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.DishFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.dish.findMany(args);
};

export function createDishService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["dish"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ id: "asc" }],
          }),
        query,
      );
    },
  };
}

export const dishService = createDishService();
export type DishService = ReturnType<typeof createDishService>;

type RecipeRows = Awaited<ReturnType<typeof recipes.recipes>>;
export const dishCategoryOptions: DishCategoryOptionDTO[] = [
  { key: "RICE_STARCH", label: "Cơm / Tinh bột" },
  { key: "MAIN_DISH", label: "Món mặn chính" },
  { key: "VEGETABLE", label: "Món rau / xào" },
  { key: "SOUP", label: "Món canh" },
  { key: "DESSERT", label: "Món phụ / Tráng miệng" },
];
function recipeDTO(row: RecipeRows[number]): DishRecipeDTO {
  const lines = row.dishIngredientEntries.map((r) => ({
    ingredientEntryId: r.ingredientEntryId,
    ingredientId: r.IngredientEntry.ingredientId,
    name: r.IngredientEntry.Ingredient.name,
    category:
      r.IngredientEntry.Ingredient.ingredientCategory?.categoryName ?? null,
    categoryId: r.IngredientEntry.Ingredient.categoryId ?? null,
    supplierId: r.IngredientEntry.Ingredient.supplierId,
    supplierName: r.IngredientEntry.Ingredient.Supplier.name,
    ingredientRole: r.ingredientRole,
    requiredQuantity: r.requiredQuantity.toString(),
    unit: r.unit,
  }));
  return {
    id: row.id,
    name: row.name,
    mealType: row.mealType ?? null,
    category: row.categoryId,
    categoryLabel: row.schoolCategory?.name ?? null,
    description: row.description,
    standardQuantity: row.standardQuantity.toString(),
    standardUnit: row.standardUnit,
    gradeRecipes: (row.gradeRecipes ?? []).map((profile) => ({
      gradeId: profile.gradeId,
      gradeName: profile.grade.name,
      portionQuantity: profile.portionQuantity.toString(),
      // Định lượng 1 suất của khối, tính sẵn từ mốc chuẩn và khẩu phần.
      lines: scaleDishLines(
        row.standardQuantity,
        profile.portionQuantity,
        lines,
      ).map((line) => ({
        ...line,
        ingredientRole: line.ingredientRole ?? "MAIN",
        requiredQuantity: line.requiredQuantity.toString(),
      })),
    })),
    lines,
  };
}
function assertRecipeEntry(
  row: Awaited<ReturnType<typeof recipes.entries>>[number],
  role: string,
  schoolId: string,
) {
  if (
    row.schoolId !== schoolId ||
    row.status !== "ACTIVE" ||
    row.Ingredient.status !== "ACTIVE"
  )
    throw new HttpError(
      422,
      "Nguyên liệu không còn hoạt động hoặc không thuộc trường",
    );
  if (role === "SEASONING" && row.handlingType !== "DRY_STOCK")
    throw new HttpError(422, "Gia vị phải được chọn từ đồ lưu kho của trường");
  if (
    role === "MAIN" &&
    (row.Ingredient.Supplier.status !== "ACTIVE" ||
      !row.Ingredient.Supplier.schoolSupplierRelationships.length)
  )
    throw new HttpError(
      422,
      "Nguyên liệu chính phải từ nhà cung cấp đang liên kết với trường",
    );
}
export function aggregateDishRecipes(rows: RecipeRows) {
  const seasonings = new Map<
    string,
    {
      ingredientEntryId: string;
      name: string;
      quantityPerPortion: string;
      unit: string;
    }
  >();
  const dishes = rows.map((d) => {
    if (
      !d.dishIngredientEntries.length ||
      d.dishIngredientEntries.some(
        (r) => !["MAIN", "SEASONING"].includes(r.ingredientRole ?? ""),
      )
    )
      throw new HttpError(422, `Món “${d.name}”: công thức chưa đầy đủ.`);
    const ingredients: {
      ingredientId: string;
      quantityPerPortion: string;
      unit: string;
    }[] = [];
    for (const r of d.dishIngredientEntries) {
      const unit = r.IngredientEntry.Ingredient.defaultUnit;
      const q = convertQuantity(r.requiredQuantity, r.unit, unit);
      if (!q.gt(0)) throw new HttpError(422, "Định lượng công thức phải dương");
      if (r.ingredientRole === "MAIN")
        ingredients.push({
          ingredientId: r.IngredientEntry.ingredientId,
          quantityPerPortion: r.requiredQuantity.toString(),
          unit: r.unit,
        });
      else {
        // Cộng gia vị theo đơn vị của dòng công thức (g/ml) thay vì đơn vị kho (kg/lít):
        // định lượng đã nhân tỉ lệ như 1.6 g sẽ thành 0.0016 kg, vượt 3 chữ số lưu trữ.
        // Bếp luôn quy đổi theo `unit` lưu cùng định mức gia vị.
        const old = seasonings.get(r.ingredientEntryId);
        const seasoningUnit = old?.unit ?? r.unit;
        const total = convertQuantity(
          r.requiredQuantity,
          r.unit,
          seasoningUnit,
        ).add(old?.quantityPerPortion ?? 0);
        if (total.decimalPlaces() > 3 || total.gte("100000000000"))
          throw new HttpError(422, "Lượng gia vị quá lẻ. Kiểm tra đơn vị.");
        seasonings.set(r.ingredientEntryId, {
          ingredientEntryId: r.ingredientEntryId,
          name: r.IngredientEntry.Ingredient.name,
          quantityPerPortion: total.toString(),
          unit: seasoningUnit,
        });
      }
    }
    if (!ingredients.length)
      throw new HttpError(422, "Công thức món phải có nguyên liệu chính");
    return { dishId: d.id, ingredients };
  });
  return {
    dishes,
    seasonings: [...seasonings.values()],
    ingredientIds: [
      ...new Set(
        rows.flatMap((d) =>
          d.dishIngredientEntries.map((r) => r.IngredientEntry.ingredientId),
        ),
      ),
    ],
  };
}
export function selectDishGradeRecipes(
  rows: RecipeRows,
  gradeIds: readonly string[],
): RecipeRows {
  return rows.map((dish) => {
    // Thực đơn toàn trường dùng đúng mốc chuẩn (tỉ lệ 1).
    const portions = gradeIds.length
      ? gradeIds.map((gradeId) => {
          const portion = dish.gradeRecipes.find(
            (row) => row.gradeId === gradeId,
          )?.portionQuantity;
          if (portion === undefined)
            throw new HttpError(
              422,
              `Món “${dish.name}” thiếu khẩu phần của khối đã chọn.`,
            );
          return portion;
        })
      : [dish.standardQuantity];
    const scaled = portions.map((portion) =>
      scaleDishLines(
        dish.standardQuantity,
        portion,
        dish.dishIngredientEntries,
      ),
    );
    const canonical = (lines: (typeof scaled)[number]) =>
      JSON.stringify(
        lines
          .map((line) => ({
            id: line.ingredientEntryId,
            role: line.ingredientRole,
            quantity: convertQuantity(
              line.requiredQuantity,
              line.unit,
              line.IngredientEntry.Ingredient.defaultUnit,
            ).toString(),
            unit: line.IngredientEntry.Ingredient.defaultUnit,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    if (scaled.some((lines) => canonical(lines) !== canonical(scaled[0])))
      throw new HttpError(
        422,
        `Món “${dish.name}” khác định lượng giữa các khối. Hãy tách thực đơn.`,
      );
    const tooSmall = scaled[0].find((line) => !line.requiredQuantity.gt(0));
    if (tooSmall)
      throw new HttpError(
        422,
        `Lượng “${tooSmall.IngredientEntry.Ingredient.name}” trong món “${dish.name}” quá nhỏ. Kiểm tra khẩu phần.`,
      );
    return { ...dish, dishIngredientEntries: scaled[0] };
  });
}

export async function readDatabaseMealRecipe(
  tx: RecipePrisma.TransactionClient,
  schoolId: string,
  ids: string[],
  gradeIds: readonly string[] = [],
) {
  let rows = await recipes.recipes(tx, schoolId, ids);
  if (rows.length !== ids.length || new Set(ids).size !== ids.length)
    throw new HttpError(422, "Món bị trùng hoặc không còn dùng.");
  rows = selectDishGradeRecipes(rows, gradeIds);
  const entries = await recipes.entries(tx, schoolId, [
    ...new Set(
      rows.flatMap((d) =>
        d.dishIngredientEntries.map((r) => r.ingredientEntryId),
      ),
    ),
  ]);
  for (const dish of rows)
    for (const line of dish.dishIngredientEntries) {
      const entry = entries.find((e) => e.id === line.ingredientEntryId);
      if (!entry)
        throw new HttpError(
          422,
          "Công thức chứa nguyên liệu không còn hoạt động trong trường",
        );
      assertRecipeEntry(entry, line.ingredientRole ?? "", schoolId);
    }
  return aggregateDishRecipes(ids.map((id) => rows.find((d) => d.id === id)!));
}
/** Tên món không phân biệt hoa thường phải chưa có trong trường (trừ chính món đang sửa). */
export function assertDishNameFree(
  found: { id: string; status: string } | null,
  id?: string,
) {
  if (!found || found.id === id) return;
  throw new HttpError(
    409,
    found.status === "ACTIVE"
      ? DUPLICATE_DISH_NAME
      : "Tên món trùng với món đã ngừng dùng. Đặt tên khác.",
  );
}

export function createDishRecipeService(
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    async listCategories(principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "menu.view",
        async (tx, _actor, schoolId) =>
          (await recipes.categories(tx, schoolId)).map((item) => ({
            key: item.id,
            label: item.name,
          })),
      );
    },
    async writeCategory(
      id: string | undefined,
      name: string,
      principal: AuthPrincipal,
    ) {
      return withSchoolTransaction(
        await connect(),
        principal,
        id ? "menu.update" : "menu.create",
        async (tx, _actor, schoolId) => {
          if (id && !(await recipes.category(tx, schoolId, id)))
            throw new HttpError(404, "Không tìm thấy nhóm món của trường");
          const duplicate = await recipes.categoryByName(tx, schoolId, name);
          if (duplicate && duplicate.id !== id)
            throw new HttpError(409, "Tên nhóm món đã tồn tại");
          const item = id
            ? await recipes.updateCategory(tx, id, name)
            : await recipes.createCategory(tx, schoolId, name);
          return { key: item.id, label: item.name };
        },
      );
    },
    async removeCategory(id: string, principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const item = await recipes.category(tx, schoolId, id);
          if (!item)
            throw new HttpError(404, "Không tìm thấy nhóm món của trường");
          if (item._count.dishes)
            throw new HttpError(
              409,
              "Nhóm còn món. Hãy chuyển món trước khi xóa.",
            );
          await recipes.deleteCategory(tx, id);
          return { id };
        },
      );
    },
    async remove(id: string, principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "menu.update",
        async (tx, _actor, schoolId) => {
          const dish = await recipes.removable(tx, schoolId, id);
          if (!dish) throw new HttpError(404, "Không tìm thấy món của trường");
          if (Object.values(dish._count).some((count) => count > 0))
            throw new HttpError(409, "Món đã được dùng, không xóa được.");
          return recipes.remove(tx, id);
        },
      );
    },
    async catalog(query: ListQuery, principal: AuthPrincipal) {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        "menu.view",
        async (tx, _actor, schoolId) => ({
          categories: (await recipes.categories(tx, schoolId)).map((item) => ({
            key: item.id,
            label: item.name,
          })),
          items: (
            await recipes.catalog(
              tx,
              schoolId,
              (query.page - 1) * query.limit,
              query.limit,
            )
          ).map(recipeDTO),
        }),
      );
    },
    async options(principal: AuthPrincipal) {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        "menu.view",
        async (tx, _actor, schoolId) => {
          const entries = await recipes.entries(tx, schoolId);
          return {
            items: entries.map((e) => ({
              id: e.id,
              ingredientId: e.ingredientId,
              name: e.Ingredient.name,
              category: e.Ingredient.ingredientCategory?.categoryName ?? null,
              categoryId: e.Ingredient.categoryId ?? null,
              defaultUnit: e.Ingredient.defaultUnit,
              supplierId: e.Ingredient.supplierId,
              supplierName: e.Ingredient.Supplier.name,
              handlingType: e.handlingType,
              mainAllowed:
                e.Ingredient.Supplier.status === "ACTIVE" &&
                e.Ingredient.Supplier.schoolSupplierRelationships.length > 0,
              seasoningAllowed: e.handlingType === "DRY_STOCK",
            })),
          };
        },
      );
    },
    async preview(
      ids: string[],
      principal: AuthPrincipal,
      gradeIds: readonly string[] = [],
    ) {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        "menu.view",
        (tx, _actor, schoolId) =>
          readDatabaseMealRecipe(tx, schoolId, ids, gradeIds),
      );
    },
    async save(
      id: string | undefined,
      input: DishRecipeWrite,
      principal: AuthPrincipal,
    ) {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        id ? "menu.update" : "menu.create",
        async (tx, _actor, schoolId) => {
          assertDishNameFree(
            await recipes.dishByName(tx, schoolId, input.name),
            id,
          );
          let categoryId: string | null | undefined = input.category;
          if (categoryId) {
            const legacy = dishCategoryOptions.find(
              (item) => item.key === categoryId,
            );
            const category = legacy
              ? await recipes.categoryByName(tx, schoolId, legacy.label)
              : await recipes.category(tx, schoolId, categoryId);
            if (!category)
              throw new HttpError(422, "Nhóm món không thuộc trường");
            categoryId = category.id;
          }
          const allLines = input.lines;
          // Mỗi khối phải ra định lượng > 0 cho mọi dòng sau khi nhân tỉ lệ và làm tròn.
          for (const profile of input.gradeRecipes ?? []) {
            const scaled = scaleDishLines(
              input.standardQuantity,
              profile.portionQuantity,
              input.lines,
            );
            if (scaled.some((line) => !line.requiredQuantity.gt(0)))
              throw new HttpError(422, "Khẩu phần quá nhỏ. Kiểm tra lại.");
          }
          if (input.gradeRecipes?.length) {
            const grades = await recipes.grades(
              tx,
              schoolId,
              input.gradeRecipes.map((profile) => profile.gradeId),
            );
            if (grades.length !== input.gradeRecipes.length)
              throw new HttpError(
                422,
                "Khối không thuộc trường đang đăng nhập",
              );
          }
          const entryIds = [
            ...new Set(allLines.map((line) => line.ingredientEntryId)),
          ];
          const entries = await recipes.entries(tx, schoolId, entryIds);
          if (entries.length !== entryIds.length)
            throw new HttpError(
              422,
              "Nguyên liệu phải thuộc kho trường và đang hoạt động",
            );
          const previous = id
            ? (await recipes.recipes(tx, schoolId, [id]))[0]
            : undefined;
          for (const line of input.lines) {
            await resolveMeasurementUnit(
              tx,
              line.unit,
              (previous?.dishIngredientEntries ?? []).some(
                (old) =>
                  old.ingredientEntryId === line.ingredientEntryId &&
                  old.unit === line.unit,
              ),
            );
          }
          for (const line of allLines) {
            const entry = entries.find((e) => e.id === line.ingredientEntryId)!;
            assertRecipeEntry(entry, line.ingredientRole, schoolId);
            convertQuantity(
              new RecipePrisma.Decimal(line.requiredQuantity),
              line.unit,
              entry.Ingredient.defaultUnit,
            );
          }
          const row = await recipes.save(
            tx,
            schoolId,
            id,
            input.name,
            input.description ?? null,
            { quantity: input.standardQuantity, unit: input.standardUnit },
            categoryId,
            input.lines,
            input.mealType,
          );
          if (!row) throw new HttpError(404, "Không tìm thấy món của trường");
          if (input.gradeRecipes) {
            await recipes.saveGradeRecipes(
              tx,
              schoolId,
              row.id,
              input.gradeRecipes,
            );
            return recipeDTO(
              (await recipes.recipes(tx, schoolId, [row.id]))[0],
            );
          }
          return recipeDTO(row);
        },
      );
    },
  };
}
export const dishRecipeService = createDishRecipeService();
