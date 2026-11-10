import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createFeedbackController } from "./feedback.controller";
import { feedbackService, type FeedbackService } from "./feedback.service";

export function createFeedbackRouter(
  service: FeedbackService = feedbackService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createFeedbackController(service);
  router.get("/", authHandler, requireResource("feedback"), controller.getAll);
  router.get(
    "/:id",
    authHandler,
    requireResource("feedback"),
    controller.getOne,
  );
  router.post(
    "/",
    authHandler,
    requirePermission("meal_complaint.submit"),
    controller.create,
  );
  router.patch(
    "/:id",
    authHandler,
    requirePermission("meal_complaint.respond"),
    controller.respond,
  );
  return router;
}

export default createFeedbackRouter();
