import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePrincipal } from "../../utils/authorization";
import { supplierSchoolReadScope } from "../../utils/resource-access";
import { createSupplierSchoolController } from "./supplier-school.controller";
import {
  supplierSchoolService,
  type SupplierSchoolService,
} from "./supplier-school.service";

export function createSupplierSchoolRouter(
  service: SupplierSchoolService = supplierSchoolService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSupplierSchoolController(service);
  router.use(authHandler, (req, _res, next) => {
    try {
      supplierSchoolReadScope(requirePrincipal(req));
      next();
    } catch (error) {
      next(error);
    }
  });
  router.get("/", controller.listSchools);
  router.get("/:schoolId", controller.getSchoolDetail);
  router.get("/:schoolId/contracts", controller.listContracts);
  router.get("/:schoolId/contracts/:contractId", controller.getContractDetail);
  router.get(
    "/:schoolId/contracts/:contractId/documents/:documentId",
    controller.getDocumentContent,
  );
  return router;
}

export default createSupplierSchoolRouter();
