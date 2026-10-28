import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createMenuReviewController } from "./menu-review.controller";
import {
  menuReviewService,
  type MenuReviewService,
} from "./menu-review.service";

export function createMenuReviewRouter(
  service: MenuReviewService = menuReviewService,
) {
  const router = Router();
  const controller = createMenuReviewController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createMenuReviewRouter();
