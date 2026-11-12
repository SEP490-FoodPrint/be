import type { AuthPrincipal } from "../../types/auth";
import { Prisma as RecipePrisma } from "../../generated/prisma/client";
import { withSchoolTransaction } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../kitchen/kitchen.service";
import { dishRecipeRepository as recipes } from "./dish.repository";
import type { DishRecipeWrite } from "./dish.request.dto";
import type { DishRecipeDTO } from "./dish.response.dto";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
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
function recipeDTO(row: RecipeRows[number]): DishRecipeDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    lines: row.dishIngredientEntries.map((r) => ({
      ingredientEntryId: r.ingredientEntryId,
      ingredientId: r.IngredientEntry.ingredientId,
      name: r.IngredientEntry.Ingredient.name,
      ingredientRole: r.ingredientRole,
      requiredQuantity: r.requiredQuantity.toString(),
      unit: r.unit,
    })),
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
    throw new HttpError(422, "Gia vị phải được chọn từ kho khô của trường");
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
      throw new HttpError(
        422,
        `Công thức món “${d.name}” thiếu định lượng hoặc chưa phân loại nguyên liệu/gia vị`,
      );
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
        const old = seasonings.get(r.ingredientEntryId);
        const total = q.add(old?.quantityPerPortion ?? 0);
        if (total.decimalPlaces() > 3 || total.gte("100000000000"))
          throw new HttpError(
            422,
            "Tổng gia vị vượt độ chính xác lưu trữ; hãy kiểm tra đơn vị công thức",
          );
        seasonings.set(r.ingredientEntryId, {
          ingredientEntryId: r.ingredientEntryId,
          name: r.IngredientEntry.Ingredient.name,
          quantityPerPortion: total.toString(),
          unit,
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
export async function readDatabaseMealRecipe(
  tx: RecipePrisma.TransactionClient,
  schoolId: string,
  ids: string[],
) {
  const rows = await recipes.recipes(tx, schoolId, ids);
  if (rows.length !== ids.length || new Set(ids).size !== ids.length)
    throw new HttpError(
      422,
      "Món phải đang hoạt động, không trùng và thuộc trường",
    );
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
export const dishRecipeService = {
  async catalog(query: ListQuery, principal: AuthPrincipal) {
    const db = await getPrisma();
    return withSchoolTransaction(
      db,
      principal,
      "menu.view",
      async (tx, _actor, schoolId) => ({
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
    const db = await getPrisma();
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
            defaultUnit: e.Ingredient.defaultUnit,
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
  async preview(ids: string[], principal: AuthPrincipal) {
    const db = await getPrisma();
    return withSchoolTransaction(
      db,
      principal,
      "menu.view",
      (tx, _actor, schoolId) => readDatabaseMealRecipe(tx, schoolId, ids),
    );
  },
  async save(
    id: string | undefined,
    input: DishRecipeWrite,
    principal: AuthPrincipal,
  ) {
    const db = await getPrisma();
    return withSchoolTransaction(
      db,
      principal,
      id ? "menu.update" : "menu.create",
      async (tx, _actor, schoolId) => {
        const entries = await recipes.entries(
          tx,
          schoolId,
          input.lines.map((r) => r.ingredientEntryId),
        );
        if (entries.length !== input.lines.length)
          throw new HttpError(
            422,
            "Nguyên liệu phải thuộc kho trường và đang hoạt động",
          );
        for (const line of input.lines) {
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
          input.lines,
        );
        if (!row) throw new HttpError(404, "Không tìm thấy món của trường");
        return recipeDTO(row);
      },
    );
  },
};
