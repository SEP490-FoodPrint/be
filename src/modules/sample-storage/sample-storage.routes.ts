import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { createSampleStorageController } from "./sample-storage.controller";
import {
  sampleStorageService,
  type SampleStorageService,
} from "./sample-storage.service";

export function createSampleStorageRouter(
  service: SampleStorageService = sampleStorageService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSampleStorageController(service);

  router.get("/", authHandler, controller.list);
  router.get("/:id", authHandler, controller.getById);
  router.post("/", authHandler, controller.create);
  router.put("/:id", authHandler, controller.update);
  router.delete("/:id", authHandler, controller.remove);

  return router;
}

export default createSampleStorageRouter();
