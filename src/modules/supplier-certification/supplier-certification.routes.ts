import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createSupplierCertificationController } from "./supplier-certification.controller";
import {
  supplierCertificationService,
  type SupplierCertificationService,
} from "./supplier-certification.service";

export function createSupplierCertificationRouter(
  service: SupplierCertificationService = supplierCertificationService,
) {
  const router = Router();
  const controller = createSupplierCertificationController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createSupplierCertificationRouter();
