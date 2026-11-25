import type { Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { evidenceFilesOf } from "../../utils/evidence-files";
import { sendSuccess } from "../../utils/response";
import {
  authorityComplaintService,
  type AuthorityComplaintService,
} from "./authority-complaint.service";
import {
  validateAuthorityComplaintComment,
  validateAuthorityComplaintEmptyBody,
  validateAuthorityComplaintListQuery,
  validateAuthorityComplaintParams,
  validateAuthorityComplaintReopen,
  validateAuthorityComplaintResolve,
  validateEscalateAuthorityComplaint,
} from "./authority-complaint.validation";

function privateResult(
  res: Response,
  result: unknown,
  message: string,
  status = 200,
) {
  res.setHeader("Cache-Control", "private, no-store");
  sendSuccess(res, result, message, status);
}

export function createAuthorityComplaintController(
  service: AuthorityComplaintService = authorityComplaintService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      privateResult(
        res,
        await service.getAll(
          validateAuthorityComplaintListQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách khiếu nại leo thang thành công",
      );
    }),
    getOne: asyncHandler(async (req, res) => {
      const { id } = validateAuthorityComplaintParams(req.params);
      privateResult(
        res,
        await service.getOne(id, requirePrincipal(req)),
        "Lấy chi tiết khiếu nại leo thang thành công",
      );
    }),
    escalate: asyncHandler(async (req, res) => {
      privateResult(
        res,
        await service.escalate(
          validateEscalateAuthorityComplaint({
            ...req.body,
            files: evidenceFilesOf(req.files),
          }),
          requirePrincipal(req),
        ),
        "Đã chuyển khiếu nại lên ATTP",
        201,
      );
    }),
    accept: asyncHandler(async (req, res) => {
      const { id } = validateAuthorityComplaintParams(req.params);
      validateAuthorityComplaintEmptyBody(req.body);
      privateResult(
        res,
        await service.accept(id, requirePrincipal(req)),
        "Tiếp nhận khiếu nại thành công",
      );
    }),
    comment: asyncHandler(async (req, res) => {
      const { id } = validateAuthorityComplaintParams(req.params);
      privateResult(
        res,
        await service.comment(
          id,
          validateAuthorityComplaintComment({
            ...req.body,
            files: evidenceFilesOf(req.files),
          }),
          requirePrincipal(req),
        ),
        "Gửi bình luận thành công",
        201,
      );
    }),
    resolve: asyncHandler(async (req, res) => {
      const { id } = validateAuthorityComplaintParams(req.params);
      privateResult(
        res,
        await service.resolve(
          id,
          validateAuthorityComplaintResolve({
            ...req.body,
            files: evidenceFilesOf(req.files),
          }),
          requirePrincipal(req),
        ),
        "Cập nhật đã xử lý khiếu nại thành công",
      );
    }),
    satisfy: asyncHandler(async (req, res) => {
      const { id } = validateAuthorityComplaintParams(req.params);
      validateAuthorityComplaintEmptyBody(req.body);
      privateResult(
        res,
        await service.satisfy(id, requirePrincipal(req)),
        "Đã ghi nhận hài lòng, khiếu nại được đóng",
      );
    }),
    reopen: asyncHandler(async (req, res) => {
      const { id } = validateAuthorityComplaintParams(req.params);
      privateResult(
        res,
        await service.reopen(
          id,
          validateAuthorityComplaintReopen(req.body),
          requirePrincipal(req),
        ),
        "Đã gửi yêu cầu xử lý lại",
      );
    }),
  };
}
