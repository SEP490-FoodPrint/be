import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { formatComplaintCode } from "../../utils/complaint-code";
type Db = PrismaClient | Prisma.TransactionClient;

export const complaintInclude = {
  Complaint: {
    select: {
      id: true,
      kind: true,
      complaintCode: true,
      title: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      senderUser: { select: { id: true, fullName: true } },
      currentResponseVersion: {
        select: {
          id: true,
          version: true,
          content: true,
          createdAt: true,
          respondedByUser: { select: { id: true, fullName: true } },
        },
      },
    },
  },
  DailyMealPortion: {
    select: {
      id: true,
      mealDate: true,
      mealType: true,
      Class: { select: { id: true, name: true, academicYear: true } },
      MealAllocation: { select: { id: true, status: true } },
    },
  },
} as const satisfies Prisma.MealComplaintInclude;

export type ComplaintRow = Prisma.MealComplaintGetPayload<{
  include: typeof complaintInclude;
}>;

export function createFeedbackRepository() {
  return {
    async nextComplaintCode(tx: Db): Promise<string> {
      const rows = await tx.$queryRaw<{ value: bigint | string | number }[]>`
        SELECT nextval('foodprint.complaint_code_seq'::regclass) AS value
      `;
      const row = rows[0];
      if (!row) {
        throw new Error("Không thể cấp mã khiếu nại từ sequence.");
      }
      const seq =
        typeof row.value === "bigint" ? row.value : BigInt(String(row.value));
      return formatComplaintCode(seq);
    },
    list(
      db: Db,
      scope: Prisma.MealComplaintWhereInput,
      query: import("./feedback.request.dto").ComplaintListQueryDTO,
    ) {
      const from = query.from
        ? new Date(`${query.from}T00:00:00.000Z`)
        : undefined;
      const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const statusFilter: Prisma.MealComplaintWhereInput = query.status
        ? query.status === "RESOLVED"
          ? { Complaint: { status: "RESPONDED" } }
          : { Complaint: { status: query.status } }
        : {};
      const dateFilter: Prisma.MealComplaintWhereInput =
        from || to ? { Complaint: { createdAt: { gte: from, lte: to } } } : {};
      const where: Prisma.MealComplaintWhereInput = {
        AND: [
          scope,
          statusFilter,
          query.complaintType ? { complaintType: query.complaintType } : {},
          dateFilter,
          query.search
            ? {
                OR: [
                  {
                    Complaint: {
                      description: {
                        contains: query.search,
                        mode: "insensitive",
                      },
                    },
                  },
                  {
                    Complaint: {
                      senderUser: {
                        fullName: {
                          contains: query.search,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                  {
                    DailyMealPortion: {
                      Class: {
                        name: { contains: query.search, mode: "insensitive" },
                      },
                    },
                  },
                ],
              }
            : {},
        ],
      };
      const skip = (query.page - 1) * query.limit;
      const take = query.limit + 1;
      return db.mealComplaint.findMany({
        where,
        skip,
        take,
        include: complaintInclude,
        orderBy: [{ Complaint: { createdAt: "desc" } }, { id: "desc" }],
      });
    },
    findOne(db: Db, scope: Prisma.MealComplaintWhereInput, id: string) {
      return db.mealComplaint.findFirst({
        where: { AND: [scope, { id }] },
        include: complaintInclude,
      });
    },
    findMealOptions(
      db: Db,
      schoolId: string,
      mealDate: Date,
      teacher?: { id: string; academicYear: string; now: Date },
    ) {
      return db.class.findMany({
        where: {
          schoolId,
          status: "ACTIVE",
          ...(teacher && {
            academicYear: teacher.academicYear,
            homeroomAssignments: {
              some: {
                teacherUserId: teacher.id,
                assignedAt: { lte: teacher.now },
                OR: [{ endedAt: null }, { endedAt: { gt: teacher.now } }],
              },
            },
          }),
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: teacher ? 2 : undefined,
        select: {
          id: true,
          name: true,
          dailyMealPortions: {
            where: { mealDate, mealType: { in: ["LUNCH", "AFTERNOON"] } },
            select: {
              id: true,
              mealType: true,
              MealAllocation: { select: { status: true } },
            },
          },
        },
      });
    },
    async create(
      db: Db,
      data: {
        dailyMealPortionId: string;
        submittedByUserId: string;
        senderRoleCode: string;
        schoolId: string;
        complaintType: CreateDataType;
        description: string;
      },
    ) {
      const complaintCode = await this.nextComplaintCode(db);
      const titleMap: Record<CreateDataType, string> = {
        MEAL_QUALITY: "Phản ánh chất lượng món ăn",
        FOOD_HYGIENE: "Phản ánh vệ sinh an toàn thực phẩm",
        HEALTH_ISSUE: "Phản ánh vấn đề sức khỏe sau bữa ăn",
        OTHER: "Phản ánh suất ăn",
      };
      const created = await db.complaint.create({
        data: {
          kind: "MEAL",
          complaintCode,
          senderUserId: data.submittedByUserId,
          senderRoleCode: data.senderRoleCode,
          senderSchoolId: data.schoolId,
          title: titleMap[data.complaintType],
          description: data.description,
          status: "SUBMITTED",
          mealComplaint: {
            create: {
              dailyMealPortionId: data.dailyMealPortionId,
              schoolId: data.schoolId,
              complaintType: data.complaintType,
            },
          },
        },
      });
      return db.mealComplaint.findUniqueOrThrow({
        where: { id: created.id },
        include: complaintInclude,
      });
    },
    async updateStatus(
      db: Db,
      id: string,
      data: {
        status: "IN_REVIEW" | "RESOLVED";
        handledByUserId: string;
        handledByRoleCode: string;
        fromStatus?: "SUBMITTED" | "IN_REVIEW";
        resolution?: string;
        resolvedAt?: Date;
      },
    ) {
      if (data.status === "IN_REVIEW") {
        await db.complaint.update({
          where: { id },
          data: { status: "IN_REVIEW" },
        });
        await db.complaintStatusHistory.create({
          data: {
            complaintId: id,
            fromStatus: data.fromStatus || "SUBMITTED",
            toStatus: "IN_REVIEW",
            actorUserId: data.handledByUserId,
            actorRoleCode: data.handledByRoleCode,
          },
        });
      } else {
        const version = await db.complaintResponseVersion.create({
          data: {
            complaintId: id,
            version: 1,
            content: data.resolution || "",
            respondedByUserId: data.handledByUserId,
            respondedRoleCode: data.handledByRoleCode,
            createdAt: data.resolvedAt || new Date(),
          },
        });
        await db.complaint.update({
          where: { id },
          data: {
            status: "RESPONDED",
            currentResponseVersionId: version.id,
          },
        });
        await db.complaintStatusHistory.create({
          data: {
            complaintId: id,
            fromStatus: data.fromStatus || "IN_REVIEW",
            toStatus: "RESPONDED",
            responseVersionId: version.id,
            actorUserId: data.handledByUserId,
            actorRoleCode: data.handledByRoleCode,
            createdAt: data.resolvedAt || new Date(),
          },
        });
      }
      return db.mealComplaint.findUniqueOrThrow({
        where: { id },
        include: complaintInclude,
      });
    },
  };
}
type CreateDataType =
  "MEAL_QUALITY" | "FOOD_HYGIENE" | "HEALTH_ISSUE" | "OTHER";
export type FeedbackRepository = ReturnType<typeof createFeedbackRepository>;
