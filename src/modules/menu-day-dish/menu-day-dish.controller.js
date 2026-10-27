import MenuDayDishService from "./menu-day-dish.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await MenuDayDishService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await MenuDayDishService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { menu_day_id: req.params.menu_day_id || req.query.menu_day_id, dish_id: req.params.dish_id || req.query.dish_id, meal_type: req.params.meal_type || req.query.meal_type }
    const data = req.record || (await MenuDayDishService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { menu_day_id: req.params.menu_day_id || req.query.menu_day_id, dish_id: req.params.dish_id || req.query.dish_id, meal_type: req.params.meal_type || req.query.meal_type }
    const data = await MenuDayDishService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { menu_day_id: req.params.menu_day_id || req.query.menu_day_id, dish_id: req.params.dish_id || req.query.dish_id, meal_type: req.params.meal_type || req.query.meal_type }
    await MenuDayDishService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const MenuDayDishController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default MenuDayDishController
