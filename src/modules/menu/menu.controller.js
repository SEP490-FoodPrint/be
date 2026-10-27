import MenuService from "./menu.service.js"
import { validateApprovalPayload, validateRevisionPayload } from "./menu.validation.js"
import { sendError, sendSuccess } from "../../utils/response.js"

const getApprovalDetail = async (req, res, next) => {
  try {
    const data = await MenuService.getApprovalDetail(req.params.menuId)
    if (!data) return sendError(res, "Không tìm thấy thực đơn", 404)
    return sendSuccess(res, data, "Lấy hồ sơ phê duyệt thực đơn thành công")
  } catch (error) {
    next(error)
  }
}

const approve = async (req, res, next) => {
  try {
    const errors = validateApprovalPayload(req.body)
    if (errors.length) return sendError(res, "Dữ liệu phê duyệt không hợp lệ", 400, errors)
    const data = await MenuService.approveMenu(req.params.menuId, req.user?.userId, req.body.notes)
    if (!data) return sendError(res, "Không tìm thấy thực đơn", 404)
    return sendSuccess(res, data, "Phê duyệt thực đơn thành công")
  } catch (error) {
    next(error)
  }
}

const requestRevision = async (req, res, next) => {
  try {
    const errors = validateRevisionPayload(req.body)
    if (errors.length) return sendError(res, "Dữ liệu yêu cầu điều chỉnh không hợp lệ", 400, errors)
    const data = await MenuService.requestRevision(
      req.params.menuId,
      req.user?.userId,
      req.body.reason
    )
    if (!data) return sendError(res, "Không tìm thấy thực đơn", 404)
    return sendSuccess(res, data, "Gửi yêu cầu điều chỉnh thực đơn thành công")
  } catch (error) {
    next(error)
  }
}

export default { getApprovalDetail, approve, requestRevision }
