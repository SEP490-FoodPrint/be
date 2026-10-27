import { sendError } from "../../utils/response.js"

export const validateLogin = (req, res, next) => {
  const { username, password } = req.body
  const errors = []
  if (!username) errors.push("Tên đăng nhập (username) là bắt buộc")
  if (!password) errors.push("Mật khẩu (password) là bắt buộc")

  if (errors.length > 0) {
    return sendError(res, "Thông tin đăng nhập không hợp lệ", 400, errors)
  }
  next()
}

export const validateRegister = (req, res, next) => {
  const { username, password, full_name, email } = req.body
  const errors = []
  if (!username) errors.push("Tên đăng nhập là bắt buộc")
  if (!password) errors.push("Mật khẩu là bắt buộc")
  if (!full_name) errors.push("Họ và tên là bắt buộc")

  if (errors.length > 0) {
    return sendError(res, "Thông tin đăng ký không hợp lệ", 400, errors)
  }
  next()
}

export const validateChangePassword = (req, res, next) => {
  const { old_password, new_password } = req.body
  const errors = []
  if (!old_password) errors.push("Mật khẩu hiện tại là bắt buộc")
  if (!new_password) errors.push("Mật khẩu mới là bắt buộc")
  if (new_password && new_password.length < 6) errors.push("Mật khẩu mới phải có ít nhất 6 ký tự")

  if (errors.length > 0) {
    return sendError(res, "Dữ liệu đổi mật khẩu không hợp lệ", 400, errors)
  }
  next()
}

export const validateCreate = validateRegister
export const validateUpdate = validateChangePassword
