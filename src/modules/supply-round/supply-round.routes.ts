import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
import { supplyRoundController } from "./supply-round.controller";

export function createSupplyRoundRouter(
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  router.get(
    "/",
    authHandler,
    requirePermission("cooking_plan.view"),
    supplyRoundController.get,
  );
  router.post(
    "/:id/dishes/:dishId/plan",
    authHandler,
    requirePermission("cooking_plan.approve"),
    supplyRoundController.retry,
  );
  router.post(
    "/:id/dishes/:dishId/approve",
    authHandler,
    requirePermission("cooking_plan.approve"),
    supplyRoundController.approve,
  );
  return router;
}
