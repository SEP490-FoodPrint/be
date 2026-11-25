import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { receiveEvidenceFiles } from "../../utils/evidence-files";
import { createFeedbackController } from "./feedback.controller";
import { feedbackService, type FeedbackService } from "./feedback.service";

export function createFeedbackRouter(
  service: FeedbackService = feedbackService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createFeedbackController(service);
  const handler = requirePermission("meal_complaint.respond");
  const requester = requirePermission("meal_complaint.submit");
  router.get("/", authHandler, requireResource("feedback"), controller.getAll);
  router.get(
    "/meal-options",
    authHandler,
    requirePermission("meal_complaint.submit"),
    controller.mealOptions,
  );
  router.get(
    "/:id",
    authHandler,
    requireResource("feedback"),
    controller.getOne,
  );
  router.post(
    "/",
    authHandler,
    requester,
    receiveEvidenceFiles,
    controller.create,
  );
  router.post("/:id/accept", authHandler, handler, controller.accept);
  router.post(
    "/:id/comments",
    authHandler,
    requirePermission("meal_complaint.respond", "meal_complaint.submit"),
    receiveEvidenceFiles,
    controller.comment,
  );
  router.post(
    "/:id/resolve",
    authHandler,
    handler,
    receiveEvidenceFiles,
    controller.resolve,
  );
  router.post("/:id/satisfy", authHandler, requester, controller.satisfy);
  router.post("/:id/reopen", authHandler, requester, controller.reopen);
  return router;
}

export default createFeedbackRouter();
