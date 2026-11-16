import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePrincipal } from "../../utils/authorization";
import { supplierStaffManagementScope } from "../../utils/resource-access";
import {
  supplierStaffService,
  type SupplierStaffService,
} from "./supplier-staff.service";
import { createSupplierStaffController } from "./supplier-staff.controller";

export function createSupplierStaffRouter(
  service: SupplierStaffService = supplierStaffService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierStaffController(service);
  router.use(authHandler, (req, _res, next) => {
    try {
      supplierStaffManagementScope(requirePrincipal(req));
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get("/", controller.getAll);
  router.post("/", controller.create);
  router.get("/:userId", controller.getDetail);
  router.patch("/:userId/status", controller.changeStatus);
  router.get("/:userId/permissions", controller.getPermissions);
  router.put(
    "/:userId/permission-denials/:permissionId",
    controller.disablePermission,
  );
  router.delete(
    "/:userId/permission-denials/:permissionId",
    controller.enablePermission,
  );
  return router;
}
export default createSupplierStaffRouter();
