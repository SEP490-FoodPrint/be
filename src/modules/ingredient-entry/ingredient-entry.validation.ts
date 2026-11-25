import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateIngredientEntryListQuery } from "../../utils/list-query";

export const ingredientWasteRateParamsSchema = z.strictObject({
  ingredientEntryId: requestUuidSchema.refine((value) => value.length === 36, {
    error: "Mục đã chọn không hợp lệ.",
  }),
});

/** Tỷ lệ hao hụt dạng thập phân (20% = 0.2): 0 <= r < 1, tối đa 4 chữ số thập phân. */
export const ingredientWasteRateBodySchema = z.strictObject({
  wasteRate: z
    .number({ error: "Tỷ lệ hao hụt phải là số" })
    .refine(Number.isFinite, { error: "Tỷ lệ hao hụt phải là số" })
    .refine((value) => value >= 0 && value < 1, {
      error: "Tỷ lệ hao hụt phải từ 0% đến dưới 100%",
    })
    .refine(
      (value) => Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-6,
      { error: "Tỷ lệ hao hụt chỉ nhận tối đa 2 chữ số thập phân theo %" },
    )
    .transform((value) => (Math.round(value * 10000) / 10000).toFixed(4)),
});

export const validateIngredientWasteRateParams = (value: unknown) =>
  parseRequest(ingredientWasteRateParamsSchema, value);
export const validateIngredientWasteRateBody = (value: unknown) =>
  parseRequest(ingredientWasteRateBodySchema, value);
