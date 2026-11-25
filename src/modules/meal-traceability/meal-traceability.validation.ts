import { z } from "zod";

/**
 * Tra cứu theo đúng một bữa của một lớp: hoặc `mealAllocationId`, hoặc đủ bộ
 * `classId + date + mealType`. Thiếu tham số không được rơi về "bản ghi mới nhất".
 */
export const getMealTraceabilitySchema = z
  .strictObject({
    classId: z
      .string()
      .uuid("classId phải là định dạng UUID hợp lệ")
      .optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ.")
      .optional(),
    mealType: z.enum(["LUNCH", "AFTERNOON"]).optional(),
    mealAllocationId: z
      .string()
      .uuid("mealAllocationId phải là định dạng UUID hợp lệ")
      .optional(),
    schoolCode: z.string().trim().min(1).max(80).optional(),
    verify: z
      .preprocess((val) => val === "true" || val === true, z.boolean())
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mealAllocationId) return;
    for (const key of ["classId", "date", "mealType"] as const)
      if (!value[key])
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `Cần ${key} (hoặc mealAllocationId) để tra cứu suất ăn`,
        });
  });

export const publicSchoolClassesParamsSchema = z.strictObject({
  schoolCode: z.string().trim().min(1).max(80),
});

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
