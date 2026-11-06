import { z } from "zod";
import { HttpError } from "../../utils/http-error";

export interface OrganizationValidationIssue {
  field: string;
  message: string;
}

export class OrganizationValidationError extends HttpError {
  constructor(
    public readonly fields: OrganizationValidationIssue[],
    message?: string,
  ) {
    super(400, message ?? fields[0]?.message ?? "Dữ liệu yêu cầu không hợp lệ");
  }
}

function mapZodIssues(issues: z.ZodIssue[]): OrganizationValidationIssue[] {
  const results: OrganizationValidationIssue[] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        results.push({
          field: key,
          message: `Tham số không được hỗ trợ: ${key}`,
        });
      }
    } else {
      results.push({
        field: issue.path.length ? issue.path.join(".") : "query",
        message: issue.message,
      });
    }
  }
  return results;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const cookingModeBodySchema = z.strictObject({
  cookingMode: z.enum(["SEPARATE_BY_LOT", "COMBINE_LOTS"], {
    error: "Chế độ nấu không hợp lệ",
  }),
});

function positiveIntegerQuery(name: string, fallback: number) {
  const message = `${name} phải là số nguyên dương`;
  return z
    .string({ error: message })
    .regex(/^[1-9]\d*$/, { error: message })
    .transform(Number)
    .refine(Number.isSafeInteger, {
      error: `${name} vượt giới hạn cho phép`,
    })
    .default(fallback);
}

export const organizationListQuerySchema = z
  .strictObject(
    {
      page: positiveIntegerQuery("page", 1),
      limit: positiveIntegerQuery("limit", 20).refine((value) => value <= 100, {
        error: "limit tối đa 100",
      }),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? "Chỉ hỗ trợ tham số page và limit"
          : "Tham số danh sách trường học không hợp lệ",
    },
  )
  .refine(
    ({ page, limit }) =>
      !Number.isSafeInteger(page) ||
      !Number.isSafeInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100 ||
      (page - 1) * limit <= 2_147_483_647,
    {
      path: ["page"],
      error: "page vượt giới hạn phân trang",
    },
  );

export const publicSchoolListQuerySchema = z
  .strictObject(
    {
      page: positiveIntegerQuery("page", 1),
      limit: positiveIntegerQuery("limit", 20).refine((value) => value <= 100, {
        error: "limit tối đa 100",
      }),
      search: z
        .string({ error: "Từ khóa tìm kiếm phải là chuỗi ký tự" })
        .max(100, { error: "Từ khóa tìm kiếm tối đa 100 ký tự" })
        .transform((val) => {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : undefined;
        })
        .optional(),
      locationId: z
        .string({ error: "locationId phải là UUID hợp lệ" })
        .transform((val) => val.trim())
        .refine((val) => UUID_REGEX.test(val), {
          error: "locationId phải là UUID hợp lệ",
        })
        .optional(),
      city: z
        .string({ error: "Tên thành phố phải là chuỗi ký tự" })
        .max(100, { error: "Tên thành phố tối đa 100 ký tự" })
        .transform((val) => {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : undefined;
        })
        .optional(),
      district: z
        .string({ error: "Tên quận/huyện phải là chuỗi ký tự" })
        .max(100, { error: "Tên quận/huyện tối đa 100 ký tự" })
        .transform((val) => {
          const trimmed = val.trim();
          return trimmed.length > 0 ? trimmed : undefined;
        })
        .optional(),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? "Tham số danh sách trường học không hợp lệ"
          : "Tham số danh sách trường học không hợp lệ",
    },
  )
  .refine(
    ({ page, limit }) =>
      !Number.isSafeInteger(page) ||
      !Number.isSafeInteger(limit) ||
      page < 1 ||
      limit < 1 ||
      limit > 100 ||
      (page - 1) * limit <= 2_147_483_647,
    {
      path: ["page"],
      error: "page vượt giới hạn phân trang",
    },
  );

export const schoolCodeSchema = z
  .string({ error: "Thiếu mã trường học" })
  .transform((val) => val.trim())
  .refine((val) => val.length > 0, { error: "Thiếu mã trường học" })
  .refine((val) => val.length <= 80, {
    error: "Mã trường học tối đa 80 ký tự",
  });

export const schoolIdSchema = z
  .string({ error: "ID trường học không hợp lệ (yêu cầu UUID)" })
  .transform((val) => val.trim())
  .refine((val) => UUID_REGEX.test(val), {
    error: "ID trường học không hợp lệ (yêu cầu UUID)",
  });

export const publicDailyMenuQuerySchema = z.strictObject(
  {
    date: z
      .string({ error: "Ngày không đúng định dạng (yêu cầu YYYY-MM-DD)" })
      .transform((val) => val.trim())
      .refine(
        (val) => {
          if (val === "") return true;
          if (!DATE_REGEX.test(val)) return false;
          const parsed = new Date(`${val}T00:00:00.000Z`);
          return !Number.isNaN(parsed.getTime());
        },
        { error: "Ngày không đúng định dạng (yêu cầu YYYY-MM-DD)" },
      )
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Tham số thực đơn ngày không hợp lệ"
        : "Tham số thực đơn ngày không hợp lệ",
  },
);

export const publicWeeklyMenuQuerySchema = z.strictObject(
  {
    week: z
      .string({ error: "Ngày tuần không đúng định dạng (yêu cầu YYYY-MM-DD)" })
      .transform((val) => val.trim())
      .refine(
        (val) => {
          if (val === "") return true;
          if (!DATE_REGEX.test(val)) return false;
          const parsed = new Date(`${val}T00:00:00.000Z`);
          return !Number.isNaN(parsed.getTime());
        },
        { error: "Ngày tuần không đúng định dạng (yêu cầu YYYY-MM-DD)" },
      )
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
    grade: z
      .string({ error: "Mã khối/nhóm không hợp lệ" })
      .transform((val) => val.trim())
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
    group: z
      .string({ error: "Mã nhóm bán trú không hợp lệ" })
      .transform((val) => val.trim())
      .transform((val) => (val === "" ? undefined : val))
      .optional(),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "Tham số thực đơn tuần không hợp lệ"
        : "Tham số thực đơn tuần không hợp lệ",
  },
);

export function validateOrganizationListQuery(value: unknown) {
  const result = organizationListQuerySchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(mapZodIssues(result.error.issues));
  }
  return result.data;
}

export function validateCookingMode(value: unknown) {
  const result = cookingModeBodySchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(mapZodIssues(result.error.issues));
  }
  return result.data;
}

export function validatePublicSchoolQuery(value: unknown) {
  const result = publicSchoolListQuerySchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(mapZodIssues(result.error.issues));
  }
  return result.data;
}

export function validateSchoolCode(value: unknown): string {
  const result = schoolCodeSchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(
      mapZodIssues(result.error.issues),
      result.error.issues[0]?.message,
    );
  }
  return result.data;
}

export function validateSchoolId(value: unknown): string {
  const result = schoolIdSchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(
      mapZodIssues(result.error.issues),
      result.error.issues[0]?.message,
    );
  }
  return result.data;
}

export function validatePublicDailyMenuQuery(value: unknown) {
  const result = publicDailyMenuQuerySchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(mapZodIssues(result.error.issues));
  }
  return result.data;
}

export function validatePublicWeeklyMenuQuery(value: unknown) {
  const result = publicWeeklyMenuQuerySchema.safeParse(value);
  if (!result.success) {
    throw new OrganizationValidationError(mapZodIssues(result.error.issues));
  }
  return result.data;
}
