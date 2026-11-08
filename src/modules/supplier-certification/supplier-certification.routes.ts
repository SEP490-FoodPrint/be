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
  router.get(
    "/:id/documents/:documentId",
    authHandler,
    requireResource("supplier-certification"),
    controller.document,
  );
  return router;
}

export default createSupplierCertificationRouter();

export function createSupplierCertificationsChildRouter(
  service: SupplierCertificationService = supplierCertificationService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router({ mergeParams: true });
  const controller = createSupplierCertificationController(service);
  router.get(
    "/",
    authHandler,
    requireResource("supplier-certification"),
    controller.getBySupplier,
  );
  return router;
}
