import { z } from "zod";
import {
  emptyQuerySchema,
  paginationSchema,
} from "../../utils/directory-validation";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

export const MAX_SUPPLIER_RESPONSE_LENGTH = 5000;

export const ingredientQualityFeedbackListQuerySchema = paginationSchema;

export const ingredientQualityFeedbackParamsSchema = z.strictObject({
  feedbackId: requestUuidSchema,
});

export const ingredientQualityFeedbackEmptyQuerySchema = emptyQuerySchema;

export const ingredientQualityFeedbackResponseBodySchema = z.strictObject({
  supplierResponse: z
    .string({ error: "Phản hồi nhà cung cấp phải là văn bản" })
    .transform((value) => value.trim())
    .refine((value) => Array.from(value).length >= 1, {
      error: "Phản hồi nhà cung cấp không được để trống",
    })
    .refine(
      (value) => Array.from(value).length <= MAX_SUPPLIER_RESPONSE_LENGTH,
      {
        error: `Phản hồi nhà cung cấp chỉ nhận tối đa ${MAX_SUPPLIER_RESPONSE_LENGTH} ký tự`,
      },
    ),
});

export const validateIngredientQualityFeedbackListQuery = (value: unknown) =>
  parseRequest(
    ingredientQualityFeedbackListQuerySchema,
    value === undefined ? {} : value,
  );

export const validateIngredientQualityFeedbackParams = (value: unknown) =>
  parseRequest(ingredientQualityFeedbackParamsSchema, value);

export const validateIngredientQualityFeedbackEmptyQuery = (value: unknown) =>
  parseRequest(
    ingredientQualityFeedbackEmptyQuerySchema,
    value === undefined ? {} : value,
  );

export const validateIngredientQualityFeedbackResponseBody = (value: unknown) =>
  parseRequest(ingredientQualityFeedbackResponseBodySchema, value);
