import type { Prisma } from "../../generated/prisma/client";
import { ROLES } from "../../constants/roles";
import type { AuthorizationClient } from "../../utils/authorization";
import { wardLocationSelect } from "../../utils/ward-location";

type Tx = AuthorizationClient;

export const authorityOfficerSelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
  communeFoodSafetyUnit: {
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      location: { select: wardLocationSelect },
    },
  },
} as const satisfies Prisma.UserSelect;

export type AuthorityOfficerRow = Prisma.UserGetPayload<{
  select: typeof authorityOfficerSelect;
}>;

export interface AuthorityOfficerFilter {
  search?: string;
  status?: Prisma.UserWhereInput["status"];
  locationId?: string;
}

const officerWhere = {
  roleCode: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
  communeFoodSafetyUnitId: { not: null },
} as const satisfies Prisma.UserWhereInput;

function listWhere(filter: AuthorityOfficerFilter): Prisma.UserWhereInput {
  return {
    AND: [
      officerWhere,
      ...(filter.status ? [{ status: filter.status }] : []),
      ...(filter.locationId
        ? [{ communeFoodSafetyUnit: { locationId: filter.locationId } }]
        : []),
      ...(filter.search
        ? [
            {
              OR: [
                {
                  fullName: {
                    contains: filter.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  username: {
                    contains: filter.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

export function createAuthorityOfficerRepository() {
  return {
    /** Khóa dòng phường/xã để các lần tạo tài khoản cùng phường/xã chạy tuần tự. */
    async lockWard(tx: Tx, locationId: string) {
      await tx.$queryRaw`
        SELECT id FROM foodprint.locations WHERE id = ${locationId}::uuid FOR UPDATE
      `;
      return tx.location.findUnique({
        where: { id: locationId },
        select: wardLocationSelect,
      });
    },
    officerRole(tx: Tx) {
      return tx.role.findUnique({
        where: { code: ROLES.COMMUNE_FOOD_SAFETY_OFFICER },
        select: { id: true, code: true, type: true },
      });
    },
    findUnitByLocation(tx: Tx, locationId: string) {
      return tx.communeFoodSafetyUnit.findFirst({
        where: { locationId },
        select: { id: true, status: true },
      });
    },
    async unitCodeTaken(tx: Tx, code: string) {
      return (await tx.communeFoodSafetyUnit.count({ where: { code } })) > 0;
    },
    createUnit(
      tx: Tx,
      input: { code: string; name: string; locationId: string },
    ) {
      return tx.communeFoodSafetyUnit.create({
        data: { ...input, status: "ACTIVE" },
        select: { id: true, status: true },
      });
    },
    /** Đơn vị đã có tài khoản ATTP ở mọi trạng thái (`uq_users_commune_officer`). */
    async unitHasOfficer(tx: Tx, unitId: string) {
      return (
        (await tx.user.count({
          where: {
            roleCode: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
            communeFoodSafetyUnitId: unitId,
          },
        })) > 0
      );
    },
    /** Trùng tên đăng nhập trong không gian `uq_users_non_staff_username`. */
    async usernameTaken(tx: Tx, username: string) {
      return (
        (await tx.user.count({
          where: {
            username: { equals: username, mode: "insensitive" },
            roleCode: { not: ROLES.INGREDIENT_SUPPLIER_STAFF },
          },
        })) > 0
      );
    },
    createOfficer(
      tx: Tx,
      input: {
        roleId: string;
        unitId: string;
        username: string;
        passwordHash: string;
        fullName: string;
        phone: string | null;
      },
    ) {
      return tx.user.create({
        data: {
          roleId: input.roleId,
          roleCode: ROLES.COMMUNE_FOOD_SAFETY_OFFICER,
          communeFoodSafetyUnitId: input.unitId,
          username: input.username,
          email: null,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          phone: input.phone,
          status: "UNVERIFIED",
        },
        select: authorityOfficerSelect,
      });
    },
    list(
      client: Tx,
      filter: AuthorityOfficerFilter,
      window: { skip: number; take: number },
    ) {
      return client.user.findMany({
        where: listWhere(filter),
        select: authorityOfficerSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        ...window,
      });
    },
    findOne(client: Tx, id: string) {
      return client.user.findFirst({
        where: { ...officerWhere, id },
        select: authorityOfficerSelect,
      });
    },
  };
}

export const authorityOfficerRepository = createAuthorityOfficerRepository();
export type AuthorityOfficerRepository = ReturnType<
  typeof createAuthorityOfficerRepository
>;
