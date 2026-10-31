import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import "../config/env";
import { readAuthConfig } from "../config/auth";
export function requireJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value?.trim() || value === "replace-with-a-unique-random-secret")
    throw new Error("Cần JWT_SECRET riêng, không dùng placeholder");
  return value;
}
export const signToken = (
  payload: JwtPayload,
  expiresIn: SignOptions["expiresIn"] = readAuthConfig().accessTtlSeconds,
): string =>
  jwt.sign(payload, requireJwtSecret(), {
    algorithm: "HS256",
    issuer: "foodprint",
    audience: "foodprint-api",
    expiresIn,
  });
export const verifyToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, requireJwtSecret(), {
    algorithms: ["HS256"],
    issuer: "foodprint",
    audience: "foodprint-api",
  });
  if (typeof payload === "string") throw new Error("JWT payload không hợp lệ");
  return payload;
};
