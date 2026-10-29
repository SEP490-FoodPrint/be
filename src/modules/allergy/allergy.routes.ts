import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createAllergyController } from "./allergy.controller";
import { allergyService, type AllergyService } from "./allergy.service";

export function createAllergyRouter(
  service: AllergyService = allergyService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAllergyController(service);
  router.get("/", authHandler, requireResource("allergy"), controller.getAll);
  return router;
}

export default createAllergyRouter();
