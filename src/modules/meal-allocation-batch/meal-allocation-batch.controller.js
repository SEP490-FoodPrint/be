import MealAllocationBatchService from "./meal-allocation-batch.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await MealAllocationBatchService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await MealAllocationBatchService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id, cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id }
    const data = req.record || (await MealAllocationBatchService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id, cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id }
    const data = await MealAllocationBatchService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id, cooking_batch_id: req.params.cooking_batch_id || req.query.cooking_batch_id }
    await MealAllocationBatchService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const MealAllocationBatchController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default MealAllocationBatchController
