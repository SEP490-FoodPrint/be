import { parse } from "cookie";
import type { CookieOptions, Request, Response } from "express";
import { readAuthConfig, type AuthConfig } from "../config/auth";
import { HttpError } from "./http-error";

export const ACCESS_COOKIE = "foodprint_access";
export const REFRESH_COOKIE = "foodprint_refresh";

export function readAuthCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  if (
    header.split(";").filter((part) => part.trim().split("=")[0] === name)
      .length > 1
  ) {
    throw new HttpError(401, "Cookie xác thực không hợp lệ");
  }
  return parse(header)[name];
}

export function readAccessToken(req: Request): string | undefined {
  const cookie = readAuthCookie(req, ACCESS_COOKIE);
  if (cookie !== undefined) return cookie;
  if (req.headers.authorization === undefined) return undefined;
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization);
  if (!match) throw new HttpError(401, "Thông tin xác thực không hợp lệ");
  return match[1];
}

function options(path: string, config: AuthConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path,
  };
}

export function setAuthCookies(
  res: Response,
  tokens: {
    accessToken: string;
    refreshToken: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  },
  config = readAuthConfig(),
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...options("/api", config),
    maxAge: tokens.accessTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...options("/api/auth", config),
    maxAge: tokens.refreshTtlSeconds * 1000,
  });
  res.setHeader("Cache-Control", "no-store");
}

export function clearAuthCookies(
  res: Response,
  config = readAuthConfig(),
): void {
  res.clearCookie(ACCESS_COOKIE, options("/api", config));
  res.clearCookie(REFRESH_COOKIE, options("/api/auth", config));
  res.setHeader("Cache-Control", "no-store");
}
