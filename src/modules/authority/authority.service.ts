import { ORG_TYPES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { RequestValidationError } from "../../utils/request-validation";
import {
  authorityRepository,
  type AuthorityLocationRow,
  type AuthorityRepository,
} from "./authority.repository";
import type {
  AssignAuthorityLocationRequest,
  AuthorityParamsRequest,
} from "./authority.request.dto";
import type { AuthorityLocationResponseDTO } from "./authority.response.dto";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";

const select = {
  id: true,
  code: true,
  name: true,
  status: true,
  locationId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CommuneFoodSafetyUnitSelect;

type ListRow = Prisma.CommuneFoodSafetyUnitGetPayload<{
  select: typeof select;
}>;
type ListArguments = Pick<
  Prisma.CommuneFoodSafetyUnitFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.communeFoodSafetyUnit.findMany(args);
};

/** Cấp phường/xã của `Location` (mô hình 2 cấp tỉnh → phường/xã). */
export const WARD_LOCATION_LEVEL = 2;
const MANAGE_PERMISSION = "authority.manage";

function assertManager(principal: AuthPrincipal): void {
  assertPermission(principal, MANAGE_PERMISSION);
  if (principal.orgType !== ORG_TYPES.SYSTEM)
    throw new HttpError(403, "Chỉ System Admin được gắn địa bàn đơn vị ATTP");
}

function toLocationResponse(
  row: AuthorityLocationRow,
): AuthorityLocationResponseDTO {
  if (!row.location)
    throw new HttpError(503, "Không thể tải dữ liệu. Vui lòng thử lại sau.");
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    location: {
      id: row.location.id,
      code: row.location.code,
      name: row.location.name,
    },
  };
}

export function createAuthorityService(
  read: ListReader = readFromDatabase,
  repository: AuthorityRepository = authorityRepository,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  return {
    /** Gắn đơn vị ATTP với phường/xã phụ trách (specs/authority-complaints FR-008). */
    async assignLocation(
      params: AuthorityParamsRequest,
      body: AssignAuthorityLocationRequest,
      principal: AuthPrincipal,
    ): Promise<AuthorityLocationResponseDTO> {
      assertManager(principal);
      const db = await databaseOperation(() => connect());
      return authorizationTransaction(db, async (tx) => {
        assertManager(await loadPrincipal(principal.id, tx));
        if (!(await repository.lockUnit(tx, params.id)))
          throw new HttpError(404, "Không tìm thấy đơn vị ATTP");
        const location = await repository.findLocation(tx, body.locationId);
        if (!location?.isActive || location.level !== WARD_LOCATION_LEVEL)
          throw new RequestValidationError([
            {
              field: "locationId",
              message: "Địa bàn phải là phường/xã đang hoạt động",
            },
          ]);
        const holder = await repository.findUnitByLocation(tx, location.id);
        if (holder && holder.id !== params.id)
          throw new HttpError(
            409,
            "Phường/xã đã được gắn với đơn vị ATTP khác",
          );
        return toLocationResponse(
          await repository.updateLocation(tx, params.id, location.id),
        );
      });
    },
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["authority"](principal);
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

export const authorityService = createAuthorityService();
export type AuthorityService = ReturnType<typeof createAuthorityService>;
