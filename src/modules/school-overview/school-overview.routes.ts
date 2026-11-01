import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import { getSchoolOverview } from "./school-overview.service";

export function createSchoolOverviewRouter(
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  router.get(
    "/",
    authHandler,
    requirePermission("dashboard.view"),
    asyncHandler(async (req, res) => {
      sendSuccess(res, await getSchoolOverview(requirePrincipal(req)));
    }),
  );
  return router;
}
