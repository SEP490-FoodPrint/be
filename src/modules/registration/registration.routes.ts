import { Router } from "express";
import { systemAdminOnly } from "../../middlewares/system-admin.middleware";
import { createRegistrationController } from "./registration.controller";
import {
  registrationService,
  type RegistrationService,
} from "./registration.service";

export function createRegistrationRouter(
  service: RegistrationService = registrationService,
) {
  const router = Router();
  const controller = createRegistrationController(service);
  router.get("/", ...systemAdminOnly, controller.getAll);
  return router;
}

export default createRegistrationRouter();
