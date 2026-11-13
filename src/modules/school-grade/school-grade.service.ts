import { ORG_TYPES, ROLES } from "../../constants/roles";
import type { AuthPrincipal } from "../../types/auth";
import { withSchoolTransaction } from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { listScopes } from "../../utils/resource-access";
import {
  schoolGradeRepository,
  type SchoolGradeRow,
} from "./school-grade.repository";
import type {
  CreateSchoolGradeRequest,
  UpdateSchoolGradeRequest,
} from "./school-grade.request.dto";
import type { SchoolGradeResponse } from "./school-grade.response.dto";

function requireBoard(actor: AuthPrincipal) {
  if (
    actor.role !== ROLES.SCHOOL_MANAGEMENT_BOARD ||
    actor.orgType !== ORG_TYPES.SCHOOL ||
    !actor.schoolId
  )
    throw new HttpError(403, "Chỉ Ban Giám hiệu được quản lý khối học");
}

function toResponse(row: SchoolGradeRow): SchoolGradeResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    classCount: row._count.classes,
  };
}

export function createSchoolGradeService(
  connect = getPrisma,
  repository = schoolGradeRepository,
) {
  async function write<T>(
    actor: AuthPrincipal,
    operation: Parameters<typeof withSchoolTransaction<T>>[3],
  ) {
    requireBoard(actor);
    return withSchoolTransaction(
      await connect(),
      actor,
      "class.manage",
      async (tx, current, schoolId) => {
        requireBoard(current);
        return operation(tx, current, schoolId);
      },
    );
  }

  return {
    async list(actor: AuthPrincipal) {
      requireBoard(actor);
      const scope = listScopes["school-grade"](actor);
      return (await repository.list(await connect(), scope)).map(toResponse);
    },
    create(actor: AuthPrincipal, input: CreateSchoolGradeRequest) {
      return write(actor, async (tx, _, schoolId) => {
        if (await repository.findByCode(tx, schoolId, input.code))
          throw new HttpError(409, "Mã khối đã tồn tại");
        return toResponse(await repository.create(tx, schoolId, input));
      });
    },
    update(actor: AuthPrincipal, id: string, input: UpdateSchoolGradeRequest) {
      return write(actor, async (tx, _, schoolId) => {
        const grade = await repository.find(tx, schoolId, id);
        if (!grade) throw new HttpError(404, "Không tìm thấy khối học");
        if (
          input.code !== undefined &&
          input.code !== grade.code &&
          (await repository.findByCode(tx, schoolId, input.code))
        )
          throw new HttpError(409, "Mã khối đã tồn tại");
        return toResponse(await repository.update(tx, schoolId, id, input));
      });
    },
    remove(actor: AuthPrincipal, id: string) {
      return write(actor, async (tx, _, schoolId) => {
        const grade = await repository.find(tx, schoolId, id);
        if (!grade) throw new HttpError(404, "Không tìm thấy khối học");
        if (grade._count.classes)
          throw new HttpError(
            409,
            "Khối học còn lớp liên kết. Hãy chuyển hoặc bỏ gán khối tại Lớp học & GVCN.",
          );
        await repository.remove(tx, schoolId, id);
        return { id };
      });
    },
  };
}
