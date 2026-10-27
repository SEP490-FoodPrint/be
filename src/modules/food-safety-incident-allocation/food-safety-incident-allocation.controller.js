import FoodSafetyIncidentAllocationService from "./food-safety-incident-allocation.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const create = async (req, res, next) => {
  try {
    const data = await FoodSafetyIncidentAllocationService.create(req.body)
    return sendSuccess(res, data, "Tạo mới thành công", 201)
  } catch (error) {
    next(error)
  }
}

const getAll = async (req, res, next) => {
  try {
    const data = await FoodSafetyIncidentAllocationService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const pkValues = { incident_id: req.params.incident_id || req.query.incident_id, meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id }
    const data = req.record || (await FoodSafetyIncidentAllocationService.getById(pkValues))
    return sendSuccess(res, data, "Lấy chi tiết thành công")
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const pkValues = { incident_id: req.params.incident_id || req.query.incident_id, meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id }
    const data = await FoodSafetyIncidentAllocationService.update(pkValues, req.body)
    return sendSuccess(res, data, "Cập nhật thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    const pkValues = { incident_id: req.params.incident_id || req.query.incident_id, meal_allocation_id: req.params.meal_allocation_id || req.query.meal_allocation_id }
    await FoodSafetyIncidentAllocationService.remove(pkValues)
    return sendSuccess(res, null, "Xóa thành công")
  } catch (error) {
    next(error)
  }
}

const FoodSafetyIncidentAllocationController = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default FoodSafetyIncidentAllocationController
