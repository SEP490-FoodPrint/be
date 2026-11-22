import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createSupplierEnforcementController } from "./supplier-enforcement.controller";
import {
  DECIDE_PERMISSION,
  REQUEST_PERMISSION,
  supplierEnforcementService,
  type SupplierEnforcementService,
} from "./supplier-enforcement.service";

/** PR6b: gắn tại `/api/supplier-enforcement-actions`. */
export function createSupplierEnforcementRouter(
  service: SupplierEnforcementService = supplierEnforcementService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierEnforcementController(service);
  const resource = requireResource("supplier-enforcement");
  const decide = requirePermission(DECIDE_PERMISSION);
  router.get("/", authHandler, resource, controller.list);
  router.get("/:actionId", authHandler, resource, controller.getOne);
  router.post("/:actionId/approve", authHandler, decide, controller.approve);
  router.post("/:actionId/reject", authHandler, decide, controller.reject);
  router.post("/:actionId/retry", authHandler, decide, controller.retry);
  return router;
}

/** PR6b: gắn cùng mount `/api/food-safety-incidents` (đề nghị của ATTP). */
export function createIncidentEnforcementRouter(
  service: SupplierEnforcementService = supplierEnforcementService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierEnforcementController(service);
  router.post(
    "/:id/enforcement-actions",
    authHandler,
    requirePermission(REQUEST_PERMISSION),
    controller.request,
  );
  return router;
}

export default createSupplierEnforcementRouter();
