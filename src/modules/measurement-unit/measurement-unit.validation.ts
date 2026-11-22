import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";
export const normalizedUnitText = (value: string) =>
  value.trim().normalize("NFC").toLowerCase();
const token = requiredText(30)
  .transform(normalizedUnitText)
  .refine(
    (v) =>
      !Array.from(v).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ),
    "Đơn vị không hợp lệ",
  );
export const unitQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: requiredText(100).optional(),
  group: z.enum(["MASS", "VOLUME", "COUNT", "OTHER"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE"),
});
export const unitParamsSchema = z.strictObject({ id: requestUuidSchema });
export const unitCreateSchema = z.strictObject({
  code: token.refine(
    (v) => /^[a-z0-9][a-z0-9_-]*$/.test(v),
    "Mã chỉ gồm chữ thường, số, gạch nối hoặc gạch dưới",
  ),
  name: requiredText(100),
  symbol: token,
  group: z.enum(["MASS", "VOLUME", "COUNT", "OTHER"]),
  aliases: z.array(token).max(30).default([]),
});
export const unitUpdateSchema = z
  .strictObject({
    name: requiredText(100).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Phải gửi ít nhất một trường cần sửa",
  );
export const validateUnitQuery = (v: unknown) =>
  parseRequest(unitQuerySchema, v);
export const validateUnitParams = (v: unknown) =>
  parseRequest(unitParamsSchema, v);
export const validateUnitCreate = (v: unknown) =>
  parseRequest(unitCreateSchema, v);
export const validateUnitUpdate = (v: unknown) =>
  parseRequest(unitUpdateSchema, v);
