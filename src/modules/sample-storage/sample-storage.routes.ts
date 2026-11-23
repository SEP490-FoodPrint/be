import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permission.middleware";
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

  // Tủ lưu mẫu chỉ dành cho nhân viên bếp: xem cần quyền xem mẫu lưu,
  // thêm / sửa / xóa tủ cần quyền cập nhật mẫu lưu.
  const canView = requirePermission("retained_sample.view");
  const canManage = requirePermission("retained_sample.update");
  router.get("/", authHandler, canView, controller.list);
  router.get("/:id", authHandler, canView, controller.getById);
  router.post("/", authHandler, canManage, controller.create);
  router.put("/:id", authHandler, canManage, controller.update);
  router.delete("/:id", authHandler, canManage, controller.remove);

  return router;
}

export default createSampleStorageRouter();
