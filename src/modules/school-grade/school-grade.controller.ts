import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import type { createSchoolGradeService } from "./school-grade.service";
import {
  validateGradeCreate,
  validateGradeId,
  validateGradeQuery,
  validateGradeUpdate,
} from "./school-grade.validation";

export function createSchoolGradeController(
  service: ReturnType<typeof createSchoolGradeService>,
) {
  return {
    list: asyncHandler(async (req, res) => {
      validateGradeQuery(req.query);
      sendSuccess(res, await service.list(requirePrincipal(req)));
    }),
    create: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          requirePrincipal(req),
          validateGradeCreate(req.body),
        ),
        "Đã tạo khối học",
        201,
      );
    }),
    update: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.update(
          requirePrincipal(req),
          validateGradeId(req.params.id),
          validateGradeUpdate(req.body),
        ),
        "Đã cập nhật khối học",
      );
    }),
    remove: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.remove(
          requirePrincipal(req),
          validateGradeId(req.params.id),
        ),
        "Đã xóa khối học",
      );
    }),
  };
}
