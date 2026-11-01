import { asyncHandler } from "../../utils/async-handler";
import { requireSessionUser } from "../../utils/session-identity";
import { sendSuccess } from "../../utils/response";
import { requirePrincipal } from "../../utils/authorization";
import { objectBody, text, uuid } from "../../utils/auth-validation";
import { readProfileBody } from "./onboarding.validation";
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
      const body = readProfileBody(
        req.body as unknown,
        Boolean(req.is("multipart/form-data")),
      );
      const result = await service.submit(
        requireSessionUser(req),
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
          uuid(req.params.documentId),
        ),
      );
    }),
    detail: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.detail(requirePrincipal(req), uuid(req.params.id)),
      );
    }),
    approve: asyncHandler(async (req, res) => {
      objectBody((req.body as unknown) ?? {}, []);
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.approve(requirePrincipal(req), uuid(req.params.id)),
        "Đã duyệt hồ sơ và kích hoạt tài khoản",
      );
    }),
    reject: asyncHandler(async (req, res) => {
      const body = objectBody(req.body as unknown, ["rejectionReason"]);
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.reject(
          requirePrincipal(req),
          uuid(req.params.id),
          text(body.rejectionReason, 4000),
        ),
        "Đã từ chối hồ sơ",
      );
    }),
    reviewDocument: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      sendSuccess(
        res,
        await service.reviewDocument(
          requirePrincipal(req),
          uuid(req.params.id),
          uuid(req.params.documentId),
        ),
      );
    }),
  };
}
