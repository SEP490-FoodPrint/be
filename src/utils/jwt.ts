import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import "../config/env";

const JWT_SECRET = process.env.JWT_SECRET || "foodprint_jwt_secret_key_2026";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
};

export const verifyToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, JWT_SECRET);
  if (typeof payload === "string") throw new Error("JWT payload không hợp lệ");
  return payload;
};
