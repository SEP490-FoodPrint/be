import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createDishController } from "./dish.controller";
import { dishService, type DishService } from "./dish.service";

export function createDishRouter(service: DishService = dishService) {
  const router = Router();
  const controller = createDishController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createDishRouter();
