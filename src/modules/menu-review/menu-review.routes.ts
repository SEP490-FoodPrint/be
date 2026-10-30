import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createMenuReviewController } from "./menu-review.controller";
import {
  menuReviewService,
  type MenuReviewService,
} from "./menu-review.service";

export function createMenuReviewRouter(
  service: MenuReviewService = menuReviewService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createMenuReviewController(service);
  router.get(
    "/",
    authHandler,
    requireResource("menu-review"),
    controller.getAll,
  );
  return router;
}

export default createMenuReviewRouter();
