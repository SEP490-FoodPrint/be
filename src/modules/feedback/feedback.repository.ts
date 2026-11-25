import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  complaintAttachmentsArgs,
  latestCommentSideSelect,
  ticketCommentsArgs,
} from "../complaint-ticket/complaint-ticket.repository";
import type { ComplaintListQueryDTO } from "./feedback.request.dto";
import type { TicketStatus } from "../complaint-ticket/complaint-ticket.lifecycle";
type Db = PrismaClient | Prisma.TransactionClient;

const mealSelect = {
  schoolId: true,
  complaintType: true,
  DailyMealPortion: {
    select: {
      id: true,
      mealDate: true,
      mealType: true,
      Class: { select: { id: true, name: true, academicYear: true } },
      MealAllocation: { select: { id: true, status: true } },
    },
  },
  authorityEscalation: {
    select: { id: true, Complaint: { select: { code: true } } },
  },
} as const satisfies Prisma.MealComplaintSelect;

export const complaintSelect = {
  id: true,
  code: true,
  title: true,
  description: true,
  status: true,
  senderUserId: true,
  senderRoleCode: true,
  lastResolvedAt: true,
  resolvedCount: true,
  closeReason: true,
  closedAt: true,
  submittedAt: true,
  updatedAt: true,
  senderUser: { select: { id: true, fullName: true } },
  mealComplaint: { select: mealSelect },
  comments: latestCommentSideSelect,
} as const satisfies Prisma.ComplaintSelect;
export type ComplaintRow = Prisma.ComplaintGetPayload<{
  select: typeof complaintSelect;
}>;

const complaintDetailSelect = {
  ...complaintSelect,
  attachments: complaintAttachmentsArgs,
  comments: ticketCommentsArgs,
} as const satisfies Prisma.ComplaintSelect;
export type ComplaintDetailRow = Prisma.ComplaintGetPayload<{
  select: typeof complaintDetailSelect;
}>;

/** Trạng thái hiện tại để kiểm tra thao tác ticket trong transaction. */
const ticketTargetSelect = {
  id: true,
  status: true,
  senderUserId: true,
  lastResolvedAt: true,
} as const satisfies Prisma.ComplaintSelect;
export type ComplaintTicketTarget = Prisma.ComplaintGetPayload<{
  select: typeof ticketTargetSelect;
}>;

function scoped(
  scope: Prisma.ComplaintWhereInput,
  ...filters: Prisma.ComplaintWhereInput[]
): Prisma.ComplaintWhereInput {
  return { AND: [scope, { kind: "MEAL" }, ...filters] };
}

export function createFeedbackRepository() {
  return {
    list(
      db: Db,
      scope: Prisma.ComplaintWhereInput,
      query: ComplaintListQueryDTO,
      statuses?: readonly TicketStatus[],
    ) {
      const from = query.from
        ? new Date(`${query.from}T00:00:00.000Z`)
        : undefined;
      const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const where = scoped(
        scope,
        statuses ? { status: { in: [...statuses] } } : {},
        query.complaintType
          ? { mealComplaint: { is: { complaintType: query.complaintType } } }
          : {},
        from || to ? { submittedAt: { gte: from, lte: to } } : {},
        query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: "insensitive" } },
                {
                  description: { contains: query.search, mode: "insensitive" },
                },
                {
                  senderUser: {
                    fullName: { contains: query.search, mode: "insensitive" },
                  },
                },
                {
                  mealComplaint: {
                    is: {
                      DailyMealPortion: {
                        Class: {
                          name: {
                            contains: query.search,
                            mode: "insensitive",
                          },
                        },
                      },
                    },
                  },
                },
              ],
            }
          : {},
      );
      return db.complaint.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit + 1,
        select: complaintSelect,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      });
    },
    findOne(db: Db, scope: Prisma.ComplaintWhereInput, id: string) {
      return db.complaint.findFirst({
        where: scoped(scope, { id }),
        select: complaintDetailSelect,
      });
    },
    findTicketTarget(
      tx: Prisma.TransactionClient,
      scope: Prisma.ComplaintWhereInput,
      id: string,
    ): Promise<ComplaintTicketTarget | null> {
      return tx.complaint.findFirst({
        where: scoped(scope, { id }),
        select: ticketTargetSelect,
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
    /** Tạo bản ghi cha `complaints` + bản ghi con `meal_complaints` trong cùng lệnh. */
    create(
      tx: Prisma.TransactionClient,
      data: {
        code: string;
        title: string;
        description: string;
        senderUserId: string;
        senderRoleCode: string;
        schoolId: string;
        dailyMealPortionId: string;
        complaintType: MealComplaintTypeValue;
      },
    ) {
      return tx.complaint.create({
        data: {
          kind: "MEAL",
          code: data.code,
          title: data.title,
          description: data.description,
          senderUserId: data.senderUserId,
          senderRoleCode: data.senderRoleCode,
          senderSchoolId: data.schoolId,
          status: "NEW",
          mealComplaint: {
            create: {
              schoolId: data.schoolId,
              dailyMealPortionId: data.dailyMealPortionId,
              complaintType: data.complaintType,
            },
          },
        },
        select: { id: true },
      });
    },
  };
}
type MealComplaintTypeValue = "MEAL_QUALITY" | "FOOD_HYGIENE" | "OTHER";
export type FeedbackRepository = ReturnType<typeof createFeedbackRepository>;
