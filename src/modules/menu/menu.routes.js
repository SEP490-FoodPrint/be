import { Router } from "express"
import MenuController from "./menu.controller.js"

const router = Router()

router.get("/:menuId/approval-detail", MenuController.getApprovalDetail)
router.post("/:menuId/approve", MenuController.approve)
router.post("/:menuId/request-revision", MenuController.requestRevision)

export default router
