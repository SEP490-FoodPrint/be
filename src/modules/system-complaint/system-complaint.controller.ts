import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  systemComplaintService,
  type SystemComplaintService,
} from "./system-complaint.service";
import {
  validateCreateSystemComplaint,
  validateSystemComplaintComment,
  validateSystemComplaintEmptyBody,
  validateSystemComplaintId,
  validateSystemComplaintListQuery,
  validateSystemComplaintReopen,
  validateSystemComplaintResolve,
} from "./system-complaint.validation";

export function createSystemComplaintController(
  service: SystemComplaintService = systemComplaintService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getAll(
          validateSystemComplaintListQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách khiếu nại gửi tới hệ thống thành công",
      );
    }),
    getOne: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getOne(
          validateSystemComplaintId(req.params.id),
          requirePrincipal(req),
        ),
        "Lấy chi tiết khiếu nại gửi tới hệ thống thành công",
      );
    }),
    create: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          validateCreateSystemComplaint(req.body),
          requirePrincipal(req),
        ),
        "Gửi khiếu nại tới hệ thống thành công",
        201,
      );
    }),
    accept: asyncHandler(async (req, res) => {
      const id = validateSystemComplaintId(req.params.id);
      validateSystemComplaintEmptyBody(req.body);
      sendSuccess(
        res,
        await service.accept(id, requirePrincipal(req)),
        "Tiếp nhận khiếu nại thành công",
      );
    }),
    comment: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.comment(
          validateSystemComplaintId(req.params.id),
          validateSystemComplaintComment(req.body),
          requirePrincipal(req),
        ),
        "Gửi bình luận thành công",
        201,
      );
    }),
    resolve: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.resolve(
          validateSystemComplaintId(req.params.id),
          validateSystemComplaintResolve(req.body),
          requirePrincipal(req),
        ),
        "Cập nhật đã xử lý khiếu nại thành công",
      );
    }),
    satisfy: asyncHandler(async (req, res) => {
      const id = validateSystemComplaintId(req.params.id);
      validateSystemComplaintEmptyBody(req.body);
      sendSuccess(
        res,
        await service.satisfy(id, requirePrincipal(req)),
        "Đã ghi nhận hài lòng, khiếu nại được đóng",
      );
    }),
    reopen: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.reopen(
          validateSystemComplaintId(req.params.id),
          validateSystemComplaintReopen(req.body),
          requirePrincipal(req),
        ),
        "Đã gửi yêu cầu xử lý lại",
      );
    }),
  };
}
