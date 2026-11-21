import { z } from "zod";
import {
  parseRequest,
  requestUuidSchema,
} from "../../utils/request-validation";

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
