import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createDishController } from "./dish.controller";
import { dishService, type DishService } from "./dish.service";

export function createDishRouter(
  service: DishService = dishService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createDishController(service);
  router.get("/", authHandler, requireResource("dish"), controller.getAll);
  return router;
}

export default createDishRouter();
