import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()

const JWT_SECRET = process.env.JWT_SECRET || "foodprint_jwt_secret_key_2026"
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d"

export const signToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export const generateToken = signToken

export const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET)
}
