import { z } from "zod";
import {
  parseRequest,
  requiredText,
  requestUuidSchema,
} from "../../utils/request-validation";

const imageReference = requiredText(2048).refine(
  (value) => {
    if (
      Array.from(value).some(
        (char) =>
          char.charCodeAt(0) < 32 ||
          char.charCodeAt(0) === 127 ||
          char === "\\",
      )
    )
      return false;
    if (value.startsWith("/")) return !value.startsWith("//");
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  },
  { error: "Ảnh phải là URL HTTP/HTTPS hoặc đường dẫn ảnh hợp lệ" },
);

const fields = {
  name: requiredText(255),
  defaultUnit: requiredText(30),
  description: z.string({ error: "Mô tả phải là văn bản" }).nullable(),
  categoryId: requestUuidSchema.nullable(),
  coverImage: imageReference.nullable(),
  imageDescription: z.array(imageReference, {
    error: "Ảnh mô tả phải là danh sách ảnh",
  }),
};
export const ingredientCreateSchema = z.strictObject({
  name: fields.name,
  defaultUnit: fields.defaultUnit,
  description: fields.description.default(null),
  categoryId: fields.categoryId.default(null),
  coverImage: fields.coverImage.default(null),
  imageDescription: fields.imageDescription.default([]),
});
export const ingredientUpdateSchema = z
  .strictObject(fields)
  .partial()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: "Phải gửi ít nhất một trường cần sửa",
  });
const positiveInteger = (fallback: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine(Number.isSafeInteger, { error: "Số vượt giới hạn cho phép" })
    .default(fallback);
export const ingredientQuerySchema = z
  .strictObject({
    page: positiveInteger(1),
    limit: positiveInteger(20).refine((v) => v <= 100, {
      error: "limit tối đa 100",
    }),
  })
  .refine((v) => (v.page - 1) * v.limit <= 2147483647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });
export const ingredientParamsSchema = z.strictObject({
  ingredientId: requestUuidSchema,
});
export const ingredientHideSchema = z.strictObject({});
export const validateIngredientCreate = (value: unknown) =>
  parseRequest(ingredientCreateSchema, value);
export const validateIngredientUpdate = (value: unknown) =>
  parseRequest(ingredientUpdateSchema, value);
export const validateIngredientQuery = (value: unknown) =>
  parseRequest(ingredientQuerySchema, value);
export const validateIngredientParams = (value: unknown) =>
  parseRequest(ingredientParamsSchema, value);
export const validateIngredientHide = (value: unknown) =>
  parseRequest(ingredientHideSchema, value === undefined ? {} : value);
export { parseListQuery as validateIngredientListQuery } from "../../utils/list-query";
