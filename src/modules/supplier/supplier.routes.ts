import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createSupplierController } from "./supplier.controller";
import { supplierService, type SupplierService } from "./supplier.service";

export function createSupplierRouter(
  service: SupplierService = supplierService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierController(service);
  router.get("/", authHandler, requireResource("supplier"), controller.getAll);
  router.get(
    "/summary",
    authHandler,
    requireResource("supplier"),
    controller.getSummary,
  );
  router.get(
    "/:id",
    authHandler,
    requireResource("supplier"),
    controller.getById,
  );
  return router;
}

export default createSupplierRouter();
