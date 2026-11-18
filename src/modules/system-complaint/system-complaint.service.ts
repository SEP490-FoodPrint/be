import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { formatComplaintCode } from "../../utils/complaint-code";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import {
  createSystemComplaintRepository,
  type SystemComplaintRecord,
  type SystemComplaintRepository,
} from "./system-complaint.repository";
import type {
  CreateSystemComplaintInput,
  RespondSystemComplaintInput,
  SystemComplaintListQuery,
} from "./system-complaint.validation";

export interface SystemComplaintResponseDto {
  id: string;
  complaintCode: string;
  kind: "SYSTEM";
  title: string | null;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sender: {
    id: string;
    fullName: string;
    email: string;
  };
  currentResponse: {
    id: string;
    version: number;
    content: string;
    changeReason: string | null;
    createdAt: string;
    respondedBy: {
      id: string;
      fullName: string;
    } | null;
  } | null;
}

function mapToResponseDto(
  record: SystemComplaintRecord,
): SystemComplaintResponseDto {
  return {
    id: record.id,
    complaintCode: record.complaintCode,
    kind: "SYSTEM",
    title: record.title,
    description: record.description,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    sender: {
      id: record.senderUser.id,
      fullName: record.senderUser.fullName,
      email: record.senderUser.email,
    },
    currentResponse: record.currentResponseVersion
      ? {
          id: record.currentResponseVersion.id,
          version: record.currentResponseVersion.version,
          content: record.currentResponseVersion.content,
          changeReason: record.currentResponseVersion.changeReason,
          createdAt: record.currentResponseVersion.createdAt.toISOString(),
          respondedBy: record.currentResponseVersion.respondedByUser
            ? {
                id: record.currentResponseVersion.respondedByUser.id,
                fullName:
                  record.currentResponseVersion.respondedByUser.fullName,
              }
            : null,
        }
      : null,
  };
}

export interface SystemComplaintService {
  create(
    input: CreateSystemComplaintInput,
    principal: AuthPrincipal,
  ): Promise<SystemComplaintResponseDto>;
  getDetail(
    id: string,
    principal: AuthPrincipal,
  ): Promise<SystemComplaintResponseDto>;
  listOwn(
    query: SystemComplaintListQuery,
    principal: AuthPrincipal,
  ): Promise<{
    items: SystemComplaintResponseDto[];
    total: number;
    page: number;
    limit: number;
  }>;
  listAdmin(
    query: SystemComplaintListQuery,
    principal: AuthPrincipal,
  ): Promise<{
    items: SystemComplaintResponseDto[];
    total: number;
    page: number;
    limit: number;
  }>;
  respond(
    id: string,
    input: RespondSystemComplaintInput,
    principal: AuthPrincipal,
  ): Promise<SystemComplaintResponseDto>;
  listVersions(
    id: string,
    principal: AuthPrincipal,
  ): Promise<{
    versions: Array<{
      id: string;
      version: number;
      content: string;
      changeReason: string | null;
      createdAt: string;
      respondedBy: {
        id: string;
        fullName: string;
      } | null;
    }>;
  }>;
}

function isSystemAdminOrHasPerm(
  principal: AuthPrincipal,
  permissionCode: string,
): boolean {
  if (principal.role === "SYSTEM_ADMIN") return true;
  return principal.permissions.includes(permissionCode);
}

