import { asyncHandler } from "../../utils/async-handler";
import { requireSessionUser } from "../../utils/session-identity";
import { sendSuccess } from "../../utils/response";
import { requirePrincipal } from "../../utils/authorization";
import { parseRequest } from "../../utils/request-validation";
import {
  readProfileBody,
  validateSubmission,
  registrationParamsSchema,
  ownDocumentParamsSchema,
  reviewDocumentParamsSchema,
  approveBodySchema,
  rejectBodySchema,
} from "./onboarding.validation";
import {
  onboardingService,
  type OnboardingService,
} from "./onboarding.service";

export function createOnboardingController(
  service: OnboardingService = onboardingService,
) {
  return {
    own: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(res, await service.own(requireSessionUser(req)));
    }),
    submit: asyncHandler(async (req, res) => {
      const user = requireSessionUser(req);
      const body = validateSubmission(
        readProfileBody(
          req.body as unknown,
          Boolean(req.is("multipart/form-data")),
        ),
        user.orgType === "SCHOOL" ? "SCHOOL" : "SUPPLIER",
      );
      const result = await service.submit(
        user,
        body,
        Array.isArray(req.files) ? req.files : [],
      );
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        result,
        "Đã gửi hồ sơ; tài khoản chờ System Admin duyệt",
        201,
      );
    }),
    ownDocument: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.ownDocument(
          requireSessionUser(req),
          parseRequest(ownDocumentParamsSchema, req.params),
        ),
      );
    }),
    detail: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.detail(
          requirePrincipal(req),
          parseRequest(registrationParamsSchema, req.params),
        ),
      );
    }),
    approve: asyncHandler(async (req, res) => {
      const params = parseRequest(registrationParamsSchema, req.params);
      const body = parseRequest(approveBodySchema, req.body as unknown);
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.approve(requirePrincipal(req), { ...params, ...body }),
        "Đã duyệt hồ sơ và kích hoạt tài khoản",
      );
    }),
    reject: asyncHandler(async (req, res) => {
      const params = parseRequest(registrationParamsSchema, req.params);
      const body = parseRequest(rejectBodySchema, req.body as unknown);
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.reject(requirePrincipal(req), { ...params, ...body }),
        "Đã từ chối hồ sơ",
      );
    }),
    reviewDocument: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.reviewDocument(
          requirePrincipal(req),
          parseRequest(reviewDocumentParamsSchema, req.params),
        ),
      );
    }),
  };
}
