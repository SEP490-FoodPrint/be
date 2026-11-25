import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listWindow, readListPage } from "../../utils/list-query";
import { assertActiveWard, toWardLocation } from "../../utils/ward-location";
import {
  authorityOfficerRepository,
  type AuthorityOfficerRepository,
  type AuthorityOfficerRow,
} from "./authority-officer.repository";
import type {
  AuthorityOfficerCreateRequest,
  AuthorityOfficerListQueryRequest,
  AuthorityOfficerParamsRequest,
} from "./authority-officer.request.dto";
import type {
  AuthorityOfficerDTO,
  AuthorityOfficerListDTO,
} from "./authority-officer.response.dto";

const MANAGE_PERMISSION = "authority.manage";
const DENIED = "Chỉ System Admin được quản lý tài khoản ATTP";

function assertManager(principal: AuthPrincipal): void {
  assertPermission(principal, MANAGE_PERMISSION);
  if (principal.orgType !== ORG_TYPES.SYSTEM) throw new HttpError(403, DENIED);
}

function toOfficer(row: AuthorityOfficerRow): AuthorityOfficerDTO {
  const unit = row.communeFoodSafetyUnit;
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    status: row.status,
    emailSetupRequired: row.email === null,
    emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    unit: unit
      ? { id: unit.id, code: unit.code, name: unit.name, status: unit.status }
      : null,
    location: unit?.location ? toWardLocation(unit.location) : null,
  };
}

export function createAuthorityOfficerService(
  repository: AuthorityOfficerRepository = authorityOfficerRepository,
  connect: () => Promise<PrismaClient> = getPrisma,
  hashPassword: (password: string) => Promise<string> = (password) =>
    bcrypt.hash(password, 12),
) {
  return {
    /** FR-002: tìm hoặc tạo đơn vị ATTP của phường/xã rồi tạo tài khoản `UNVERIFIED` chưa có email. */
    async create(
      input: AuthorityOfficerCreateRequest,
      principal: AuthPrincipal,
    ): Promise<AuthorityOfficerDTO> {
      assertManager(principal);
      const passwordHash = await databaseOperation(() =>
        hashPassword(input.password),
      );
      const db = await databaseOperation(() => connect());
      return authorizationTransaction(db, async (tx) => {
        assertManager(await loadPrincipal(principal.id, tx));
        // Row lock on the ward serializes concurrent creates for the same ward.
        const ward = assertActiveWard(
          await repository.lockWard(tx, input.locationId),
        );
        const role = await repository.officerRole(tx);
        if (
          !role ||
          role.code !== ROLES.COMMUNE_FOOD_SAFETY_OFFICER ||
          role.type !== "AUTHORITY"
        )
          throw new HttpError(
            503,
            "Chưa cấu hình vai trò cán bộ. Liên hệ quản trị.",
          );
        if (await repository.usernameTaken(tx, input.username))
          throw new HttpError(
            409,
            "Tên đăng nhập đã được sử dụng",
            "USERNAME_TAKEN",
          );
        let unit = await repository.findUnitByLocation(tx, ward.id);
        if (unit?.status === "INACTIVE")
          throw new HttpError(
            409,
            "Đơn vị ATTP của phường/xã đang ngừng hoạt động",
            "AUTHORITY_UNIT_INACTIVE",
          );
        if (unit && (await repository.unitHasOfficer(tx, unit.id)))
          throw new HttpError(
            409,
            "Phường/xã đã có tài khoản ATTP",
            "AUTHORITY_OFFICER_EXISTS",
          );
        if (!unit) {
          const code = `ATTP-${ward.code}`;
          if (await repository.unitCodeTaken(tx, code))
            throw new HttpError(
              409,
              "Mã đơn vị ATTP của phường/xã đã được dùng cho đơn vị khác",
              "AUTHORITY_UNIT_CODE_TAKEN",
            );
          unit = await repository.createUnit(tx, {
            code,
            name: `Đơn vị ATTP ${ward.name}`,
            locationId: ward.id,
          });
        }
        return toOfficer(
          await repository.createOfficer(tx, {
            roleId: role.id,
            unitId: unit.id,
            username: input.username,
            passwordHash,
            fullName: input.fullName,
            phone: input.phone,
          }),
        );
      });
    },
    async list(
      query: AuthorityOfficerListQueryRequest,
      principal: AuthPrincipal,
    ): Promise<AuthorityOfficerListDTO> {
      assertManager(principal);
      const { search, status, locationId, ...page } = query;
      const db = await databaseOperation(() => connect());
      const result = await readListPage(
        () =>
          repository.list(db, { search, status, locationId }, listWindow(page)),
        page,
      );
      return { ...result, items: result.items.map(toOfficer) };
    },
    async getOne(
      params: AuthorityOfficerParamsRequest,
      principal: AuthPrincipal,
    ): Promise<AuthorityOfficerDTO> {
      assertManager(principal);
      const row = await databaseOperation(async () =>
        repository.findOne(await connect(), params.userId),
      );
      if (!row) throw new HttpError(404, "Không tìm thấy tài khoản ATTP");
      return toOfficer(row);
    },
  };
}

export const authorityOfficerService = createAuthorityOfficerService();
export type AuthorityOfficerService = ReturnType<
  typeof createAuthorityOfficerService
>;
