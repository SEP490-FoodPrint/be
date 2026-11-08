import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export const dateOnlySchema = z
  .string({ error: "Ngày phải là chuỗi YYYY-MM-DD" })
  .refine(isCalendarDate, "Ngày không hợp lệ, cần dùng định dạng YYYY-MM-DD");

export const holidaySchema = z.strictObject({
  date: dateOnlySchema,
  reason: requiredText(255),
});

const holidaysSchema = z
  .array(holidaySchema, { error: "Danh sách ngày nghỉ phải là một mảng" })
  .max(366, "Danh sách ngày nghỉ không được vượt quá 366 ngày");

function validateRangeAndHolidays(
  value: {
    startDate: string;
    endDate: string;
    holidays: Array<{ date: string }>;
  },
  context: z.RefinementCtx,
) {
  if (value.startDate > value.endDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "Ngày kết thúc phải bằng hoặc sau ngày bắt đầu",
    });
  }
  const seen = new Set<string>();
  value.holidays.forEach((holiday, index) => {
    if (seen.has(holiday.date)) {
      context.addIssue({
        code: "custom",
        path: ["holidays", index, "date"],
        message: "Ngày nghỉ bị trùng",
      });
    }
    seen.add(holiday.date);
    if (holiday.date < value.startDate || holiday.date > value.endDate) {
      context.addIssue({
        code: "custom",
        path: ["holidays", index, "date"],
        message: "Ngày nghỉ phải nằm trong khoảng niên khóa",
      });
    }
  });
}

export const createAcademicYearBodySchema = z
  .strictObject({
    academicYear: requiredText(30),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    holidays: holidaysSchema.default([]),
  })
  .superRefine(validateRangeAndHolidays);

export const updateAcademicYearBodySchema = z
  .strictObject({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    holidays: holidaysSchema,
  })
  .superRefine(validateRangeAndHolidays);

export const academicYearIdParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

export const validateCreateAcademicYear = (value: unknown) =>
  parseRequest(createAcademicYearBodySchema, value);
export const validateUpdateAcademicYear = (value: unknown) =>
  parseRequest(updateAcademicYearBodySchema, value);
export const validateAcademicYearId = (value: unknown) =>
  parseRequest(academicYearIdParamsSchema, value).id;
