import ClassAllergyService from "./class-allergy.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await ClassAllergyService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await ClassAllergyService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    const data = req.record || (await ClassAllergyService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    const data = await ClassAllergyService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    await ClassAllergyService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const ClassAllergyController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default ClassAllergyController
