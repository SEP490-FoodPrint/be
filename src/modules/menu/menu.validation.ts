import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";
import { paginationSchema } from "../../utils/directory-validation";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

const calendarDateSchema = z
  .string({ error: "Ngày phải có định dạng YYYY-MM-DD" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Ngày phải có định dạng YYYY-MM-DD" })
  .refine(
    (value) => {
      const date = new Date(value + "T00:00:00.000Z");
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    },
    { error: "Ngày không hợp lệ" },
  )
  .transform((value) => new Date(value + "T00:00:00.000Z"));
const mealTypeSchema = z.enum(["LUNCH", "AFTERNOON"], {
  error: "Ca ăn không hợp lệ",
});
const quantitySchema = z
  .union(
    [
      z.string({ error: "Định mức phải là số hoặc chuỗi số thập phân" }),
      z.number({ error: "Định mức phải là số hoặc chuỗi số thập phân" }),
    ],
    { error: "Định mức phải là số hoặc chuỗi số thập phân" },
  )
  .transform(String)
  .refine(
    (quantity) =>
      /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(quantity) &&
      new Prisma.Decimal(quantity).gt(0),
    {
      error:
        "Định mức phải dương, tối đa 11 chữ số nguyên và 3 chữ số thập phân",
    },
  );
const amountFields = {
  quantityPerPortion: quantitySchema,
  unit: requiredText(30).transform((value) => value.toLowerCase()),
};

function uniqueIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  field?: string,
  message = "Định mức bị trùng",
  pathPrefix: (string | number)[] = [],
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value))
      context.addIssue({
        code: "custom",
        message,
        path: field ? [...pathPrefix, index, field] : [...pathPrefix, index],
      });
    seen.add(value);
  });
}

const mainIngredientSchema = z.strictObject({
  ingredientId: requestUuidSchema,
  ...amountFields,
});
const mainIngredientsSchema = z
  .array(mainIngredientSchema, { error: "Danh sách nguyên liệu không hợp lệ" })
  .max(100, { error: "Tối đa 100 nguyên liệu cho mỗi món" })
  .superRefine((rows, context) =>
    uniqueIssues(
      rows.map((row) => row.ingredientId),
      context,
      "ingredientId",
    ),
  );
const seasoningSchema = z.strictObject({
  ingredientEntryId: requestUuidSchema,
  ...amountFields,
});
const seasoningsSchema = z
  .array(seasoningSchema, { error: "Danh sách gia vị không hợp lệ" })
  .max(100, { error: "Tối đa 100 dòng gia vị" })
  .superRefine((rows, context) =>
    uniqueIssues(
      rows.map((row) => row.ingredientEntryId),
      context,
      "ingredientEntryId",
    ),
  );

export const menuListQuerySchema = paginationSchema;
export const menuMealSchema = z.strictObject({
  menuDayId: requestUuidSchema,
  mealType: mealTypeSchema,
});
export const menuIngredientKindSchema = z.enum(["main", "seasoning"], {
  error: "Loại nguyên liệu không hợp lệ",
});
export const menuIdParamsSchema = z.strictObject({ menuId: requestUuidSchema });
export const menuSubmitSchema = z.strictObject({});
export const menuAcademicCalendarQuerySchema = z.strictObject({});
export const menuWeekScheduleQuerySchema = z.strictObject({
  menuId: requestUuidSchema.optional(),
  gradeIds: z
    .string()
    .transform((value) => value.split(","))
    .pipe(z.array(requestUuidSchema).min(1).max(100))
    .optional(),
  date: calendarDateSchema.default(
    () =>
      new Date(
        new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) +
          "T00:00:00.000Z",
      ),
  ),
});

const standardDishSchema = z.strictObject({
  dishId: requestUuidSchema,
  ingredients: mainIngredientsSchema.refine(
    (ingredients) => ingredients.length > 0,
    { error: "Mỗi món cần ít nhất một nguyên liệu chính" },
  ),
});
export const menuStandardsSchema = z.strictObject({
  dishes: z
    .array(standardDishSchema, { error: "Danh sách món không hợp lệ" })
    .min(1, { error: "Cần ít nhất một món" })
    .max(50, { error: "Tối đa 50 món" })
    .superRefine((dishes, context) => {
      uniqueIssues(
        dishes.map((dish) => dish.dishId),
        context,
        "dishId",
      );
      if (
        dishes.reduce((total, dish) => total + dish.ingredients.length, 0) >
        1000
      )
        context.addIssue({
          code: "custom",
          message: "Số dòng định mức không hợp lệ",
        });
    }),
  seasonings: seasoningsSchema,
});

const groupDishIdsSchema = z
  .array(requestUuidSchema, { error: "Danh sách món không hợp lệ" })
  .min(1, { error: "Nhóm phải có món" })
  .max(50, { error: "Tối đa 50 món trong nhóm" })
  .superRefine((ids, context) => uniqueIssues(ids, context));
