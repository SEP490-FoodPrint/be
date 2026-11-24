import type { Prisma } from "../../generated/prisma/client";

type Db = Prisma.TransactionClient;

export const wasteRateSelect = {
  id: true,
  ingredientId: true,
  handlingType: true,
  wasteRate: true,
  Ingredient: { select: { name: true, defaultUnit: true } },
} as const satisfies Prisma.IngredientEntrySelect;

export type WasteRateRow = Prisma.IngredientEntryGetPayload<{
  select: typeof wasteRateSelect;
}>;

export const ingredientEntryRepository = {
  listWasteRates(db: Db, schoolId: string) {
    return db.ingredientEntry.findMany({
      where: { schoolId, status: "ACTIVE" },
      select: wasteRateSelect,
      orderBy: [{ Ingredient: { name: "asc" } }, { id: "asc" }],
    });
  },
  findActiveInSchool(db: Db, id: string, schoolId: string) {
    return db.ingredientEntry.findFirst({
      where: { id, schoolId, status: "ACTIVE" },
      select: { id: true },
    });
  },
  updateWasteRate(db: Db, id: string, wasteRate: string) {
    return db.ingredientEntry.update({
      where: { id },
      data: { wasteRate },
      select: wasteRateSelect,
    });
  },
};
