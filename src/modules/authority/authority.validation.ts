import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";
import { paginationSchema } from "../../utils/directory-validation";

// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateAuthorityListQuery } from "../../utils/list-query";

export const authorityParamsSchema = z.strictObject({
  id: requestUuidSchema,
});

/** Body gắn đơn vị ATTP với phường/xã (specs/authority-complaints US4). */
export const assignAuthorityLocationBodySchema = z.strictObject({
  locationId: requestUuidSchema,
});

export const validateAuthorityParams = (value: unknown) =>
  parseRequest(authorityParamsSchema, value);

export const validateAssignAuthorityLocationBody = (value: unknown) =>
  parseRequest(assignAuthorityLocationBodySchema, value);

/** Gắn/đổi phường/xã của trường hoặc NCC (specs/authority-officer-accounts FR-008). */
export const schoolLocationParamsSchema = z.strictObject({
  schoolId: requestUuidSchema,
});
export const supplierLocationParamsSchema = z.strictObject({
  supplierId: requestUuidSchema,
});
export const assignOrganizationLocationBodySchema = z.strictObject({
  locationId: requestUuidSchema,
});

/** Danh sách trường thuộc địa bàn ATTP (FR-009). */
export const authoritySchoolListQuerySchema = paginationSchema.safeExtend({
  search: z
    .string({ error: "Từ khóa phải là chuỗi" })
    .trim()
    .max(100, { error: "Từ khóa tối đa 100 ký tự" })
    .transform((value) => value || undefined)
    .optional(),
  status: z
    .enum(["ACTIVE", "INACTIVE"], { error: "Trạng thái không hợp lệ" })
    .optional(),
});
export const authoritySchoolParamsSchema = z.strictObject({
  schoolId: requestUuidSchema,
});

export const validateSchoolLocationParams = (value: unknown) =>
  parseRequest(schoolLocationParamsSchema, value);
export const validateSupplierLocationParams = (value: unknown) =>
  parseRequest(supplierLocationParamsSchema, value);
export const validateAssignOrganizationLocationBody = (value: unknown) =>
  parseRequest(assignOrganizationLocationBodySchema, value);
export const validateAuthoritySchoolListQuery = (value: unknown) =>
  parseRequest(authoritySchoolListQuerySchema, value);
export const validateAuthoritySchoolParams = (value: unknown) =>
  parseRequest(authoritySchoolParamsSchema, value);
