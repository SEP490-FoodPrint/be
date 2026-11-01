import { HttpError } from "../../utils/http-error";

export { parseListQuery as validateOrganizationListQuery } from "../../utils/list-query";

export interface PublicSchoolListQuery {
  page: number;
  limit: number;
  search?: string;
  locationId?: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, `${name} phải là số nguyên dương`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new HttpError(400, `${name} vượt giới hạn cho phép`);
  }
  return result;
}

export function validatePublicSchoolQuery(
  query: Record<string, unknown>,
): PublicSchoolListQuery {
  const allowedKeys = new Set(["page", "limit", "search", "locationId"]);
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, `Tham số không được hỗ trợ: ${key}`);
    }
  }

  const page = parsePositiveInteger(query.page, 1, "page");
  const limit = parsePositiveInteger(query.limit, 20, "limit");
  if (limit > 100) {
    throw new HttpError(400, "limit tối đa là 100");
  }

  let search: string | undefined;
  if (query.search !== undefined) {
    if (typeof query.search !== "string") {
      throw new HttpError(400, "Từ khóa tìm kiếm phải là chuỗi ký tự");
    }
    const trimmed = query.search.trim();
    if (trimmed.length > 100) {
      throw new HttpError(400, "Từ khóa tìm kiếm tối đa 100 ký tự");
    }
    search = trimmed.length > 0 ? trimmed : undefined;
  }

  let locationId: string | undefined;
  if (query.locationId !== undefined) {
    if (
      typeof query.locationId !== "string" ||
      !UUID_REGEX.test(query.locationId.trim())
    ) {
      throw new HttpError(400, "locationId phải là UUID hợp lệ");
    }
    locationId = query.locationId.trim();
  }

  return { page, limit, search, locationId };
}

export function validateSchoolCode(code: unknown): string {
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new HttpError(400, "Thiếu mã trường học");
  }
  const trimmed = code.trim();
  if (trimmed.length > 80) {
    throw new HttpError(400, "Mã trường học tối đa 80 ký tự");
  }
  return trimmed;
}

export function validateSchoolId(id: unknown): string {
  if (typeof id !== "string" || !UUID_REGEX.test(id.trim())) {
    throw new HttpError(400, "ID trường học không hợp lệ (yêu cầu UUID)");
  }
  return id.trim();
}
