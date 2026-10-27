import SupplierIngredient from "./supplier-ingredient.model.js"

const create = async (payload) => {
  return await SupplierIngredient.create(payload)
}

const getAll = async ({ page = 1, limit = 20, ...filters } = {}) => {
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit)
  const where = { ...filters }

  const { rows, count } = await SupplierIngredient.findAndCountAll({
    where,
    limit: Number(limit),
    offset,
    order: [["created_at", "DESC"]],
  }).catch(() => SupplierIngredient.findAndCountAll({ where, limit: Number(limit), offset }))

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
  return await SupplierIngredient.findByPk(id)
}

const update = async (id, payload) => {
  const record = await SupplierIngredient.findByPk(id)
  if (!record) return null
  return await record.update(payload)
}

const remove = async (id) => {
  const record = await SupplierIngredient.findByPk(id)
  if (!record) return null
  await record.destroy()
  return true
}

const SupplierIngredientService = {
  create,
  getAll,
  getById,
  update,
  remove,
}

export default SupplierIngredientService
