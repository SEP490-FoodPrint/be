import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createSystemComplaintController } from "./system-complaint.controller";
import {
  systemComplaintService,
  type SystemComplaintService,
} from "./system-complaint.service";

export function createSystemComplaintRouter(
  service: SystemComplaintService = systemComplaintService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createSystemComplaintController(service);
  const handler = requirePermission("system_complaint.respond");
  const requester = requirePermission("system_complaint.submit");
  const resource = requireResource("system-complaint");
  router.get("/", authHandler, resource, controller.getAll);
  router.get("/:id", authHandler, resource, controller.getOne);
  router.post("/", authHandler, requester, controller.create);
  router.post("/:id/accept", authHandler, handler, controller.accept);
  router.post(
    "/:id/comments",
    authHandler,
    requirePermission("system_complaint.respond", "system_complaint.submit"),
    controller.comment,
  );
  router.post("/:id/resolve", authHandler, handler, controller.resolve);
  router.post("/:id/satisfy", authHandler, requester, controller.satisfy);
  router.post("/:id/reopen", authHandler, requester, controller.reopen);
  return router;
}

export default createSystemComplaintRouter();
