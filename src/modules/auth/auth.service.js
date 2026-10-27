import bcrypt from "bcryptjs"
import { generateToken } from "../../utils/jwt.js"
import User from "../user/user.model.js"
import AuthSession from "./auth.model.js"

const login = async ({ username, password }) => {
  const user = await User.findOne({
    where: { username },
  })

  if (!user) {
    throw new Error("Tài khoản hoặc mật khẩu không chính xác")
  }

  const isMatch = await bcrypt.compare(password, user.password_hash)
  if (!isMatch) {
    throw new Error("Tài khoản hoặc mật khẩu không chính xác")
  }

  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role_id,
    orgType: user.school_id ? "SCHOOL" : user.supplier_id ? "SUPPLIER" : "SYSTEM",
    orgId: user.school_id || user.supplier_id || "system",
  }

  const token = generateToken(payload)

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role_id,
      school_id: user.school_id,
      supplier_id: user.supplier_id,
    },
  }
}

const getProfile = async (userId) => {
  return await User.findByPk(userId, {
    attributes: { exclude: ["password_hash"] },
  })
}

const changePassword = async (userId, { old_password, new_password }) => {
  const user = await User.findByPk(userId)
  if (!user) throw new Error("Không tìm thấy người dùng")

  const isMatch = await bcrypt.compare(old_password, user.password_hash)
  if (!isMatch) throw new Error("Mật khẩu hiện tại không chính xác")

  const salt = await bcrypt.genSalt(10)
  user.password_hash = await bcrypt.hash(new_password, salt)
  await user.save()

  return true
}

const getAll = async ({ page = 1, limit = 20 } = {}) => {
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit)
  const { rows, count } = await AuthSession.findAndCountAll({
    limit: Number(limit),
    offset,
    order: [["created_at", "DESC"]],
  }).catch(() => ({ rows: [], count: 0 }))

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
  return await AuthSession.findByPk(id).catch(() => null)
}

const create = async (payload) => {
  return await AuthSession.create(payload).catch(() => payload)
}

const update = async (id, payload) => {
  const record = await AuthSession.findByPk(id).catch(() => null)
  if (!record) return null
  return await record.update(payload)
}

const remove = async (id) => {
  const record = await AuthSession.findByPk(id).catch(() => null)
  if (!record) return null
  await record.destroy()
  return true
}

const AuthService = {
  login,
  getProfile,
  changePassword,
  getAll,
  getById,
  create,
  update,
  remove,
}

export default AuthService
