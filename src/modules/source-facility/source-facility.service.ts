import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  sourceFacilityManagementScope,
  type SourceFacilityManagementScope,
} from "../../utils/resource-access";
import {
  authorizationTransaction,
  databaseOperation,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { formatSourceFacilityCode } from "../../utils/source-facility-code";
import type {
  SourceFacilityQueryRequest,
  SourceFacilityCreateRequest,
  SourceFacilityParamsRequest,
  SourceFacilityUpdateRequest,
  SourceFacilityDeactivateRequest,
} from "./source-facility.request.dto";
import type {
  SourceFacilityListResponse,
  SourceFacilityPageResponse,
  SourceFacilityDetailResponse,
  SourceFacilityCreateResponse,
} from "./source-facility.response.dto";
import {
  sourceFacilityRepository,
  type SourceFacilityRepository,
  type SourceFacilityListRow,
  type SourceFacilityRow,
} from "./source-facility.repository";

function listDto(row: SourceFacilityListRow): SourceFacilityListResponse {
  return {
    id: row.id,
    supplierId: row.supplierId,
    facilityCode: row.facilityCode,
    name: row.name,
    status: row.status,
    isVisible: row.isVisible,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function detailDto(row: SourceFacilityRow): SourceFacilityDetailResponse {
  return {
    ...listDto(row),
    address: row.address,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
  };
}

function found(row: SourceFacilityRow | null): SourceFacilityRow {
  if (!row) throw new HttpError(404, "Không tìm thấy cơ sở cung cấp");
  return row;
}

export function createSourceFacilityService(
  repo: SourceFacilityRepository = sourceFacilityRepository,
  connect = getPrisma,
) {
  async function scope(
    principal: AuthPrincipal,
    tx?: Prisma.TransactionClient,
  ): Promise<SourceFacilityManagementScope> {
    const value = sourceFacilityManagementScope(principal);
    if ((await repo.supplierStatus(value, tx))?.status !== "ACTIVE")
      throw new HttpError(403, "Nhà cung cấp không hoạt động");
    return value;
  }

  async function write<T>(
    principal: AuthPrincipal,
    operation: (
      tx: Prisma.TransactionClient,
      access: SourceFacilityManagementScope,
      actor: AuthPrincipal,
    ) => Promise<T>,
  ): Promise<T> {
    const original = sourceFacilityManagementScope(principal);
    return databaseOperation(async () =>
      authorizationTransaction(await connect(), async (tx) => {
        const actor = await repo.actor(principal.id, tx);
        const current = sourceFacilityManagementScope(actor);
        if (current.supplierId !== original.supplierId)
          throw new HttpError(403, "Phạm vi tài khoản đã thay đổi");
        await repo.lockSupplier(current, tx);
        await scope(actor, tx);
        return operation(tx, current, actor);
      }),
    );
  }

  return {
    async getAll(
      query: SourceFacilityQueryRequest,
      principal: AuthPrincipal,
    ): Promise<SourceFacilityPageResponse> {
      return databaseOperation(async () => {
        const rows = await repo.list(await scope(principal), query);
        return {
          items: rows.slice(0, query.limit).map(listDto),
          pagination: { ...query, hasNext: rows.length > query.limit },
        };
      });
    },
    async getDetail(
      params: SourceFacilityParamsRequest,
      principal: AuthPrincipal,
    ): Promise<SourceFacilityDetailResponse> {
      return databaseOperation(async () =>
        detailDto(
          found(
            await repo.find(await scope(principal), params.sourceFacilityId),
          ),
        ),
      );
    },
    create(
      input: SourceFacilityCreateRequest,
      principal: AuthPrincipal,
    ): Promise<SourceFacilityCreateResponse> {
      return write(principal, async (tx, access, actor) => {
        if (await repo.nameExists(access, input.name, tx))
          throw new HttpError(
            409,
            "Tên cơ sở cung cấp đã tồn tại trong nhà cung cấp",
          );
        const code = formatSourceFacilityCode(
          (await repo.highestCodeNumber(access, tx)) + 1n,
        );
        const row = await repo.create(access, input, actor.id, code, tx);
        if (row.facilityCode === null)
          throw new HttpError(
            503,
            "Không thể cấp mã cơ sở cung cấp. Vui lòng thử lại sau.",
          );
        return { ...detailDto(row), facilityCode: row.facilityCode };
      });
    },
    update(
      params: SourceFacilityParamsRequest,
      input: SourceFacilityUpdateRequest,
      principal: AuthPrincipal,
    ): Promise<SourceFacilityDetailResponse> {
      return write(principal, async (tx, access, actor) => {
        await repo.lockTarget(access, params.sourceFacilityId, tx);
        found(await repo.find(access, params.sourceFacilityId, tx));
        if (
          input.name !== undefined &&
          (await repo.nameExists(
            access,
            input.name,
            tx,
            params.sourceFacilityId,
          ))
        )
          throw new HttpError(
            409,
            "Tên cơ sở cung cấp đã tồn tại trong nhà cung cấp",
          );
        return detailDto(
          found(
            await repo.update(
              access,
              params.sourceFacilityId,
              input,
              actor.id,
              tx,
            ),
          ),
        );
      });
    },
    deactivate(
      params: SourceFacilityParamsRequest,
      _input: SourceFacilityDeactivateRequest,
      principal: AuthPrincipal,
    ): Promise<SourceFacilityDetailResponse> {
      return write(principal, async (tx, access, actor) => {
        await repo.lockTarget(access, params.sourceFacilityId, tx);
        const current = found(
          await repo.find(access, params.sourceFacilityId, tx),
        );
        if (current.status === "INACTIVE") return detailDto(current);
        return detailDto(
          found(
            await repo.deactivate(
              access,
              params.sourceFacilityId,
              actor.id,
              tx,
            ),
          ),
        );
      });
    },
  };
}

export const sourceFacilityService = createSourceFacilityService();
export type SourceFacilityService = ReturnType<
  typeof createSourceFacilityService
>;
