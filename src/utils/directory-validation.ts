import { z } from "zod";
import { parseRequest, requestUuidSchema } from "./request-validation";

const positiveInteger = (fallback: number) =>
  z
    .string({ error: "Giá trị phải là số nguyên dương" })
    .regex(/^[1-9]\d*$/, { error: "Giá trị phải là số nguyên dương" })
    .transform(Number)
    .refine(Number.isSafeInteger, { error: "Số vượt giới hạn cho phép" })
    .default(fallback);
export const paginationSchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
  })
  .refine(({ page, limit }) => (page - 1) * limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });
/** `hasLocation=false`: tổ chức chưa gắn phường/xã (specs/authority-officer-accounts FR-012). */
export const hasLocationSchema = z
  .enum(["true", "false"], { error: "hasLocation phải là true hoặc false" })
  .transform((value) => value === "true")
  .optional();
export const emptyQuerySchema = z.strictObject({});
export const idParamsSchema = z.strictObject({ id: requestUuidSchema });
export const parse = parseRequest;
