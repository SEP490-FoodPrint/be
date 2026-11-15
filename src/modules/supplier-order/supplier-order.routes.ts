import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { createSupplierOrderController } from "./supplier-order.controller";
import {
  supplierOrderService,
  type SupplierOrderService,
} from "./supplier-order.service";

export function createSupplierOrderRouter(
  service: SupplierOrderService = supplierOrderService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierOrderController(service);

  router.get("/options/schools", authHandler, controller.listSchoolOptions);
  router.get(
    "/options/ingredients",
    authHandler,
    controller.listIngredientOptions,
  );
  router.get("/", authHandler, controller.list);
  router.get("/:id", authHandler, controller.detail);
  router.post("/", authHandler, controller.create);

  return router;
}

export default createSupplierOrderRouter();
