import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import "../config/env";

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value?.trim()) throw new Error("Thiếu JWT_SECRET");
  return value;
}

export const signToken = (
  payload: JwtPayload,
  expiresIn: SignOptions["expiresIn"] = (process.env.JWT_EXPIRES_IN ||
    "15m") as SignOptions["expiresIn"],
): string =>
  jwt.sign(payload, secret(), {
    algorithm: "HS256",
    issuer: "foodprint",
    audience: "foodprint-api",
    expiresIn,
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

export const signRefreshToken = (
  payload: JwtPayload,
  expiresIn: SignOptions["expiresIn"] = "7d",
): string =>
  jwt.sign(payload, secret(), {
    algorithm: "HS256",
    issuer: "foodprint",
    audience: "foodprint-refresh",
    expiresIn,
  });

export const verifyRefreshToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, secret(), {
    algorithms: ["HS256"],
    issuer: "foodprint",
    audience: "foodprint-refresh",
  });
  if (typeof payload === "string")
    throw new Error("Refresh token payload không hợp lệ");
  return payload;
};
