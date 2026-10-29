import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createSupplierCertificationController } from "./supplier-certification.controller";
import {
  supplierCertificationService,
  type SupplierCertificationService,
} from "./supplier-certification.service";

export function createSupplierCertificationRouter(
  service: SupplierCertificationService = supplierCertificationService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierCertificationController(service);
  router.get(
    "/",
    authHandler,
    requireResource("supplier-certification"),
    controller.getAll,
  );
  return router;
}

export default createSupplierCertificationRouter();
