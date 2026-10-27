import CookingBatchLot from "./cooking-batch-lot.model.js"

const create = async (payload) => {
  return await CookingBatchLot.create(payload)
}

const getAll = async ({ page = 1, limit = 20, ...filters } = {}) => {
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit)
  const where = { ...filters }

  const { rows, count } = await CookingBatchLot.findAndCountAll({
    where,
    limit: Number(limit),
    offset,
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

const getById = async (pkValues) => {
  return await CookingBatchLot.findOne({ where: pkValues })
}

const update = async (pkValues, payload) => {
  const record = await CookingBatchLot.findOne({ where: pkValues })
  if (!record) return null
  return await record.update(payload)
}

const remove = async (pkValues) => {
  const record = await CookingBatchLot.findOne({ where: pkValues })
  if (!record) return null
  await record.destroy()
  return true
}

const CookingBatchLotService = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default CookingBatchLotService
