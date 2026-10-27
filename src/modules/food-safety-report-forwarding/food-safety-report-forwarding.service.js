import FoodSafetyReportForwarding from "./food-safety-report-forwarding.model.js"
import { Op } from "sequelize"

const create = async (payload) => {
  return await FoodSafetyReportForwarding.create(payload)
}

const getAll = async ({ page = 1, limit = 20, search = "", ...filters } = {}) => {
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit)
  const where = { ...filters }

  const { rows, count } = await FoodSafetyReportForwarding.findAndCountAll({
    where,
    limit: Number(limit),
    offset,
    order: [["created_at", "DESC"]],
  }).catch(() => {
    return FoodSafetyReportForwarding.findAndCountAll({
      where,
      limit: Number(limit),
      offset,
    })
  })

  return {
    items: rows,
    pagination: {
      total: count,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(count / Number(limit)),
    },
  }
}

const getById = async (id) => {
  return await FoodSafetyReportForwarding.findByPk(id)
}

const update = async (id, payload) => {
  const record = await FoodSafetyReportForwarding.findByPk(id)
  if (!record) return null
  return await record.update(payload)
}

const remove = async (id) => {
  const record = await FoodSafetyReportForwarding.findByPk(id)
  if (!record) return null
  await record.destroy()
  return true
}

const FoodSafetyReportForwardingService = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default FoodSafetyReportForwardingService
