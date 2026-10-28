import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createAllergyController } from "./allergy.controller";
import { allergyService, type AllergyService } from "./allergy.service";

export function createAllergyRouter(service: AllergyService = allergyService) {
  const router = Router();
  const controller = createAllergyController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createAllergyRouter();
