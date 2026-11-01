import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createSchoolSupplierController } from "./school-supplier.controller";
import {
  schoolSupplierService,
  type SchoolSupplierService,
} from "./school-supplier.service";

export function createSchoolSupplierRouter(
  service: SchoolSupplierService = schoolSupplierService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSchoolSupplierController(service);
  router.get(
    "/",
    authHandler,
    requireResource("school-supplier"),
    controller.getAll,
  );
  return router;
}

export default createSchoolSupplierRouter();
