import Delivery from "./delivery.model.js"
import { Op } from "sequelize"

const create = async (payload) => {
  return await Delivery.create(payload)
}

const getAll = async ({ page = 1, limit = 20, search = "", ...filters } = {}) => {
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit)
  const where = { ...filters }

  const { rows, count } = await Delivery.findAndCountAll({
    where,
    limit: Number(limit),
    offset,
    order: [["created_at", "DESC"]],
  }).catch(() => {
    return Delivery.findAndCountAll({
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
  return await Delivery.findByPk(id)
}

const update = async (id, payload) => {
  const record = await Delivery.findByPk(id)
  if (!record) return null
  return await record.update(payload)
}

const remove = async (id) => {
  const record = await Delivery.findByPk(id)
  if (!record) return null
  await record.destroy()
  return true
}

const DeliveryService = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default DeliveryService