const groupAvoidanceIdsSchema = z
  .array(requestUuidSchema, {
    error: "Danh sách nguyên liệu cần tránh không hợp lệ",
  })
  .max(100, { error: "Tối đa 100 nguyên liệu cần tránh" })
  .superRefine((ids, context) => uniqueIssues(ids, context));
const portionGroupSchema = z
  .strictObject({
    id: requestUuidSchema.optional(),
    name: requiredText(120),
    isDefault: z.boolean({ error: "isDefault phải là boolean" }),
    dishIds: groupDishIdsSchema,
    avoidedIngredientEntryIds: groupAvoidanceIdsSchema,
  })
  .superRefine((group, context) => {
    if (
      group.isDefault
        ? group.avoidedIngredientEntryIds.length > 0
        : group.avoidedIngredientEntryIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["avoidedIngredientEntryIds"],
        message:
          "Nhóm thường không nhận nguyên liệu cần tránh; nhóm riêng cần khai báo nguyên liệu cần tránh",
      });
    }
  })
  .transform((group) => ({
    id: group.id,
    name: group.name,
    isDefault: group.isDefault,
    dishIds: group.dishIds,
    avoidedIngredientEntryIds: group.avoidedIngredientEntryIds,
  }));
export const menuPortionGroupsSchema = z.strictObject({
  groups: z
    .array(portionGroupSchema, { error: "Danh sách nhóm suất không hợp lệ" })
    .max(30, { error: "Tối đa 30 nhóm suất" })
    .superRefine((groups, context) => {
      const seenIds = new Set<string>();
      groups.forEach((group, index) => {
        if (group.id && seenIds.has(group.id))
          context.addIssue({
            code: "custom",
            path: [index, "id"],
            message: "Nhóm suất bị trùng",
          });
        if (group.id) seenIds.add(group.id);
      });
      uniqueIssues(
        groups.map((group) => group.name),
        context,
        "name",
        "Tên nhóm suất bị trùng",
      );
      if (
        groups.length > 0 &&
        groups.filter((group) => group.isDefault).length !== 1
      )
        context.addIssue({
          code: "custom",
          message: "Cần đúng một nhóm suất thường",
        });
    }),
});

const writeDishSchema = z
  .strictObject({
    dishId: requestUuidSchema.optional(),
    name: requiredText(255).optional(),
    ingredients: mainIngredientsSchema
      .nullish()
      .transform((value) => value ?? []),
  })
  .superRefine((dish, context) => {
    if ((dish.dishId === undefined) === (dish.name === undefined))
      context.addIssue({
        code: "custom",
        path: ["dishId"],
        message: "Chọn dishId hoặc nhập tên món mới",
      });
  })
  .transform((dish) => ({
    dishId: dish.dishId,
    name: dish.name,
    ingredients: dish.ingredients,
  }));
