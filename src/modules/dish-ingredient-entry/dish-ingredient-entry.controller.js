import DishIngredientEntryService from "./dish-ingredient-entry.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await DishIngredientEntryService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await DishIngredientEntryService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { dish_id: req.params.dish_id || req.query.dish_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    const data = req.record || (await DishIngredientEntryService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { dish_id: req.params.dish_id || req.query.dish_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    const data = await DishIngredientEntryService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { dish_id: req.params.dish_id || req.query.dish_id, ingredient_entry_id: req.params.ingredient_entry_id || req.query.ingredient_entry_id }
    await DishIngredientEntryService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const DishIngredientEntryController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default DishIngredientEntryController
