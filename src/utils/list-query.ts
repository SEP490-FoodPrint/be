import { HttpError } from "./http-error";

export interface ListQuery {
  page: number;
  limit: number;
}

export interface ListPage<T> {
  items: T[];
  pagination: ListQuery & { hasNext: boolean };
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, "Yêu cầu không hợp lệ.");
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new HttpError(400, "Yêu cầu không hợp lệ.");
  }
  return result;
}

/** Only accept the pagination parameters supported by these sample APIs. */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  if (Object.keys(query).some((key) => key !== "page" && key !== "limit")) {
    throw new HttpError(400, "Yêu cầu không hợp lệ.");
  }
  const page = positiveInteger(query.page, 1);
  const limit = positiveInteger(query.limit, 20);
  if (limit > 100 || (page - 1) * limit > 2_147_483_647) {
    throw new HttpError(400, "Yêu cầu không hợp lệ.");
  }
  return { page, limit };
}

export function listWindow(query: ListQuery) {
  return { skip: (query.page - 1) * query.limit, take: query.limit + 1 };
}

/** Fetch one extra row instead of issuing an unbounded query or a second count. */
export async function readListPage<T>(
  read: () => Promise<T[]>,
  query: ListQuery,
): Promise<ListPage<T>> {
  let rows: T[];
  try {
    rows = await read();
  } catch {
    // Connection/query errors can contain credentials or internal SQL details.
    throw new HttpError(503, "Không thể tải danh sách. Vui lòng thử lại sau.");
  }
  return {
    items: rows.slice(0, query.limit),
    pagination: { ...query, hasNext: rows.length > query.limit },
  };
}
