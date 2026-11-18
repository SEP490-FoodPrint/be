import { Router } from "express";
import type { Request, Response, RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { HttpError } from "../../utils/http-error";
import {
  createSystemComplaintService,
  type SystemComplaintService,
} from "./system-complaint.service";
import {
  createSystemComplaintSchema,
  respondSystemComplaintSchema,
  systemComplaintListQuerySchema,
} from "./system-complaint.validation";

export function createSystemComplaintRouter(
  service: SystemComplaintService = createSystemComplaintService(),
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();

  // 1. Gửi khiếu nại kỹ thuật hệ thống (mọi user đã xác thực)
  router.post(
    "/",
    authHandler,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) throw new HttpError(401, "Yêu cầu đăng nhập");
      const parsed = createSystemComplaintSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
        );
      }
      const data = await service.create(parsed.data, req.auth);
      res.status(201).json({
        success: true,
        statusCode: 201,
        message: "Gửi khiếu nại kỹ thuật hệ thống thành công",
        data,
      });
    }),
  );

  // 2. Lấy danh sách khiếu nại của chính mình
  router.get(
    "/my",
    authHandler,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) throw new HttpError(401, "Yêu cầu đăng nhập");
      const parsed = systemComplaintListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? "Tham số truy vấn không hợp lệ",
        );
      }
      const result = await service.listOwn(parsed.data, req.auth);
      res.json({
        success: true,
        statusCode: 200,
        message: "Lấy danh sách khiếu nại thành công",
        data: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    }),
  );

  // 3. System Admin lấy danh sách khiếu nại toàn hệ thống
  router.get(
    "/",
    authHandler,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) throw new HttpError(401, "Yêu cầu đăng nhập");
      const parsed = systemComplaintListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? "Tham số truy vấn không hợp lệ",
        );
      }
      const result = await service.listAdmin(parsed.data, req.auth);
      res.json({
        success: true,
        statusCode: 200,
        message: "Lấy danh sách khiếu nại hệ thống thành công",
        data: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
        },
      });
    }),
  );

  // 4. Lấy chi tiết khiếu nại
  router.get(
    "/:id",
    authHandler,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) throw new HttpError(401, "Yêu cầu đăng nhập");
      const data = await service.getDetail(req.params.id, req.auth);
      res.json({
        success: true,
        statusCode: 200,
        message: "Lấy chi tiết khiếu nại hệ thống thành công",
        data,
      });
    }),
  );

  // 5. Phản hồi hoặc sửa phản hồi (System Admin)
  router.post(
    "/:id/responses",
    authHandler,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) throw new HttpError(401, "Yêu cầu đăng nhập");
      const parsed = respondSystemComplaintSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(
          400,
          parsed.error.issues[0]?.message ?? "Dữ liệu phản hồi không hợp lệ",
        );
      }
      const data = await service.respond(req.params.id, parsed.data, req.auth);
      res.status(201).json({
        success: true,
        statusCode: 201,
        message: "Ghi nhận phản hồi khiếu nại hệ thống thành công",
        data,
      });
    }),
  );

  // 6. Lấy lịch sử các phiên bản phản hồi
  router.get(
    "/:id/responses",
    authHandler,
    asyncHandler(async (req: Request, res: Response) => {
      if (!req.auth) throw new HttpError(401, "Yêu cầu đăng nhập");
      const data = await service.listVersions(req.params.id, req.auth);
      res.json({
        success: true,
        statusCode: 200,
        message: "Lấy lịch sử phiên bản phản hồi thành công",
        data: data.versions,
      });
    }),
  );

  return router;
}

export default createSystemComplaintRouter();
