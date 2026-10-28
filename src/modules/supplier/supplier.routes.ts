import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createSupplierController } from "./supplier.controller";
import { supplierService, type SupplierService } from "./supplier.service";

export function createSupplierRouter(
  service: SupplierService = supplierService,
) {
  const router = Router();
  const controller = createSupplierController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createSupplierRouter();
