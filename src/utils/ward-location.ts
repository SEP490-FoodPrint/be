/**
 * Phường/xã trong mô hình địa giới 2 cấp (tỉnh → phường/xã): `Location.level = 2`.
 * Dùng chung cho hồ sơ đăng ký, gắn địa bàn trường/NCC và đơn vị ATTP (specs/authority-officer-accounts).
 */
import type { Prisma } from "../generated/prisma/client";
import { RequestValidationError } from "./request-validation";

export const WARD_LOCATION_LEVEL = 2;

export const wardLocationSelect = {
  id: true,
  code: true,
  name: true,
  level: true,
  isActive: true,
} as const satisfies Prisma.LocationSelect;

export type WardLocationRow = Prisma.LocationGetPayload<{
  select: typeof wardLocationSelect;
}>;

export interface WardLocationDTO {
  id: string;
  code: string;
  name: string;
}

export function isActiveWard(
  location: Pick<WardLocationRow, "level" | "isActive"> | null | undefined,
): boolean {
  return Boolean(location?.isActive && location.level === WARD_LOCATION_LEVEL);
}

/** `400` theo trường `field` khi không phải phường/xã đang hoạt động. */
export function assertActiveWard(
  location: WardLocationRow | null | undefined,
  field = "locationId",
): WardLocationDTO {
  if (!location || !isActiveWard(location))
    throw new RequestValidationError([
      { field, message: "Địa bàn phải là phường/xã đang hoạt động" },
    ]);
  return toWardLocation(location);
}

export function toWardLocation(
  location: Pick<WardLocationRow, "id" | "code" | "name">,
): WardLocationDTO {
  return { id: location.id, code: location.code, name: location.name };
}
