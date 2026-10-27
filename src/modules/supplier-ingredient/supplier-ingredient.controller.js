import SupplierIngredientService from "./supplier-ingredient.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await SupplierIngredientService.create(req.body)
    return sendSuccess(res, data, "Tạo nguyên liệu NCC thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await SupplierIngredientService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách nguyên liệu NCC thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const data = req.record || (await SupplierIngredientService.getById(req.params.id))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const data = await SupplierIngredientService.update(req.params.id, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    await SupplierIngredientService.remove(req.params.id)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const SupplierIngredientController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default SupplierIngredientController
