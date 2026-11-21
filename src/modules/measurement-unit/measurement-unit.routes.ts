import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  measurementUnitService,
  type MeasurementUnitService,
} from "./measurement-unit.service";
import { createMeasurementUnitController } from "./measurement-unit.controller";
export function createMeasurementUnitRouter(
  auth: RequestHandler = authenticate,
  service: MeasurementUnitService = measurementUnitService,
) {
  const router = Router();
  const c = createMeasurementUnitController(service);
  router.use(auth);
  router.get("/", c.list);
  router.get("/:id", c.get);
  router.post("/", c.create);
  router.patch("/:id", c.update);
  return router;
}
