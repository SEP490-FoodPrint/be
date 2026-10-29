import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createFeedbackController } from "./feedback.controller";
import { feedbackService, type FeedbackService } from "./feedback.service";

export function createFeedbackRouter(
  service: FeedbackService = feedbackService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createFeedbackController(service);
  router.get("/", authHandler, requireResource("feedback"), controller.getAll);
  return router;
}

export default createFeedbackRouter();
