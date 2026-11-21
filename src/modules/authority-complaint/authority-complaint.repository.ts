import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  latestCommentSideSelect,
  ticketCommentsArgs,
} from "../complaint-ticket/complaint-ticket.repository";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export interface AuthorityComplaintListFilter {
  page: number;
  limit: number;
  status?: "NEW" | "IN_PROGRESS" | "REOPENED" | "RESOLVED" | "CLOSED";
}

const refSelect = { select: { id: true, name: true } } as const;

const ticketFieldsSelect = {
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
} as const satisfies Prisma.ComplaintSelect;

export const authorityComplaintSelect = {
  ...ticketFieldsSelect,
  authorityComplaint: {
    select: {
      recipientCommuneFoodSafetyUnitId: true,
      School: refSelect,
      RecipientUnit: refSelect,
      EscalatedFrom: {
        select: { id: true, Complaint: { select: { code: true } } },
      },
    },
  },
  comments: latestCommentSideSelect,
} as const satisfies Prisma.ComplaintSelect;
export type AuthorityComplaintRow = Prisma.ComplaintGetPayload<{
  select: typeof authorityComplaintSelect;
}>;

const authorityComplaintDetailSelect = {
  ...ticketFieldsSelect,
  authorityComplaint: {
    select: {
      recipientCommuneFoodSafetyUnitId: true,
      School: refSelect,
      RecipientUnit: refSelect,
      EscalatedFrom: {
        select: {
          id: true,
          complaintType: true,
          DailyMealPortion: {
            select: {
              id: true,
              mealDate: true,
              mealType: true,
              Class: refSelect,
            },
          },
          Complaint: {
            select: {
              code: true,
              title: true,
              description: true,
              submittedAt: true,
              comments: ticketCommentsArgs,
            },
          },
        },
      },
    },
  },
  comments: ticketCommentsArgs,
} as const satisfies Prisma.ComplaintSelect;
export type AuthorityComplaintDetailRow = Prisma.ComplaintGetPayload<{
  select: typeof authorityComplaintDetailSelect;
}>;

const ticketTargetSelect = {
  id: true,
  status: true,
  senderUserId: true,
  lastResolvedAt: true,
} as const satisfies Prisma.ComplaintSelect;
export type AuthorityComplaintTicketTarget = Prisma.ComplaintGetPayload<{
  select: typeof ticketTargetSelect;
}>;

const escalationSourceSelect = {
  id: true,
  code: true,
  description: true,
  status: true,
  lastResolvedAt: true,
  senderRoleCode: true,
  mealComplaint: {
    select: { schoolId: true, authorityEscalation: { select: { id: true } } },
  },
} as const satisfies Prisma.ComplaintSelect;
export type EscalationSourceRow = Prisma.ComplaintGetPayload<{
  select: typeof escalationSourceSelect;
}>;

/** Phạm vi do service cấp luôn được AND với `kind = AUTHORITY`. */
function scoped(
  scope: Prisma.ComplaintWhereInput,
  ...filters: Prisma.ComplaintWhereInput[]
): Prisma.ComplaintWhereInput {
  return { AND: [scope, { kind: "AUTHORITY" }, ...filters] };
}

export function createAuthorityComplaintRepository() {
  return {
    list(
      db: Db,
      scope: Prisma.ComplaintWhereInput,
      query: AuthorityComplaintListFilter,
    ): Promise<AuthorityComplaintRow[]> {
      return db.complaint.findMany({
        where: scoped(scope, query.status ? { status: query.status } : {}),
        skip: (query.page - 1) * query.limit,
        take: query.limit + 1,
        select: authorityComplaintSelect,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      });
    },
    findOne(
      db: Db,
      scope: Prisma.ComplaintWhereInput,
      id: string,
    ): Promise<AuthorityComplaintDetailRow | null> {
      return db.complaint.findFirst({
        where: scoped(scope, { id }),
        select: authorityComplaintDetailSelect,
      });
    },
    findTicketTarget(
      tx: Tx,
      scope: Prisma.ComplaintWhereInput,
      id: string,
    ): Promise<AuthorityComplaintTicketTarget | null> {
      return tx.complaint.findFirst({
        where: scoped(scope, { id }),
        select: ticketTargetSelect,
      });
    },
    /** Khóa dòng C03 gốc để hai lần "Chuyển ATTP" đồng thời chạy tuần tự. */
    async lockMealComplaint(tx: Tx, id: string): Promise<void> {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.complaints
        WHERE id = ${id}::uuid AND kind = 'MEAL'
        FOR UPDATE
      `;
    },
    /** C03 do chính người gửi tạo, thuộc trường hiện tại của họ. */
    findEscalationSource(
      tx: Tx,
      id: string,
      scope: { schoolId: string; senderUserId: string },
    ): Promise<EscalationSourceRow | null> {
      return tx.complaint.findFirst({
        where: {
          id,
          kind: "MEAL",
          senderUserId: scope.senderUserId,
          mealComplaint: { is: { schoolId: scope.schoolId } },
        },
        select: escalationSourceSelect,
      });
    },
    async findSchoolLocationId(
      tx: Tx,
      schoolId: string,
    ): Promise<string | null> {
      const row = await tx.school.findUnique({
        where: { id: schoolId },
        select: { locationId: true },
      });
      return row?.locationId ?? null;
    },
    /** Đơn vị ATTP đang hoạt động phụ trách phường/xã (Q10). */
    findRecipientUnit(
      tx: Tx,
      locationId: string,
    ): Promise<{ id: string } | null> {
      return tx.communeFoodSafetyUnit.findFirst({
        where: { locationId, status: "ACTIVE" },
        select: { id: true },
      });
    },
    /** Tạo bản ghi cha `complaints` + bản ghi con `authority_complaints` trong cùng lệnh. */
    create(
      tx: Tx,
      data: {
        code: string;
        title: string;
        description: string;
        senderUserId: string;
        senderRoleCode: string;
        schoolId: string;
        recipientCommuneFoodSafetyUnitId: string;
        escalatedFromMealComplaintId: string;
      },
    ): Promise<{ id: string }> {
      return tx.complaint.create({
        data: {
          kind: "AUTHORITY",
          code: data.code,
          title: data.title,
          description: data.description,
          senderUserId: data.senderUserId,
          senderRoleCode: data.senderRoleCode,
          senderSchoolId: data.schoolId,
          status: "NEW",
          authorityComplaint: {
            create: {
              schoolId: data.schoolId,
              recipientCommuneFoodSafetyUnitId:
                data.recipientCommuneFoodSafetyUnitId,
              escalatedFromMealComplaintId: data.escalatedFromMealComplaintId,
            },
          },
        },
        select: { id: true },
      });
    },
  };
}

export type AuthorityComplaintRepository = ReturnType<
  typeof createAuthorityComplaintRepository
>;