const writeMealSchema = z.strictObject({
  useDishRecipes: z.boolean().optional(),
  portionGroups: menuPortionGroupsSchema.shape.groups.optional(),
  mealType: mealTypeSchema,
  dishes: z
    .array(writeDishSchema, { error: "Danh sách món không hợp lệ" })
    .min(1, { error: "Bữa ăn cần ít nhất một món" })
    .max(50, { error: "Tối đa 50 món trong bữa" })
    .superRefine((dishes, context) =>
      uniqueIssues(
        dishes.map((dish) => dish.dishId ?? `name:${dish.name}`),
        context,
      ),
    ),
  seasonings: seasoningsSchema.nullish().transform((value) => value ?? []),
});
const writeDaySchema = z.strictObject({
  menuDate: calendarDateSchema.refine(
    (date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6,
    { error: "Thực đơn bán trú chỉ áp dụng từ Thứ Hai đến Thứ Sáu" },
  ),
  note: requiredText(2000)
    .nullish()
    .transform((value) => value ?? null),
  meals: z
    .array(writeMealSchema, { error: "Danh sách bữa ăn không hợp lệ" })
    .min(1, { error: "Ngày thực đơn cần ít nhất một bữa" })
    .max(2, { error: "Tối đa hai bữa ăn mỗi ngày" })
    .superRefine((meals, context) =>
      uniqueIssues(
        meals.map((meal) => meal.mealType),
        context,
        "mealType",
        "Ca ăn bị trùng",
      ),
    ),
});
export const menuWriteSchema = z
  .strictObject({
    weekStartDate: calendarDateSchema,
    gradeIds: z
      .array(requestUuidSchema)
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    title: requiredText(255)
      .nullish()
      .transform((value) => value ?? null),
    days: z
      .array(writeDaySchema, { error: "Danh sách ngày thực đơn không hợp lệ" })
      .min(1, { error: "Cần ít nhất một ngày thực đơn" })
      .max(7, { error: "Tối đa bảy ngày trong thực đơn" }),
  })
  .superRefine((menu, context) => {
    if (menu.weekStartDate.getUTCDay() !== 1)
      context.addIssue({
        code: "custom",
        path: ["weekStartDate"],
        message: "Ngày bắt đầu tuần phải là thứ Hai",
      });
    uniqueIssues(
      menu.days.map((day) => day.menuDate.toISOString()),
      context,
      "menuDate",
      "Ngày thực đơn bị trùng",
      ["days"],
    );
    menu.days.forEach((day, index) => {
      if (
        day.menuDate < menu.weekStartDate ||
        day.menuDate.getTime() >= menu.weekStartDate.getTime() + 7 * 86400000
      )
        context.addIssue({
          code: "custom",
          path: ["days", index, "menuDate"],
          message: "Ngày thực đơn phải thuộc tuần đã chọn",
        });
    });
    const lines = menu.days
      .flatMap((day) => day.meals)
      .reduce(
        (total, meal) =>
          total +
          meal.seasonings.length +
          meal.dishes.reduce((sum, dish) => sum + dish.ingredients.length, 0),
        0,
      );
    if (lines > 2000)
      context.addIssue({
        code: "custom",
        path: ["days"],
        message: "Số dòng thực đơn không hợp lệ",
      });
  });

export const menuReviewSchema = z
  .strictObject({
    menuDayId: requestUuidSchema.nullish().transform((value) => value ?? null),
    decision: z.enum(["APPROVED", "REVISION_REQUESTED"], {
      error: "Quyết định duyệt không hợp lệ",
    }),
    feedback: z
      .union([z.literal("").transform(() => null), requiredText(2000)])
      .optional()
      .transform((value) => value ?? null),
  })
  .superRefine((review, context) => {
    if (review.decision === "REVISION_REQUESTED" && !review.feedback)
      context.addIssue({
        code: "custom",
        path: ["feedback"],
        message: "Cần nêu lý do yêu cầu chỉnh sửa",
      });
  });
export const menuFiltersSchema = paginationSchema
  .safeExtend({
    date: calendarDateSchema.optional(),
    weekStartDate: calendarDateSchema.optional(),
    status: z
      .enum(["DRAFT", "PENDING_APPROVAL", "REVISION_REQUIRED", "APPROVED"], {
        error: "Trạng thái thực đơn không hợp lệ",
      })
      .optional(),
    search: z
      .string({ error: "Từ khóa phải là văn bản" })
      .trim()
      .max(100, { error: "Từ khóa tìm kiếm tối đa 100 ký tự" })
      .transform((value) => value || undefined)
      .optional(),
  })
  .transform((query) => ({
    page: query.page,
    limit: query.limit,
    date: query.date,
    weekStartDate: query.weekStartDate,
    status: query.status,
    search: query.search,
  }));
export const menuAllergyCheckSchema = z.strictObject({
  gradeIds: z
    .array(requestUuidSchema)
    .min(1)
    .max(100)
    .superRefine((ids, context) => uniqueIssues(ids, context))
    .optional(),
  ingredientIds: z
    .array(requestUuidSchema, { error: "Danh sách nguyên liệu không hợp lệ" })
    .min(1, { error: "Cần chọn ít nhất một nguyên liệu" })
    .max(100, { error: "Tối đa 100 nguyên liệu" })
    .superRefine((ids, context) => uniqueIssues(ids, context)),
});

export const validateMenuListQuery = (value: unknown) =>
  parseRequest(menuListQuerySchema, value);
export const validateMenuMeal = (menuDayId: unknown, mealType: unknown) =>
  parseRequest(menuMealSchema, { menuDayId, mealType });
export const validateMenuStandards = (value: unknown) =>
  parseRequest(menuStandardsSchema, value);
export const validateMenuPortionGroups = (value: unknown) =>
  parseRequest(menuPortionGroupsSchema, value);
export const validateMenuIngredientKind = (value: unknown) =>
  parseRequest(menuIngredientKindSchema, value);
export const validateMenuWrite = (value: unknown) =>
  parseRequest(menuWriteSchema, value);
export const validateMenuReview = (value: unknown) =>
  parseRequest(menuReviewSchema, value);
export const validateMenuFilters = (value: unknown) =>
  parseRequest(menuFiltersSchema, value);
export const validateAllergyCheck = (value: unknown) =>
  parseRequest(menuAllergyCheckSchema, value);
export const validateMenuWeekSchedule = (value: unknown) =>
  parseRequest(menuWeekScheduleQuerySchema, value);
export const validateMenuAcademicCalendar = (value: unknown) =>
  parseRequest(menuAcademicCalendarQuerySchema, value);
export const validateMenuIdParams = (value: unknown) =>
  parseRequest(menuIdParamsSchema, value);
export const validateMenuSubmit = (value: unknown) =>
  parseRequest(menuSubmitSchema, value ?? {});

export type MenuMeal = z.infer<typeof menuMealSchema>;
export type MenuStandardsInput = z.infer<typeof menuStandardsSchema>;
export type MenuWrite = z.infer<typeof menuWriteSchema>;
export type MenuReviewInput = z.infer<typeof menuReviewSchema>;
export type MenuFilters = z.infer<typeof menuFiltersSchema>;
export type MenuPortionGroupsInput = z.infer<typeof menuPortionGroupsSchema>;
