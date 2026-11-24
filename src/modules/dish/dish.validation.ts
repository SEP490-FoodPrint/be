// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateDishListQuery } from "../../utils/list-query";

import { z } from "zod";
import {
  DISH_STANDARD_UNITS,
  standardQuantityIssue,
} from "../../utils/dish-portion";
import { DishCategory, DishMealType } from "../../generated/prisma/enums";
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
const positiveQuantity = (message: string) =>
  z
    .union([z.string(), z.number()])
    .transform(String)
    .refine(
      (v) => /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(v) && Number(v) > 0,
      { error: message },
    );
const gradeRecipeSchema = z.strictObject({
  gradeId: requestUuidSchema,
  portionQuantity: positiveQuantity(
    "Khẩu phần của khối phải dương, tối đa 3 chữ số thập phân",
  ),
});
export const dishRecipeWriteSchema = z
  .strictObject({
    gradeRecipes: z
      .array(gradeRecipeSchema)
      .max(100)
      .refine(
        (rows) => new Set(rows.map((row) => row.gradeId)).size === rows.length,
        { error: "Không khai báo trùng khối trong món" },
      )
      .optional(),
    standardQuantity: positiveQuantity(
      "Mốc chuẩn phải dương, tối đa 3 chữ số thập phân",
    ),
    standardUnit: z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(
        z.enum(DISH_STANDARD_UNITS, { error: "Mốc chuẩn chỉ dùng g hoặc ml" }),
      ),
    name: requiredText(255),
    mealType: z
      .enum(DishMealType, {
        error: "Bữa ăn phải là bữa trưa, bữa xế hoặc cả hai bữa",
      })
      .nullable()
      .optional(),
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
  })
  .superRefine((value, ctx) => {
    const issue = standardQuantityIssue(
      value.lines,
      value.standardQuantity,
      value.standardUnit,
    );
    if (issue)
      ctx.addIssue({
        code: "custom",
        path: ["standardQuantity"],
        message: issue,
      });
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