export function createSystemComplaintService(
  repository: SystemComplaintRepository = createSystemComplaintRepository(),
  prismaProvider: () => Promise<PrismaClient> = getPrisma,
): SystemComplaintService {
  return {
    async create(
      input: CreateSystemComplaintInput,
      principal: AuthPrincipal,
    ): Promise<SystemComplaintResponseDto> {
      const db = await prismaProvider();
      return db.$transaction(
        async (tx) => {
          const seq = await repository.nextComplaintCodeSequence(tx);
          const complaintCode = formatComplaintCode(seq);

          const record = await repository.create(tx, {
            complaintCode,
            senderUserId: principal.id,
            senderRoleCode: principal.role,
            senderSchoolId: principal.schoolId ?? null,
            senderSupplierId: principal.supplierId ?? null,
            senderCommuneFoodSafetyUnitId:
              principal.communeFoodSafetyUnitId ?? null,
            title: input.title,
            description: input.description,
          });

          return mapToResponseDto(record);
        },
        { isolationLevel: "Serializable" },
      );
    },

    async getDetail(
      id: string,
      principal: AuthPrincipal,
    ): Promise<SystemComplaintResponseDto> {
      const db = await prismaProvider();
      const record = await repository.findById(db, id);
      if (!record) {
        throw new HttpError(404, "Không tìm thấy khiếu nại hệ thống");
      }

      const canViewAll = isSystemAdminOrHasPerm(
        principal,
        "system_complaint.view",
      );
      if (!canViewAll && record.senderUserId !== principal.id) {
        throw new HttpError(404, "Không tìm thấy khiếu nại hệ thống");
      }

      return mapToResponseDto(record);
    },

    async listOwn(query: SystemComplaintListQuery, principal: AuthPrincipal) {
      const db = await prismaProvider();
      const { items, total } = await repository.listOwn(db, principal.id, {
        page: query.page,
        limit: query.limit,
        status: query.status,
      });

      return {
        items: items.map(mapToResponseDto),
        total,
        page: query.page,
        limit: query.limit,
      };
    },

    async listAdmin(query: SystemComplaintListQuery, principal: AuthPrincipal) {
      const canViewAll = isSystemAdminOrHasPerm(
        principal,
        "system_complaint.view",
      );
      if (!canViewAll) {
        throw new HttpError(
          403,
          "Bạn không có quyền xem toàn bộ khiếu nại hệ thống",
        );
      }

      const db = await prismaProvider();
      const { items, total } = await repository.listAll(db, {
        page: query.page,
        limit: query.limit,
        status: query.status,
        search: query.search,
      });

      return {
        items: items.map(mapToResponseDto),
        total,
        page: query.page,
        limit: query.limit,
      };
    },

    async respond(
      id: string,
      input: RespondSystemComplaintInput,
      principal: AuthPrincipal,
    ): Promise<SystemComplaintResponseDto> {
      const canRespond = isSystemAdminOrHasPerm(
        principal,
        "system_complaint.respond",
      );
      if (!canRespond) {
        throw new HttpError(
          403,
          "Bạn không có quyền phản hồi khiếu nại hệ thống",
        );
      }

      const db = await prismaProvider();
      return db.$transaction(
        async (tx) => {
          const complaint = await repository.findById(tx, id);
          if (!complaint) {
            throw new HttpError(404, "Không tìm thấy khiếu nại hệ thống");
          }

          let nextVersion = 1;
          let previousVersionId: string | null = null;

          if (complaint.currentResponseVersion) {
            if (!input.changeReason || input.changeReason.trim().length === 0) {
              throw new HttpError(
                400,
                "Cập nhật phản hồi bắt buộc phải có lý do thay đổi (changeReason)",
              );
            }
            nextVersion = complaint.currentResponseVersion.version + 1;
            previousVersionId = complaint.currentResponseVersion.id;
          }

          const { updatedComplaint } = await repository.createResponseVersion(
            tx,
            {
              complaintId: id,
              version: nextVersion,
              previousVersionId,
              content: input.content,
              changeReason: input.changeReason,
              respondedByUserId: principal.id,
              respondedRoleCode: principal.role,
            },
          );

          return mapToResponseDto(updatedComplaint);
        },
        { isolationLevel: "Serializable" },
      );
    },

    async listVersions(id: string, principal: AuthPrincipal) {
      const db = await prismaProvider();
      const record = await repository.findById(db, id);
      if (!record) {
        throw new HttpError(404, "Không tìm thấy khiếu nại hệ thống");
      }

      const canViewAll = isSystemAdminOrHasPerm(
        principal,
        "system_complaint.view",
      );
      if (!canViewAll && record.senderUserId !== principal.id) {
        throw new HttpError(404, "Không tìm thấy khiếu nại hệ thống");
      }

      const versions = await repository.listResponseVersions(db, id);
      return {
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          content: v.content,
          changeReason: v.changeReason,
          createdAt: v.createdAt.toISOString(),
          respondedBy: v.respondedByUser
            ? {
                id: v.respondedByUser.id,
                fullName: v.respondedByUser.fullName,
              }
            : null,
        })),
      };
    },
  };
}
