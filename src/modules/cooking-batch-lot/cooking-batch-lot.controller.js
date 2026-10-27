import CookingBatchLotService from "./cooking-batch-lot.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await CookingBatchLotService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await CookingBatchLotService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id, ingredient_lot_id: req.params.ingredient_lot_id || req.query.ingredient_lot_id }
    const data = req.record || (await CookingBatchLotService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id, ingredient_lot_id: req.params.ingredient_lot_id || req.query.ingredient_lot_id }
    const data = await CookingBatchLotService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id, ingredient_lot_id: req.params.ingredient_lot_id || req.query.ingredient_lot_id }
    await CookingBatchLotService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const CookingBatchLotController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default CookingBatchLotController
