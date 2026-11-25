import { z } from "zod";
import { HttpError } from "../../utils/http-error";

export const roundQuerySchema = z.strictObject({
  date: z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`)),
  batchNo: z.enum(["1", "2"]).transform(Number),
});
export const roundDishParamsSchema = z.strictObject({
  id: z.uuid(),
  dishId: z.uuid(),
});
export const roundApprovalSchema = z.strictObject({
  planVersion: z.string().regex(/^[a-f0-9]{32,64}$/),
});

export function validateRoundInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(400, "Dữ liệu kế hoạch không hợp lệ. Tải lại trang.");
  return parsed.data;
}
