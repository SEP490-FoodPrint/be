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
  WARD_LOCATION_LEVEL,
  assertActiveWard,
  toWardLocation,
} from "../../utils/ward-location";
import {
  authorityRepository,
  type AuthorityLocationRow,
  type AuthorityRepository,
  type AuthoritySchoolDetailRow,
  type AuthoritySchoolRow,
} from "./authority.repository";
import type {
  AssignAuthorityLocationRequest,
  AssignOrganizationLocationRequest,
  AuthorityParamsRequest,
  AuthoritySchoolListRequest,
  AuthoritySchoolParamsRequest,
  SchoolLocationParamsRequest,
  SupplierLocationParamsRequest,
} from "./authority.request.dto";
import type {
  AuthorityLocationResponseDTO,
  AuthoritySchoolDTO,
  AuthoritySchoolDetailDTO,
  OrganizationLocationResponseDTO,
} from "./authority.response.dto";
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
export { WARD_LOCATION_LEVEL };
const MANAGE_PERMISSION = "authority.manage";

function assertManager(
  principal: AuthPrincipal,
  message = "Chỉ System Admin được gắn địa bàn đơn vị ATTP",
): void {
  assertPermission(principal, MANAGE_PERMISSION);
  if (principal.orgType !== ORG_TYPES.SYSTEM) throw new HttpError(403, message);
}

const ORGANIZATION_LOCATION = {
  school: {
    denied: "Chỉ System Admin được gắn phường/xã cho trường",
    missing: "Không tìm thấy trường",
  },
  supplier: {
    denied: "Chỉ System Admin được gắn phường/xã cho nhà cung cấp",
    missing: "Không tìm thấy nhà cung cấp",
  },
} as const;

function toSchool(row: AuthoritySchoolRow): AuthoritySchoolDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    status: row.status,
    location: row.location ? toWardLocation(row.location) : null,
  };
}

function toSchoolDetail(
  row: AuthoritySchoolDetailRow,
): AuthoritySchoolDetailDTO {
  return {
    ...toSchool(row),
    suppliers: row.schoolSupplierRelationships.map((link) => ({
      id: link.Supplier.id,
      name: link.Supplier.name,
      taxCode: link.Supplier.taxCode,
      phone: link.Supplier.phone,
      email: link.Supplier.email,
      address: link.Supplier.address,
      location: link.Supplier.location
        ? toWardLocation(link.Supplier.location)
        : null,
      intakeState: link.Supplier.intakeState,
      // Repository chỉ trả quan hệ ACTIVE/SUSPENDED (FR-011).
      relationshipStatus: link.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
      linkedAt: link.linkedAt.toISOString(),
      suspendedAt: link.suspendedAt?.toISOString() ?? null,
    })),
  };
}

function schoolFilter(
  query: AuthoritySchoolListRequest,
): Prisma.SchoolWhereInput[] {
  const filters: Prisma.SchoolWhereInput[] = [];
  if (query.search)
    filters.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { code: { contains: query.search, mode: "insensitive" } },
      ],
    });
  if (query.status) filters.push({ status: query.status });
  return filters;
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
  /** FR-008: System Admin gắn/đổi phường/xã của trường hoặc NCC; bản chuyển đã gửi không đổi. */
  async function assignOrganizationLocation(
    kind: "school" | "supplier",
    id: string,
    body: AssignOrganizationLocationRequest,
    principal: AuthPrincipal,
  ): Promise<OrganizationLocationResponseDTO> {
    const messages = ORGANIZATION_LOCATION[kind];
    assertManager(principal, messages.denied);
    const db = await databaseOperation(() => connect());
    return authorizationTransaction(db, async (tx) => {
      assertManager(await loadPrincipal(principal.id, tx), messages.denied);
      if (!(await repository.lockOrganization(tx, kind, id)))
        throw new HttpError(404, messages.missing);
      const ward = assertActiveWard(
        await repository.findWard(tx, body.locationId),
      );
      const row = await repository.updateOrganizationLocation(
        tx,
        kind,
        id,
        ward.id,
      );
      return { id: row.id, name: row.name, location: ward };
    });
  }
  return {
    assignSchoolLocation(
      params: SchoolLocationParamsRequest,
      body: AssignOrganizationLocationRequest,
      principal: AuthPrincipal,
    ) {
      return assignOrganizationLocation(
        "school",
        params.schoolId,
        body,
        principal,
      );
    },
    assignSupplierLocation(
      params: SupplierLocationParamsRequest,
      body: AssignOrganizationLocationRequest,
      principal: AuthPrincipal,
    ) {
      return assignOrganizationLocation(
        "supplier",
        params.supplierId,
        body,
        principal,
      );
    },
    /** FR-009: trường cùng phường/xã với đơn vị ATTP của cán bộ. */
    async listSchools(
      query: AuthoritySchoolListRequest,
      principal: AuthPrincipal,
    ) {
      const scope = listScopes["authority-school"](principal);
      const db = await databaseOperation(() => connect());
      return readListPage(
        async () =>
          (
            await repository.listSchools(db, {
              where: { AND: [scope, ...schoolFilter(query)] },
              ...listWindow(query),
            })
          ).map(toSchool),
        query,
      );
    },
    /** FR-011: chi tiết trường thuộc địa bàn kèm NCC còn hoạt động liên kết với trường. */
    async getSchool(
      params: AuthoritySchoolParamsRequest,
      principal: AuthPrincipal,
    ): Promise<AuthoritySchoolDetailDTO> {
      const scope = listScopes["authority-school"](principal);
      const db = await databaseOperation(() => connect());
      const row = await databaseOperation(() =>
        repository.findSchoolDetail(db, {
          AND: [scope, { id: params.schoolId }],
        }),
      );
      if (!row) throw new HttpError(404, "Không tìm thấy trường");
      return toSchoolDetail(row);
    },
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
