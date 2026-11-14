// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateDishListQuery } from "../../utils/list-query";

import { z } from "zod";
import { DishCategory } from "../../generated/prisma/enums";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

const recipeLineSchema = z.strictObject({
  ingredientEntryId: requestUuidSchema,
  ingredientRole: z.enum(["MAIN", "SEASONING"]),
  requiredQuantity: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine(
      (v) => /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(v) && Number(v) > 0,
      { error: "Định lượng phải dương, tối đa 3 chữ số thập phân" },
    ),
  unit: requiredText(30).transform((v) => v.toLowerCase()),
});
const gradeRecipeSchema = z.strictObject({
  gradeId: requestUuidSchema,
  lines: z
    .array(recipeLineSchema)
    .min(1)
    .max(100)
    .refine(
      (rows) =>
        rows.some((row) => row.ingredientRole === "MAIN") &&
        new Set(rows.map((row) => row.ingredientEntryId)).size === rows.length,
    ),
});
export const dishRecipeWriteSchema = z.strictObject({
  gradeRecipes: z
    .array(gradeRecipeSchema)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.gradeId)).size === rows.length,
    )
    .optional(),
  name: requiredText(255),
  category: z
    .union([requestUuidSchema, z.enum(DishCategory)])
    .nullable()
    .optional(),
  description: requiredText(4000).nullable().optional(),
  lines: z
    .array(recipeLineSchema)
    .min(1)
    .max(100)
    .superRefine((rows, ctx) => {
      if (new Set(rows.map((r) => r.ingredientEntryId)).size !== rows.length)
        ctx.addIssue({
          code: "custom",
          message: "Không khai báo trùng nguyên liệu trong món",
        });
      if (!rows.some((r) => r.ingredientRole === "MAIN"))
        ctx.addIssue({
          code: "custom",
          message: "Món phải có nguyên liệu chính",
        });
    }),
});
export const dishCategoryWriteSchema = z.strictObject({
  name: requiredText(255),
});
export const validateDishCategory = (value: unknown) =>
  parseRequest(dishCategoryWriteSchema, value);
export const recipeSelectionSchema = z.strictObject({
  gradeIds: z
    .array(requestUuidSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
  dishIds: z
    .array(requestUuidSchema)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, {
      error: "Trùng món trong bữa",
    }),
});
export const validateDishRecipe = (value: unknown) =>
  parseRequest(dishRecipeWriteSchema, value);
export const validateRecipeSelection = (value: unknown) =>
  parseRequest(recipeSelectionSchema, value);
