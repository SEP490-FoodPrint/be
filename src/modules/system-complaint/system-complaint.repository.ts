import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { SystemComplaintCategory } from "../complaint-ticket/complaint-ticket.lifecycle";
import {
  latestCommentSideSelect,
  ticketCommentsArgs,
} from "../complaint-ticket/complaint-ticket.repository";

type Db = PrismaClient | Prisma.TransactionClient;

export interface SystemComplaintListFilter {
  page: number;
  limit: number;
  status?: "NEW" | "IN_PROGRESS" | "REOPENED" | "RESOLVED" | "CLOSED";
  category?: SystemComplaintCategory;
  from?: string;
  to?: string;
  search?: string;
}

const organizationSelect = { select: { id: true, name: true } } as const;

export const systemComplaintSelect = {
  id: true,
  code: true,
  title: true,
  description: true,
  status: true,
  senderUserId: true,
  lastResolvedAt: true,
  resolvedCount: true,
  closeReason: true,
  closedAt: true,
  submittedAt: true,
  updatedAt: true,
  senderUser: { select: { id: true, fullName: true } },
  senderRole: { select: { code: true, name: true } },
  senderSchool: organizationSelect,
  senderSupplier: organizationSelect,
  senderCommuneFoodSafetyUnit: organizationSelect,
  systemComplaint: { select: { category: true } },
  comments: latestCommentSideSelect,
} as const satisfies Prisma.ComplaintSelect;
export type SystemComplaintRow = Prisma.ComplaintGetPayload<{
  select: typeof systemComplaintSelect;
}>;

const systemComplaintDetailSelect = {
  ...systemComplaintSelect,
  comments: ticketCommentsArgs,
} as const satisfies Prisma.ComplaintSelect;
export type SystemComplaintDetailRow = Prisma.ComplaintGetPayload<{
  select: typeof systemComplaintDetailSelect;
}>;

const ticketTargetSelect = {
  id: true,
  status: true,
  senderUserId: true,
  lastResolvedAt: true,
} as const satisfies Prisma.ComplaintSelect;
export type SystemComplaintTicketTarget = Prisma.ComplaintGetPayload<{
  select: typeof ticketTargetSelect;
}>;

/** Phạm vi do service cấp luôn được AND với `kind = SYSTEM` để không đọc xuyên luồng khác. */
function scoped(
  scope: Prisma.ComplaintWhereInput,
  ...filters: Prisma.ComplaintWhereInput[]
): Prisma.ComplaintWhereInput {
  return { AND: [scope, { kind: "SYSTEM" }, ...filters] };
}

export function createSystemComplaintRepository() {
  return {
    list(
      db: Db,
      scope: Prisma.ComplaintWhereInput,
      query: SystemComplaintListFilter,
    ) {
      const from = query.from
        ? new Date(`${query.from}T00:00:00.000Z`)
        : undefined;
      const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const where = scoped(
        scope,
        query.status ? { status: query.status } : {},
        query.category
          ? { systemComplaint: { is: { category: query.category } } }
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
              ],
            }
          : {},
      );
      return db.complaint.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit + 1,
        select: systemComplaintSelect,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      });
    },
    findOne(
      db: Db,
      scope: Prisma.ComplaintWhereInput,
      id: string,
    ): Promise<SystemComplaintDetailRow | null> {
      return db.complaint.findFirst({
        where: scoped(scope, { id }),
        select: systemComplaintDetailSelect,
      });
    },
    findTicketTarget(
      tx: Prisma.TransactionClient,
      scope: Prisma.ComplaintWhereInput,
      id: string,
    ): Promise<SystemComplaintTicketTarget | null> {
      return tx.complaint.findFirst({
        where: scoped(scope, { id }),
        select: ticketTargetSelect,
      });
    },
    /** Tạo bản ghi cha `complaints` + bản ghi con `system_complaints` trong cùng lệnh. */
    create(
      tx: Prisma.TransactionClient,
      data: {
        code: string;
        title: string;
        description: string;
        category: SystemComplaintCategory;
        senderUserId: string;
        senderRoleCode: string;
        senderSchoolId: string | null;
        senderSupplierId: string | null;
        senderCommuneFoodSafetyUnitId: string | null;
      },
    ) {
      return tx.complaint.create({
        data: {
          kind: "SYSTEM",
          code: data.code,
          title: data.title,
          description: data.description,
          senderUserId: data.senderUserId,
          senderRoleCode: data.senderRoleCode,
          senderSchoolId: data.senderSchoolId,
          senderSupplierId: data.senderSupplierId,
          senderCommuneFoodSafetyUnitId: data.senderCommuneFoodSafetyUnitId,
          status: "NEW",
          systemComplaint: { create: { category: data.category } },
        },
        select: { id: true },
      });
    },
  };
}

export type SystemComplaintRepository = ReturnType<
  typeof createSystemComplaintRepository
>;
