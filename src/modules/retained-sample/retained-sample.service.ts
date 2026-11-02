import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import type {
  FoodSampleInput,
  SampleDisposalInput,
} from "./retained-sample.validation";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  cookingBatchId: true,
  recordedByUserId: true,
  sampledAt: true,
  quantity: true,
  unit: true,
  storageLocation: true,
  status: true,
  disposedAt: true,
  disposalNote: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.RetainedFoodSampleSelect;

type ListRow = Prisma.RetainedFoodSampleGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.RetainedFoodSampleFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.retainedFoodSample.findMany(args);
};

export function createRetainedSampleService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  const dto = (row: ListRow) => ({
    ...row,
    quantity: row.quantity?.toString() ?? null,
    expiresAt: new Date(row.sampledAt.getTime() + 24 * 3600000),
  });
  return {
    async forBatch(cookingBatchId: string, principal: AuthPrincipal) {
      assertPermission(principal, "retained_sample.view");
      const db = await connect();
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "Cần phạm vi trường");
      if (
        !(await db.cookingBatch.findFirst({
          where: {
            id: cookingBatchId,
            MenuDay: { WeeklyMenu: { schoolId: principal.schoolId } },
          },
          select: { id: true },
        }))
      )
        throw new HttpError(404, "Không tìm thấy mẻ trong trường");
      const sample = await db.retainedFoodSample.findUnique({
        where: { cookingBatchId },
        select,
      });
      return sample ? dto(sample) : null;
    },
    async create(
      cookingBatchId: string,
      input: FoodSampleInput,
      principal: AuthPrincipal,
    ) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "retained_sample.create",
        async (tx, actor, schoolId) => {
          const batch = await tx.cookingBatch.findFirst({
            where: {
              id: cookingBatchId,
              MenuDay: { WeeklyMenu: { schoolId } },
            },
            select: { id: true, status: true, completedAt: true },
          });
          if (!batch)
            throw new HttpError(404, "Không tìm thấy mẻ trong trường");
          if (batch.status !== "COMPLETED" || !batch.completedAt)
            throw new HttpError(409, "Chỉ lưu mẫu cho mẻ đã hoàn thành");
          const existing = await tx.retainedFoodSample.findUnique({
            where: { cookingBatchId },
            select,
          });
          if (existing) {
            if (
              existing.quantity?.toString() !==
                String(Number(input.quantity)) ||
              existing.unit !== input.unit ||
              existing.storageLocation !== input.storageLocation ||
              +existing.sampledAt !== +input.sampledAt
            )
              throw new HttpError(
                409,
                "Mẻ đã có mẫu lưu; không ghi đè thông tin mẫu",
              );
            return { ...dto(existing), created: false };
          }
          if (
            +input.sampledAt < +batch.completedAt ||
            +input.sampledAt > Date.now()
          )
            throw new HttpError(
              422,
              "Thời điểm lấy mẫu phải từ lúc hoàn thành mẻ đến hiện tại",
            );
          return {
            ...dto(
              await tx.retainedFoodSample.create({
                data: { cookingBatchId, recordedByUserId: actor.id, ...input },
                select,
              }),
            ),
            created: true,
          };
        },
      );
    },
    async dispose(
      id: string,
      input: SampleDisposalInput,
      principal: AuthPrincipal,
    ) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "retained_sample.dispose",
        async (tx, _actor, schoolId) => {
          const sample = await tx.retainedFoodSample.findFirst({
            where: {
              id,
              CookingBatch: { MenuDay: { WeeklyMenu: { schoolId } } },
            },
            select,
          });
          if (!sample)
            throw new HttpError(404, "Không tìm thấy mẫu lưu của trường");
          if (sample.status === "DISPOSED") {
            if (
              Number(sample.disposedAt) !== +input.disposedAt ||
              sample.disposalNote !== input.disposalNote
            )
              throw new HttpError(409, "Mẫu đã tiêu hủy; không ghi đè lịch sử");
            return dto(sample);
          }
          const expires = +sample.sampledAt + 24 * 3600000,
            now = Date.now();
          if (
            now < expires ||
            +input.disposedAt < expires ||
            +input.disposedAt > now
          )
            throw new HttpError(
              422,
              "Chỉ tiêu hủy mẫu sau ít nhất 24 giờ lưu thực tế",
            );
          const hold = await tx.foodSafetyIncident.findFirst({
            where: {
              schoolId,
              status: { in: ["OPEN", "INVESTIGATING"] },
              OR: [
                { foodAnalysisResults: { some: { retainedFoodSampleId: id } } },
                {
                  foodSafetyIncidentAllocations: {
                    some: {
                      MealAllocation: {
                        mealAllocationBatches: {
                          some: { cookingBatchId: sample.cookingBatchId },
                        },
                      },
                    },
                  },
                },
              ],
            },
            select: { id: true },
          });
          if (hold)
            throw new HttpError(
              409,
              "Mẫu liên quan sự cố ATTP chưa kết thúc; cần tiếp tục bảo quản",
            );
          return dto(
            await tx.retainedFoodSample.update({
              where: { id },
              data: { status: "DISPOSED", ...input },
              select,
            }),
          );
        },
      );
    },
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["retained-sample"](principal);
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

export const retainedSampleService = createRetainedSampleService();
export type RetainedSampleService = ReturnType<
  typeof createRetainedSampleService
>;
