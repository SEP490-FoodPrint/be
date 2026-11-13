// Extend this parser with approved filters when this module gains business rules.
export { parseListQuery as validateAllergyListQuery } from "../../utils/list-query";
import { paginationSchema } from "../../utils/directory-validation";
import { parseRequest } from "../../utils/request-validation";
export const allergyCatalogQuerySchema = paginationSchema;
export const validateAllergyCatalogQuery = (value: unknown) =>
  parseRequest(allergyCatalogQuerySchema, value);
