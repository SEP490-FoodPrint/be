import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertSystemManager,
  authorizationTransaction,
} from "../../utils/authorization";
import { withReadTransaction } from "../../utils/read-transaction";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import {
  measurementUnitRepository as repo,
  type MeasurementUnitRow,
} from "./measurement-unit.repository";
import { normalizedUnitText } from "./measurement-unit.validation";
import type {
  UnitQueryRequest,
  UnitParamsRequest,
  UnitCreateRequest,
  UnitUpdateRequest,
} from "./measurement-unit.request.dto";
import type {
  MeasurementUnitResponse,
  MeasurementUnitPageResponse,
} from "./measurement-unit.response.dto";
function dto(r: MeasurementUnitRow): MeasurementUnitResponse {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    symbol: r.symbol,
    group: r.group,
    status: r.status,
    aliases: r.aliases.map((a) => a.alias),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
export async function resolveMeasurementUnit(
  tx: Prisma.TransactionClient,
  value: string,
  allowInactive = false,
) {
  const unit = await repo.resolve(tx, normalizedUnitText(value));
  if (!unit)
    throw new HttpError(422, `Đơn vị “${value}” chưa có trong danh mục`);
  if (unit.status !== "ACTIVE" && !allowInactive)
    throw new HttpError(422, `Đơn vị “${value}” đã ngừng sử dụng`);
  return { id: unit.id, symbol: unit.symbol };
}
export function createMeasurementUnitService(connect = getPrisma) {
  async function write<T>(
    principal: AuthPrincipal,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    assertSystemManager(principal, "measurement_unit.manage");
    try {
      return await authorizationTransaction(await connect(), async (tx) => {
        const actor = await repo.actor(tx, principal.id);
        assertSystemManager(actor, "measurement_unit.manage");
        try {
          return await operation(tx);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "P2002"
          )
            throw new HttpError(
              409,
              "Mã, ký hiệu hoặc alias đơn vị đã tồn tại",
            );
          throw error;
        }
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new HttpError(409, "Mã, ký hiệu hoặc alias đơn vị đã tồn tại");
      throw error;
    }
  }
  return {
    list(
      input: UnitQueryRequest,
      principal: AuthPrincipal,
    ): Promise<MeasurementUnitPageResponse> {
      if (!principal.id) throw new HttpError(401, "Yêu cầu đăng nhập");
      return withReadTransaction(async (tx) => {
        const { items, total } = await repo.list(tx, input);
        return {
          items: items.map(dto),
          pagination: {
            page: input.page,
            limit: input.limit,
            total,
            totalPages: Math.ceil(total / input.limit),
          },
        };
      }, connect);
    },
    get(
      input: UnitParamsRequest,
      principal: AuthPrincipal,
    ): Promise<MeasurementUnitResponse> {
      if (!principal.id) throw new HttpError(401, "Yêu cầu đăng nhập");
      return withReadTransaction(async (tx) => {
        const row = await repo.find(tx, input.id);
        if (!row) throw new HttpError(404, "Không tìm thấy đơn vị tính");
        return dto(row);
      }, connect);
    },
    create(input: UnitCreateRequest, principal: AuthPrincipal) {
      return write(principal, async (tx) =>
        dto(
          await repo.create(tx, {
            ...input,
            aliases: [...new Set([input.code, input.symbol, ...input.aliases])],
          }),
        ),
      );
    },
    update(
      params: UnitParamsRequest,
      input: UnitUpdateRequest,
      principal: AuthPrincipal,
    ) {
      return write(principal, async (tx) => {
        if (!(await repo.find(tx, params.id)))
          throw new HttpError(404, "Không tìm thấy đơn vị tính");
        return dto(await repo.update(tx, params.id, input));
      });
    },
  };
}
export const measurementUnitService = createMeasurementUnitService();
export type MeasurementUnitService = ReturnType<
  typeof createMeasurementUnitService
>;
