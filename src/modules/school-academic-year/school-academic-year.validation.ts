import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
  requiredText,
} from "../../utils/request-validation";
import { academicYearEnd } from "../class/academic-year";

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
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  reason: requiredText(255),
});

const holidaysSchema = z
  .array(holidaySchema, { error: "Danh sách ngày nghỉ phải là một mảng" })
  .max(100, "Danh sách kỳ nghỉ không được vượt quá 100 khoảng");

function validateRangeAndHolidays(
  value: {
    startDate: string;
    endDate: string;
    holidays: Array<{ startDate: string; endDate: string }>;
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
  value.holidays.forEach((holiday, index) => {
    if (holiday.startDate > holiday.endDate) {
      context.addIssue({
        code: "custom",
        path: ["holidays", index, "endDate"],
        message: "Ngày kết thúc kỳ nghỉ phải bằng hoặc sau ngày bắt đầu",
      });
    }
    if (
      holiday.startDate < value.startDate ||
      holiday.endDate > value.endDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["holidays", index, "startDate"],
        message: "Kỳ nghỉ phải nằm trong khoảng niên khóa",
      });
    }
    value.holidays.slice(0, index).forEach((existing) => {
      if (
        holiday.startDate <= existing.endDate &&
        holiday.endDate >= existing.startDate
      ) {
        context.addIssue({
          code: "custom",
          path: ["holidays", index, "startDate"],
          message: "Kỳ nghỉ bị trùng với một khoảng đã khai báo",
        });
      }
    });
  });
}

const academicYearLabelSchema = requiredText(30).refine(
  (value) => academicYearEnd(value) !== null,
  "Niên khóa phải có dạng N-N+1, ví dụ 2026-2027",
);

export const createAcademicYearBodySchema = z
  .strictObject({
    academicYear: academicYearLabelSchema,
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
