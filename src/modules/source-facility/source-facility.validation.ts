import { z } from "zod";
import {
  parseRequest,
  requiredText,
  requestUuidSchema,
} from "../../utils/request-validation";

function nullableText(maximum?: number) {
  let schema = z.string({ error: "Trường phải là văn bản" }).trim();
  if (maximum !== undefined) {
    schema = schema.max(maximum, {
      error: `Trường chỉ nhận tối đa ${maximum} ký tự`,
    });
  }
  return schema.transform((value) => (value === "" ? null : value)).nullable();
}

export const sourceFacilityFields = {
  name: requiredText(255),
  address: nullableText(),
  contactName: nullableText(255),
  contactPhone: nullableText(30),
  contactEmail: nullableText().refine(
    (value) => value === null || z.email().safeParse(value).success,
    { error: "Email liên hệ không đúng định dạng" },
  ),
};

function positiveInteger(name: string, fallback: number) {
  return z
    .string({ error: `${name} phải là số nguyên dương` })
    .regex(/^[1-9]\d*$/, { error: `${name} phải là số nguyên dương` })
    .refine((value) => value === value.trim(), {
      error: `${name} phải là số nguyên dương`,
    })
    .transform(Number)
    .refine(Number.isSafeInteger, {
      error: `${name} vượt giới hạn cho phép`,
    })
    .default(fallback);
}

export const sourceFacilityQuerySchema = z
  .strictObject({
    page: positiveInteger("page", 1),
    limit: positiveInteger("limit", 20).refine((value) => value <= 100, {
      error: "limit tối đa 100",
    }),
  })
  .refine((value) => (value.page - 1) * value.limit <= 2_147_483_647, {
    path: ["page"],
    error: "page vượt giới hạn phân trang",
  });

export const sourceFacilityParamsSchema = z.strictObject({
  sourceFacilityId: requestUuidSchema.refine((value) => value.length === 36, {
    error: "ID phải là UUID hợp lệ",
  }),
});

export const sourceFacilityCreateSchema = z.strictObject({
  name: sourceFacilityFields.name,
  address: sourceFacilityFields.address.default(null),
  contactName: sourceFacilityFields.contactName.default(null),
  contactPhone: sourceFacilityFields.contactPhone.default(null),
  contactEmail: sourceFacilityFields.contactEmail.default(null),
});

export const sourceFacilityUpdateSchema = z
  .strictObject(sourceFacilityFields)
  .partial()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      error: "Phải gửi ít nhất một trường cần sửa",
    },
  );

export const sourceFacilityDeactivateSchema = z.strictObject({});

export const validateSourceFacilityQuery = (value: unknown) =>
  parseRequest(sourceFacilityQuerySchema, value);
export const validateSourceFacilityParams = (value: unknown) =>
  parseRequest(sourceFacilityParamsSchema, value);
export const validateSourceFacilityCreate = (value: unknown) =>
  parseRequest(sourceFacilityCreateSchema, value);
export const validateSourceFacilityUpdate = (value: unknown) =>
  parseRequest(sourceFacilityUpdateSchema, value);
export const validateSourceFacilityDeactivate = (value: unknown) =>
  parseRequest(
    sourceFacilityDeactivateSchema,
    value === undefined ? {} : value,
  );
export const validateSourceFacilityListQuery = validateSourceFacilityQuery;
