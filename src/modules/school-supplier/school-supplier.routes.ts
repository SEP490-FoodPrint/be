import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createSchoolSupplierController } from "./school-supplier.controller";
import {
  schoolSupplierService,
  type SchoolSupplierService,
} from "./school-supplier.service";

export function createSchoolSupplierRouter(
  service: SchoolSupplierService = schoolSupplierService,
) {
  const router = Router();
  const controller = createSchoolSupplierController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createSchoolSupplierRouter();
