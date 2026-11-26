import { z } from "zod";

/** Truy xuất chung một bữa của cả khối: mọi lớp của khối trong ngày và bữa đó. */
export const getGradeMealTraceabilitySchema = z.strictObject({
  gradeId: z.string().uuid("gradeId phải là định dạng UUID hợp lệ"),
  date: z.iso.date("date phải là ngày hợp lệ theo định dạng YYYY-MM-DD"),
  mealType: z.enum(["LUNCH", "AFTERNOON"], {
    message: "Bữa ăn không hợp lệ.",
  }),
  schoolCode: z.string().trim().min(1).max(80).optional(),
  verify: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .optional(),
});
