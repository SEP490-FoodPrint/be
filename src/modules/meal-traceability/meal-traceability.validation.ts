import { z } from "zod";

export const getMealTraceabilitySchema = z.strictObject({
  classId: z.string().uuid("classId phải là định dạng UUID hợp lệ").optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date phải có định dạng YYYY-MM-DD")
    .optional(),
  mealType: z.enum(["LUNCH", "AFTERNOON"]).optional(),
  mealAllocationId: z
    .string()
    .uuid("mealAllocationId phải là định dạng UUID hợp lệ")
    .optional(),
  verify: z
    .preprocess((val) => val === "true" || val === true, z.boolean())
    .optional(),
});
