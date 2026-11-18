import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";

export type SystemComplaintTx = Prisma.TransactionClient;

export interface CreateSystemComplaintDbInput {
  complaintCode: string;
  senderUserId: string;
  senderRoleCode: string;
  senderSchoolId?: string | null;
  senderSupplierId?: string | null;
  senderCommuneFoodSafetyUnitId?: string | null;
  title: string;
  description: string;
}

export interface CreateSystemComplaintResponseDbInput {
  complaintId: string;
  version: number;
  previousVersionId?: string | null;
  content: string;
  changeReason?: string | null;
  respondedByUserId: string;
  respondedRoleCode?: string | null;
}

const systemComplaintInclude = {
  senderUser: {
    select: {
      id: true,
      fullName: true,
      email: true,
    },
  },
  currentResponseVersion: {
    select: {
      id: true,
      version: true,
      content: true,
      changeReason: true,
      createdAt: true,
      respondedByUser: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
  },
} as const satisfies Prisma.ComplaintInclude;

export type SystemComplaintRecord = Prisma.ComplaintGetPayload<{
  include: typeof systemComplaintInclude;
}>;

export interface SystemComplaintRepository {
  nextComplaintCodeSequence(tx: SystemComplaintTx): Promise<bigint>;
  create(
    tx: SystemComplaintTx,
    input: CreateSystemComplaintDbInput,
  ): Promise<SystemComplaintRecord>;
  findById(
    tx: SystemComplaintTx,
    id: string,
  ): Promise<SystemComplaintRecord | null>;
  listOwn(
    tx: SystemComplaintTx,
    userId: string,
    params: { page: number; limit: number; status?: string },
  ): Promise<{ items: SystemComplaintRecord[]; total: number }>;
  listAll(
    tx: SystemComplaintTx,
    params: {
      page: number;
      limit: number;
      status?: string;
      search?: string;
    },
  ): Promise<{ items: SystemComplaintRecord[]; total: number }>;
  createResponseVersion(
    tx: SystemComplaintTx,
    input: CreateSystemComplaintResponseDbInput,
  ): Promise<{
    versionRecord: Prisma.ComplaintResponseVersionGetPayload<{
      include: {
        respondedByUser: { select: { id: true; fullName: true } };
      };
    }>;
    updatedComplaint: SystemComplaintRecord;
  }>;
  listResponseVersions(
    tx: SystemComplaintTx,
    complaintId: string,
  ): Promise<
    Prisma.ComplaintResponseVersionGetPayload<{
      include: {
        respondedByUser: { select: { id: true; fullName: true } };
      };
    }>[]
  >;
}

export function createSystemComplaintRepository(): SystemComplaintRepository {
  return {
    async nextComplaintCodeSequence(tx: SystemComplaintTx): Promise<bigint> {
      const rows = await tx.$queryRaw<{ nextval: bigint }[]>`
        SELECT nextval('foodprint.complaint_code_seq') AS nextval
      `;
      const first = rows[0];
      if (!first || typeof first.nextval === "undefined") {
        throw new Error("COMPLAINT_CODE_SEQUENCE_FAILED");
      }
      return BigInt(first.nextval);
    },

    async create(
      tx: SystemComplaintTx,
      input: CreateSystemComplaintDbInput,
    ): Promise<SystemComplaintRecord> {
      const complaint = await tx.complaint.create({
        data: {
          complaintCode: input.complaintCode,
          kind: "SYSTEM",
          title: input.title,
          description: input.description,
          senderUserId: input.senderUserId,
          senderRoleCode: input.senderRoleCode,
          senderSchoolId: input.senderSchoolId ?? null,
          senderSupplierId: input.senderSupplierId ?? null,
          senderCommuneFoodSafetyUnitId:
            input.senderCommuneFoodSafetyUnitId ?? null,
          status: "SUBMITTED",
        },
      });

      await tx.systemComplaint.create({
        data: {
          id: complaint.id,
          kind: "SYSTEM",
        },
      });

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: complaint.id,
          fromStatus: null,
          toStatus: "SUBMITTED",
          actorUserId: input.senderUserId,
          actorRoleCode: input.senderRoleCode,
          note: "Người dùng gửi khiếu nại kỹ thuật hệ thống",
        },
      });

      const fullRecord = await tx.complaint.findUniqueOrThrow({
        where: { id: complaint.id },
        include: systemComplaintInclude,
      });

      return fullRecord;
    },

    async findById(
      tx: SystemComplaintTx,
      id: string,
    ): Promise<SystemComplaintRecord | null> {
      return tx.complaint.findFirst({
        where: {
          id,
          kind: "SYSTEM",
        },
        include: systemComplaintInclude,
      });
    },

    async listOwn(
      tx: SystemComplaintTx,
      userId: string,
      params: { page: number; limit: number; status?: string },
    ): Promise<{ items: SystemComplaintRecord[]; total: number }> {
      const where: Prisma.ComplaintWhereInput = {
        kind: "SYSTEM",
        senderUserId: userId,
        ...(params.status ? { status: params.status as any } : {}),
      };

      const [items, total] = await Promise.all([
        tx.complaint.findMany({
          where,
          include: systemComplaintInclude,
          orderBy: { createdAt: "desc" },
          skip: (params.page - 1) * params.limit,
          take: params.limit,
        }),
        tx.complaint.count({ where }),
      ]);

      return { items, total };
    },

    async listAll(
      tx: SystemComplaintTx,
      params: {
        page: number;
        limit: number;
        status?: string;
        search?: string;
      },
    ): Promise<{ items: SystemComplaintRecord[]; total: number }> {
      const where: Prisma.ComplaintWhereInput = {
        kind: "SYSTEM",
        ...(params.status ? { status: params.status as any } : {}),
        ...(params.search
          ? {
              OR: [
                {
                  complaintCode: {
                    contains: params.search,
                    mode: "insensitive",
                  },
                },
                { title: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        tx.complaint.findMany({
          where,
          include: systemComplaintInclude,
          orderBy: { createdAt: "desc" },
          skip: (params.page - 1) * params.limit,
          take: params.limit,
        }),
        tx.complaint.count({ where }),
      ]);

      return { items, total };
    },

    async createResponseVersion(
      tx: SystemComplaintTx,
      input: CreateSystemComplaintResponseDbInput,
    ) {
      const versionRecord = await tx.complaintResponseVersion.create({
        data: {
          complaintId: input.complaintId,
          version: input.version,
          previousVersionId: input.previousVersionId ?? null,
          content: input.content,
          changeReason: input.changeReason ?? null,
          respondedByUserId: input.respondedByUserId,
          respondedRoleCode: input.respondedRoleCode ?? null,
        },
        include: {
          respondedByUser: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      });

      const fromComplaint = await tx.complaint.findUniqueOrThrow({
        where: { id: input.complaintId },
        select: { status: true },
      });

      await tx.complaint.update({
        where: { id: input.complaintId },
        data: {
          status: "RESPONDED",
          currentResponseVersionId: versionRecord.id,
        },
      });

      await tx.complaintStatusHistory.create({
        data: {
          complaintId: input.complaintId,
          fromStatus: fromComplaint.status,
          toStatus: "RESPONDED",
          responseVersionId: versionRecord.id,
          actorUserId: input.respondedByUserId,
          actorRoleCode: input.respondedRoleCode ?? null,
          note:
            input.version === 1
              ? "Quản trị viên hệ thống phản hồi lần đầu"
              : `Quản trị viên cập nhật phản hồi phiên bản ${input.version}`,
        },
      });

      const updatedComplaint = await tx.complaint.findUniqueOrThrow({
        where: { id: input.complaintId },
        include: systemComplaintInclude,
      });

      return { versionRecord, updatedComplaint };
    },

    async listResponseVersions(
      tx: SystemComplaintTx,
      complaintId: string,
    ) {
      return tx.complaintResponseVersion.findMany({
        where: { complaintId },
        include: {
          respondedByUser: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: { version: "asc" },
      });
    },
  };
}
