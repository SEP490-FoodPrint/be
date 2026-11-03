import { HttpError } from "../../utils/http-error";

export { parseListQuery as validateOrganizationListQuery } from "../../utils/list-query";

export interface PublicSchoolListQuery {
  page: number;
  limit: number;
  search?: string;
  locationId?: string;
  city?: string;
  district?: string;
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
  const allowedKeys = new Set([
    "page",
    "limit",
    "search",
    "locationId",
    "city",
    "district",
  ]);
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

  let city: string | undefined;
  if (query.city !== undefined) {
    if (typeof query.city !== "string") {
      throw new HttpError(400, "Tên thành phố phải là chuỗi ký tự");
    }
    const trimmed = query.city.trim();
    if (trimmed.length > 100) {
      throw new HttpError(400, "Tên thành phố tối đa 100 ký tự");
    }
    city = trimmed.length > 0 ? trimmed : undefined;
  }

  let district: string | undefined;
  if (query.district !== undefined) {
    if (typeof query.district !== "string") {
      throw new HttpError(400, "Tên quận/huyện phải là chuỗi ký tự");
    }
    const trimmed = query.district.trim();
    if (trimmed.length > 100) {
      throw new HttpError(400, "Tên quận/huyện tối đa 100 ký tự");
    }
    district = trimmed.length > 0 ? trimmed : undefined;
  }

  return { page, limit, search, locationId, city, district };
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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface PublicDailyMenuQuery {
  date?: string;
}

export interface PublicWeeklyMenuQuery {
  week?: string;
  grade?: string;
  group?: string;
}

export function validatePublicDailyMenuQuery(
  query: Record<string, unknown>,
): PublicDailyMenuQuery {
  let date: string | undefined;
  if (query.date !== undefined && query.date !== "") {
    if (typeof query.date !== "string" || !DATE_REGEX.test(query.date.trim())) {
      throw new HttpError(
        400,
        "Ngày không đúng định dạng (yêu cầu YYYY-MM-DD)",
      );
    }
    const parsed = new Date(`${query.date.trim()}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError(400, "Ngày không hợp lệ");
    }
    date = query.date.trim();
  }
  return { date };
}

export function validatePublicWeeklyMenuQuery(
  query: Record<string, unknown>,
): PublicWeeklyMenuQuery {
  let week: string | undefined;
  if (query.week !== undefined && query.week !== "") {
    if (typeof query.week !== "string" || !DATE_REGEX.test(query.week.trim())) {
      throw new HttpError(
        400,
        "Ngày tuần không đúng định dạng (yêu cầu YYYY-MM-DD)",
      );
    }
    const parsed = new Date(`${query.week.trim()}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new HttpError(400, "Ngày tuần không hợp lệ");
    }
    week = query.week.trim();
  }

  let grade: string | undefined;
  if (query.grade !== undefined && query.grade !== "") {
    if (typeof query.grade !== "string") {
      throw new HttpError(400, "Mã khối/nhóm không hợp lệ");
    }
    grade = query.grade.trim();
  }

  let group: string | undefined;
  if (query.group !== undefined && query.group !== "") {
    if (typeof query.group !== "string") {
      throw new HttpError(400, "Mã nhóm bán trú không hợp lệ");
    }
    group = query.group.trim();
  }

  return { week, grade, group };
}
