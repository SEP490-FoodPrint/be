import AuthService from "./auth.service.js"
import { sendSuccess, sendError } from "../../utils/response.js"

const login = async (req, res, next) => {
  try {
    const data = await AuthService.login(req.body)
    return sendSuccess(res, data, "Đăng nhập thành công")
  } catch (error) {
    return sendError(res, error.message, 401)
  }
}

const getProfile = async (req, res, next) => {
  try {
    const data = await AuthService.getProfile(req.user.userId)
    return sendSuccess(res, data, "Lấy thông tin cá nhân thành công")
  } catch (error) {
    next(error)
  }
}

const changePassword = async (req, res, next) => {
  try {
    await AuthService.changePassword(req.user.userId, req.body)
    return sendSuccess(res, null, "Đổi mật khẩu thành công")
  } catch (error) {
    return sendError(res, error.message, 400)
  }
}

const logout = async (req, res, next) => {
  return sendSuccess(res, null, "Đăng xuất thành công")
}

const getAll = async (req, res, next) => {
  try {
    const data = await AuthService.getAll(req.query)
    return sendSuccess(res, data, "Lấy danh sách phiên đăng nhập thành công")
  } catch (error) {
    next(error)
  }
}

const getById = async (req, res, next) => {
  try {
    const data = req.sessionRecord || (await AuthService.getById(req.params.id))
    return sendSuccess(res, data, "Lấy chi tiết phiên thành công")
  } catch (error) {
    next(error)
  }
}

const create = async (req, res, next) => {
  try {
    const data = await AuthService.create(req.body)
    return sendSuccess(res, data, "Tạo phiên thành công", 201)
  } catch (error) {
    next(error)
  }
}

const update = async (req, res, next) => {
  try {
    const data = await AuthService.update(req.params.id, req.body)
    return sendSuccess(res, data, "Cập nhật phiên thành công")
  } catch (error) {
    next(error)
  }
}

const remove = async (req, res, next) => {
  try {
    await AuthService.remove(req.params.id)
    return sendSuccess(res, null, "Hủy phiên thành công")
  } catch (error) {
    next(error)
  }
}

const AuthController = {
  login,
  getProfile,
  changePassword,
  logout,
  getAll,
  getById,
  create,
  update,
  remove,
}

export default AuthController
