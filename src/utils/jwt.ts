import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import "../config/env";
function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value?.trim()) throw new Error("Thiếu JWT_SECRET");
  return value;
}
export const signToken = (payload: JwtPayload): string =>
  jwt.sign(payload, secret(), {
    algorithm: "HS256",
    issuer: "foodprint",
    audience: "foodprint-api",
    expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as SignOptions["expiresIn"],
  });
export const verifyToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, secret(), {
    algorithms: ["HS256"],
    issuer: "foodprint",
    audience: "foodprint-api",
  });
  if (typeof payload === "string") throw new Error("JWT payload không hợp lệ");
  return payload;
};
