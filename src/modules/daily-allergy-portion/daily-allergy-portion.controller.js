import DailyAllergyPortionService from "./daily-allergy-portion.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await DailyAllergyPortionService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await DailyAllergyPortionService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { daily_meal_portion_id: req.params.daily_meal_portion_id || req.query.daily_meal_portion_id, class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    const data = req.record || (await DailyAllergyPortionService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { daily_meal_portion_id: req.params.daily_meal_portion_id || req.query.daily_meal_portion_id, class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    const data = await DailyAllergyPortionService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { daily_meal_portion_id: req.params.daily_meal_portion_id || req.query.daily_meal_portion_id, class_id: req.params.class_id || req.query.class_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    await DailyAllergyPortionService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const DailyAllergyPortionController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default DailyAllergyPortionController
