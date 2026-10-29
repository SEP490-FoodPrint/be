import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requireResource } from "../../middlewares/permission.middleware";
import { createRegistrationController } from "./registration.controller";
import {
  registrationService,
  type RegistrationService,
} from "./registration.service";

export function createRegistrationRouter(
  service: RegistrationService = registrationService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createRegistrationController(service);
  router.get(
    "/",
    authHandler,
    requireResource("registration"),
    controller.getAll,
  );
  return router;
}

export default createRegistrationRouter();
