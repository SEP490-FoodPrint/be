import type { Prisma } from "../../generated/prisma/client";
import type { IngredientManagementScope } from "../../utils/resource-access";
import { getPrisma } from "../../utils/database";
import { loadPrincipal } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { listWindow, type ListQuery } from "../../utils/list-query";

type Tx = Prisma.TransactionClient;
export const ingredientCategorySelect = {
  id: true,
  categoryName: true,
  categoryDescription: true,
} as const;
export const ingredientSupplierSelect = {
  id: true,
  name: true,
} as const;
export const ingredientLegacySelect = {
  id: true,
  supplierId: true,
  name: true,
  defaultUnit: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  ingredientCategory: { select: ingredientCategorySelect },
  Supplier: { select: ingredientSupplierSelect },
} as const satisfies Prisma.IngredientSelect;
const select = {
  ...ingredientLegacySelect,
  description: true,
  categoryId: true,
  coverImage: true,
  imageDescription: true,
} as const satisfies Prisma.IngredientSelect;
export type IngredientRow = Prisma.IngredientGetPayload<{
  select: typeof select;
}>;
export type IngredientCategoryRow = Prisma.IngredientCategoryGetPayload<{
  select: typeof ingredientCategorySelect;
}>;
export type LegacyIngredientRow = Prisma.IngredientGetPayload<{
  select: typeof ingredientLegacySelect;
}>;
interface Editable {
  name?: string;
  defaultUnit?: string;
  description?: string | null;
  categoryId?: string | null;
  coverImage?: string | null;
  imageDescription?: string[];
}
type CreateInput = Editable & { name: string; defaultUnit: string };
export function ingredientWriteError(error: unknown): never {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "P2002")
      throw new HttpError(409, "Tên nguyên liệu đã tồn tại trong nhà cung cấp");
    if (error.code === "P2003")
      throw new HttpError(400, "Danh mục nguyên liệu không hợp lệ");
  }
  throw error;
}
export function createIngredientRepository(connect = getPrisma) {
  return {
    async listLegacy(
      scope: Prisma.IngredientWhereInput,
      query: ListQuery,
    ): Promise<LegacyIngredientRow[]> {
      return (await connect()).ingredient.findMany({
        where: scope,
        select: ingredientLegacySelect,
        ...listWindow(query),
        orderBy: { id: "asc" },
      });
    },
    actor(id: string, tx: Tx) {
      return loadPrincipal(id, tx);
    },
    async supplierStatus(scope: IngredientManagementScope, tx?: Tx) {
      const db = tx ?? (await connect());
      return db.supplier.findUnique({
        where: { id: scope.supplierId },
        select: { status: true },
      });
    },
    async lockSupplier(scope: IngredientManagementScope, tx: Tx) {
      await tx.$queryRaw`SELECT id FROM foodprint.suppliers WHERE id = ${scope.supplierId}::uuid FOR UPDATE`;
    },
    async lockTarget(scope: IngredientManagementScope, id: string, tx: Tx) {
      await tx.$queryRaw`SELECT id FROM foodprint.ingredients WHERE id = ${id}::uuid AND supplier_id = ${scope.supplierId}::uuid FOR UPDATE`;
    },
    async find(
      scope: IngredientManagementScope,
      id: string,
      tx?: Tx,
    ): Promise<IngredientRow | null> {
      return (tx ?? (await connect())).ingredient.findFirst({
        where: { id, supplierId: scope.supplierId },
        select,
      });
    },
    async list(
      scope: IngredientManagementScope,
      query: ListQuery,
    ): Promise<IngredientRow[]> {
      return (await connect()).ingredient.findMany({
        where: { supplierId: scope.supplierId },
        select,
        ...listWindow(query),
        orderBy: { id: "asc" },
      });
    },
    async categories(
      _scope: IngredientManagementScope,
      query: ListQuery,
    ): Promise<IngredientCategoryRow[]> {
      return (await connect()).ingredientCategory.findMany({
        select: ingredientCategorySelect,
        ...listWindow(query),
        orderBy: { id: "asc" },
      });
    },
    async categoryExists(id: string, tx: Tx) {
      return Boolean(
        await tx.ingredientCategory.findUnique({
          where: { id },
          select: { id: true },
        }),
      );
    },
    async create(
      scope: IngredientManagementScope,
      input: CreateInput,
      tx: Tx,
    ): Promise<IngredientRow> {
      try {
        return await tx.ingredient.create({
          data: { ...input, supplierId: scope.supplierId, status: "ACTIVE" },
          select,
        });
      } catch (error) {
        return ingredientWriteError(error);
      }
    },
    async update(
      scope: IngredientManagementScope,
      id: string,
      input: Editable,
      tx: Tx,
    ): Promise<IngredientRow | null> {
      try {
        const result = await tx.ingredient.updateMany({
          where: { id, supplierId: scope.supplierId },
          data: input,
        });
        return result.count ? this.find(scope, id, tx) : null;
      } catch (error) {
        return ingredientWriteError(error);
      }
    },
    async hide(
      scope: IngredientManagementScope,
      id: string,
      tx: Tx,
    ): Promise<IngredientRow | null> {
      await tx.ingredient.updateMany({
        where: { id, supplierId: scope.supplierId, status: "ACTIVE" },
        data: { status: "INACTIVE" },
      });
      return this.find(scope, id, tx);
    },
  };
}
export type IngredientRepository = ReturnType<
  typeof createIngredientRepository
>;
export const ingredientRepository = createIngredientRepository();
