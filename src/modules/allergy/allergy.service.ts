import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { assertPermission } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { readAllergyCatalog } from "./allergy.repository";
import type { AllergyCatalogQuery } from "./allergy.request.dto";
import type { AllergyCatalogRowDTO } from "./allergy.response.dto";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  classId: true,
  ingredientEntryId: true,
  affectedCount: true,
  updatedByUserId: true,
  updatedAt: true,
} as const satisfies Prisma.ClassAllergySelect;

type ListRow = Prisma.ClassAllergyGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.ClassAllergyFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.classAllergy.findMany(args);
};

export function createAllergyService(read: ListReader = readFromDatabase) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["allergy"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [{ classId: "asc" }, { ingredientEntryId: "asc" }],
          }),
        query,
      );
    },
  };
}

export const allergyService = createAllergyService();
export type AllergyService = ReturnType<typeof createAllergyService>;

export function createAllergyCatalogService(read = readAllergyCatalog) {
  return {
    async getAll(query: AllergyCatalogQuery, principal: AuthPrincipal) {
      assertPermission(principal, "class_allergy.view");
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "Danh mục dị ứng yêu cầu phạm vi trường");
      const schoolId = principal.schoolId;
      const page = await readListPage(
        () => read(schoolId, listWindow(query)),
        query,
      );
      const items: AllergyCatalogRowDTO[] = page.items.map((row) => ({
        classId: row.classId,
        className: row.Class.name,
        academicYear: row.Class.academicYear,
        ingredientEntryId: row.ingredientEntryId,
        ingredientId: row.IngredientEntry.ingredientId,
        ingredientName: row.IngredientEntry.Ingredient.name,
        category:
          row.IngredientEntry.Ingredient.ingredientCategory?.categoryName ??
          null,
        affectedCount: row.affectedCount,
        updatedAt: row.updatedAt.toISOString(),
      }));
      return { items, pagination: page.pagination };
    },
  };
}
export const allergyCatalogService = createAllergyCatalogService();
