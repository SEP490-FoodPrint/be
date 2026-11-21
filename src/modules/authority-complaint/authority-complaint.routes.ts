import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import {
  requirePermission,
  requireResource,
} from "../../middlewares/permission.middleware";
import { createAuthorityComplaintController } from "./authority-complaint.controller";
import {
  authorityComplaintService,
  type AuthorityComplaintService,
} from "./authority-complaint.service";

export function createAuthorityComplaintRouter(
  service: AuthorityComplaintService = authorityComplaintService,
  authHandler: RequestHandler = authenticate,
) {
  const router = Router();
  const controller = createAuthorityComplaintController(service);
  const handler = requirePermission("authority_complaint.respond");
  const requester = requirePermission("authority_complaint.submit");
  const resource = requireResource("authority-complaint");
  router.get("/", authHandler, resource, controller.getAll);
  router.get("/:id", authHandler, resource, controller.getOne);
  router.post("/", authHandler, requester, controller.escalate);
  router.post("/:id/accept", authHandler, handler, controller.accept);
  router.post(
    "/:id/comments",
    authHandler,
    requirePermission(
      "authority_complaint.respond",
      "authority_complaint.submit",
    ),
    controller.comment,
  );
  router.post("/:id/resolve", authHandler, handler, controller.resolve);
  router.post("/:id/satisfy", authHandler, requester, controller.satisfy);
  router.post("/:id/reopen", authHandler, requester, controller.reopen);
  return router;
}

export default createAuthorityComplaintRouter();
