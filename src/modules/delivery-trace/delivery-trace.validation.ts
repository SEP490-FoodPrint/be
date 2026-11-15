import { z } from "zod";
import { HttpError } from "../../utils/http-error";
import { parseRequest } from "../../utils/request-validation";

export const PUBLIC_TRACE_NOT_FOUND_MESSAGE =
  "Không tìm thấy thông tin truy xuất nguyên liệu";

export const publicDeliveryTraceParamsSchema = z.strictObject({
  token: z
    .string({ error: PUBLIC_TRACE_NOT_FOUND_MESSAGE })
    .trim()
    .regex(/^[0-9a-f]{64}$/i, { error: PUBLIC_TRACE_NOT_FOUND_MESSAGE })
    .transform((value) => value.toLowerCase()),
});

export const publicDeliveryTraceQuerySchema = z.strictObject({});

export function validatePublicDeliveryTraceParams(value: unknown) {
  const result = publicDeliveryTraceParamsSchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(404, PUBLIC_TRACE_NOT_FOUND_MESSAGE);
  }
  return result.data;
}

export function validatePublicDeliveryTraceQuery(value: unknown) {
  return parseRequest(publicDeliveryTraceQuerySchema, value);
}
