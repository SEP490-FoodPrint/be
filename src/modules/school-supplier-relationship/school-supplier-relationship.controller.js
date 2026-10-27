import SchoolSupplierRelationshipService from "./school-supplier-relationship.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await SchoolSupplierRelationshipService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await SchoolSupplierRelationshipService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const data = req.record || (await SchoolSupplierRelationshipService.getById(req.params.id))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const data = await SchoolSupplierRelationshipService.update(req.params.id, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    await SchoolSupplierRelationshipService.remove(req.params.id)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const SchoolSupplierRelationshipController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default SchoolSupplierRelationshipController
