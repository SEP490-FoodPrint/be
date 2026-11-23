import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import {
  ingredientEntryRepository as repository,
  type WasteRateRow,
} from "./ingredient-entry.repository";
import type {
  IngredientWasteRateParamsRequest,
  IngredientWasteRateUpdateRequest,
} from "./ingredient-entry.request.dto";
import type {
  IngredientWasteRateDTO,
  IngredientWasteRateListResponseDTO,
} from "./ingredient-entry.response.dto";

const WASTE_RATE_PERMISSION = "ingredient_waste_rate.manage";

const select = {
  id: true,
  schoolId: true,
  ingredientId: true,
  shelfLifeDays: true,
  handlingType: true,
  wasteRate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.IngredientEntrySelect;

type ListRow = Prisma.IngredientEntryGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.IngredientEntryFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.ingredientEntry.findMany(args);
};

function toWasteRateDto(row: WasteRateRow): IngredientWasteRateDTO {
  return {
    id: row.id,
    ingredientId: row.ingredientId,
    ingredientName: row.Ingredient.name,
    unit: row.Ingredient.defaultUnit,
    handlingType: row.handlingType,
    wasteRate: row.wasteRate.toFixed(4),
  };
}

function requireSchoolScope(principal: AuthPrincipal): string {
  assertPermission(principal, WASTE_RATE_PERMISSION);
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Thao tác yêu cầu phạm vi trường đã xác thực");
  return principal.schoolId;
}

export function createIngredientEntryService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["ingredient-entry"](principal);
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

    /** Danh mục nguyên liệu đang dùng của trường kèm tỷ lệ hao hụt (màn cấu hình của bếp). */
    async listWasteRates(
      principal: AuthPrincipal,
    ): Promise<IngredientWasteRateListResponseDTO> {
      const schoolId = requireSchoolScope(principal);
      const rows = await withReadTransaction(
        (tx) => repository.listWasteRates(tx, schoolId),
        connect,
      );
      return { items: rows.map(toWasteRateDto) };
    },

    /** Cập nhật tỷ lệ hao hụt; không lưu lịch sử thay đổi. */
    async updateWasteRate(
      params: IngredientWasteRateParamsRequest,
      input: IngredientWasteRateUpdateRequest,
      principal: AuthPrincipal,
    ): Promise<IngredientWasteRateDTO> {
      requireSchoolScope(principal);
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        WASTE_RATE_PERMISSION,
        async (tx, _actor, schoolId) => {
          const entry = await repository.findActiveInSchool(
            tx,
            params.ingredientEntryId,
            schoolId,
          );
          if (!entry)
            throw new HttpError(
              404,
              "Không tìm thấy nguyên liệu trong danh mục của trường",
            );
          return toWasteRateDto(
            await repository.updateWasteRate(tx, entry.id, input.wasteRate),
          );
        },
      );
    },
  };
}

export const ingredientEntryService = createIngredientEntryService();
export type IngredientEntryService = ReturnType<
  typeof createIngredientEntryService
>;
