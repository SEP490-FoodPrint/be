import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import { withSchoolTransaction } from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { readListPage } from "../../utils/list-query";
import { withReadTransaction } from "../../utils/read-transaction";
import { listScopes } from "../../utils/resource-access";
import {
  createUserRepository,
  type ListReader,
  type UserRepository,
} from "./user.repository";
import type {
  CreateSchoolAccountDTO,
  UpdateAccountStatusDTO,
  UpdateSchoolAccountDTO,
  UserListRequestDTO,
  UserSchoolRequestDTO,
} from "./user.request.dto";
import type {
  UserAccountDetailDTO,
  UserListResponseDTO,
  UserSchoolResponseDTO,
} from "./user.response.dto";

const SCHOOL_STAFF_MANAGE_PERMISSION = "school_user.manage";
const DEFAULT_INITIAL_PASSWORD = "123456";

function generateUsernameFromEmail(email: string): string {
  const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
  return prefix.length >= 3 ? prefix : `user_${Date.now()}`;
}

export function createUserService(
  read?: ListReader,
  repository?: UserRepository,
  run = withReadTransaction,
  connect: () => Promise<PrismaClient> = getPrisma,
) {
  const data = repository ?? createUserRepository(read);
  return {
    async getAll(
      query: UserListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<UserListResponseDTO> {
      const scope = listScopes["user"](principal);
      const page = await readListPage(() => data.list(query, scope), query);
      return {
        items: page.items.map((row) => ({
          id: row.id,
          username: row.username,
          fullName: row.fullName,
          roleId: row.roleId,
          schoolId: row.schoolId,
          supplierId: row.supplierId,
          communeFoodSafetyUnitId: row.communeFoodSafetyUnitId,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: page.pagination,
      };
    },
    async getBySchool(
      input: UserSchoolRequestDTO,
      principal: AuthPrincipal,
    ): Promise<UserSchoolResponseDTO> {
      const scope = listScopes["user"](principal);
      if (principal.orgType === "SUPPLIER")
        throw new HttpError(403, "Không có phạm vi tài khoản trường");
      const parent =
        principal.orgType === "SYSTEM"
          ? { kind: "system" as const }
          : {
              kind:
                principal.orgType === "SCHOOL"
                  ? ("school" as const)
                  : ("supplier" as const),
              id: principal.schoolId ?? principal.supplierId!,
            };
      return run(async (tx) => {
        const result = await data.schoolPage(
          tx,
          input.query,
          input.params.schoolId,
          scope,
          parent,
        );
        if (!result) throw new HttpError(404, "Không tìm thấy trường học");
        const items = result.items.map((row) => ({
          id: row.id,
          schoolId: row.schoolId,
          fullName: row.fullName,
          email: row.email,
          phone: row.phone,
          roleCode: row.Role.code,
          roleName: row.Role.name,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
        const { page, limit } = input.query;
        return {
          items,
          pagination: {
            page,
            limit,
            total: result.total,
            hasNext: (page - 1) * limit + items.length < result.total,
          },
        };
      });
    },
    async createSchoolAccount(
      input: CreateSchoolAccountDTO,
      principal: AuthPrincipal,
    ): Promise<UserAccountDetailDTO> {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        SCHOOL_STAFF_MANAGE_PERMISSION,
        async (tx, _actor, schoolId) => {
          if (input.params.schoolId !== schoolId) {
            throw new HttpError(
              403,
              "Không có quyền quản lý tài khoản của trường này",
            );
          }
          const targetRoleCode =
            input.body.roleCode === "INGREDIENT_MANAGEMENT"
              ? "INGREDIENT_MANAGEMENT_DEPARTMENT"
              : input.body.roleCode;
          const role = await data.findRoleByCode(tx, targetRoleCode);
          if (
            !role ||
            role.type !== "SCHOOL" ||
            role.code === "SCHOOL_ADMINISTRATION"
          ) {
            throw new HttpError(
              400,
              "Vai trò không hợp lệ cho nhân sự trường học",
            );
          }
          const username =
            input.body.username?.trim() ||
            generateUsernameFromEmail(input.body.email);
          const existing = await data.findUserByEmailOrUsername(
            tx,
            input.body.email,
            username,
          );
          if (existing) {
            throw new HttpError(
              409,
              "Email hoặc tên đăng nhập đã tồn tại trong hệ thống",
            );
          }
          const rawPassword = input.body.password || DEFAULT_INITIAL_PASSWORD;
          const passwordHash = await bcrypt.hash(rawPassword, 12);
          const user = await data.createSchoolUser(tx, {
            fullName: input.body.fullName,
            email: input.body.email,
            phone: input.body.phone ?? null,
            username,
            passwordHash,
            roleId: role.id,
            roleCode: role.code,
            schoolId,
            status: "ACTIVE",
          });
          return {
            id: user.id,
            schoolId: user.schoolId,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            roleCode: user.Role.code,
            roleName: user.Role.name,
            status: user.status,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          };
        },
      );
    },
    async updateSchoolAccount(
      input: UpdateSchoolAccountDTO,
      principal: AuthPrincipal,
    ): Promise<UserAccountDetailDTO> {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        SCHOOL_STAFF_MANAGE_PERMISSION,
        async (tx, _actor, schoolId) => {
          if (input.params.schoolId !== schoolId) {
            throw new HttpError(
              403,
              "Không có quyền quản lý tài khoản của trường này",
            );
          }
          const targetUser = await data.findSchoolUser(
            tx,
            schoolId,
            input.params.userId,
          );
          if (!targetUser) {
            throw new HttpError(
              404,
              "Không tìm thấy người dùng trong trường học này",
            );
          }
          if (targetUser.Role.code === "SCHOOL_ADMINISTRATION") {
            throw new HttpError(
              403,
              "Không thể thay đổi tài khoản Quản trị trường",
            );
          }
          let roleData: { roleId: string; roleCode: string } | undefined;
          if (
            input.body.roleCode &&
            input.body.roleCode !== targetUser.Role.code
          ) {
            const targetRoleCode =
              input.body.roleCode === "INGREDIENT_MANAGEMENT"
                ? "INGREDIENT_MANAGEMENT_DEPARTMENT"
                : input.body.roleCode;
            const role = await data.findRoleByCode(tx, targetRoleCode);
            if (
              !role ||
              role.type !== "SCHOOL" ||
              role.code === "SCHOOL_ADMINISTRATION"
            ) {
              throw new HttpError(
                400,
                "Vai trò không hợp lệ cho nhân sự trường học",
              );
            }
            roleData = { roleId: role.id, roleCode: role.code };
          }
          const updated = await data.updateSchoolUser(tx, input.params.userId, {
            ...(input.body.fullName ? { fullName: input.body.fullName } : {}),
            ...(input.body.phone !== undefined
              ? { phone: input.body.phone }
              : {}),
            ...(roleData ? roleData : {}),
          });
          return {
            id: updated.id,
            schoolId: updated.schoolId,
            fullName: updated.fullName,
            email: updated.email,
            phone: updated.phone,
            roleCode: updated.Role.code,
            roleName: updated.Role.name,
            status: updated.status,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          };
        },
      );
    },
    async toggleAccountStatus(
      input: UpdateAccountStatusDTO,
      principal: AuthPrincipal,
    ): Promise<UserAccountDetailDTO> {
      const db = await connect();
      return withSchoolTransaction(
        db,
        principal,
        SCHOOL_STAFF_MANAGE_PERMISSION,
        async (tx, _actor, schoolId) => {
          if (input.params.schoolId !== schoolId) {
            throw new HttpError(
              403,
              "Không có quyền quản lý tài khoản của trường này",
            );
          }
          const targetUser = await data.findSchoolUser(
            tx,
            schoolId,
            input.params.userId,
          );
          if (!targetUser) {
            throw new HttpError(
              404,
              "Không tìm thấy người dùng trong trường học này",
            );
          }
          if (targetUser.Role.code === "SCHOOL_ADMINISTRATION") {
            throw new HttpError(
              403,
              "Không thể thay đổi trạng thái tài khoản Quản trị trường",
            );
          }
          const updated = await data.updateSchoolUser(tx, input.params.userId, {
            status: input.body.status,
          });
          return {
            id: updated.id,
            schoolId: updated.schoolId,
            fullName: updated.fullName,
            email: updated.email,
            phone: updated.phone,
            roleCode: updated.Role.code,
            roleName: updated.Role.name,
            status: updated.status,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          };
        },
      );
    },
  };
}
export const userService = createUserService();
export type UserService = ReturnType<typeof createUserService>;
