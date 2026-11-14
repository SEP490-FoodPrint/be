import { z } from "zod";

export const traceParamsSchema = z.strictObject({
  mealAllocationId: z.string().uuid(),
});

export const verifyParamsSchema = z.strictObject({
  anchorId: z.string().uuid(),
});

export const searchTraceQuerySchema = z.strictObject({
  keyword: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
