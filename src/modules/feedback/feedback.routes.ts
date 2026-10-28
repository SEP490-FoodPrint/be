import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createFeedbackController } from "./feedback.controller";
import { feedbackService, type FeedbackService } from "./feedback.service";

export function createFeedbackRouter(
  service: FeedbackService = feedbackService,
) {
  const router = Router();
  const controller = createFeedbackController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createFeedbackRouter();
