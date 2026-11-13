import type { Prisma } from "../../generated/prisma/client";

export interface LifecyclePreflightCounts {
  duplicateUnits: number;
  unresolvedUnits: number;
  mismatchedRecipients: number;
  invalidOfficers: number;
}

export function evaluateLifecyclePreflight(counts: LifecyclePreflightCounts) {
  return {
    ok:
      counts.duplicateUnits === 0 &&
      counts.unresolvedUnits === 0 &&
      counts.mismatchedRecipients === 0 &&
      counts.invalidOfficers === 0,
    ...counts,
  };
}

/** The query uses only columns present both before and after the migration. */
export async function readLifecyclePreflight(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<
    Omit<LifecyclePreflightCounts, "mismatchedRecipients">[]
  >`
    WITH officers AS (
      SELECT commune_food_safety_unit_id, count(*) AS officer_count
      FROM foodprint.users
      WHERE role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'
        AND commune_food_safety_unit_id IS NOT NULL
      GROUP BY commune_food_safety_unit_id
    ), unresolved AS (
      SELECT DISTINCT f.recipient_commune_food_safety_unit_id
      FROM foodprint.food_safety_report_forwardings f
      JOIN foodprint.food_safety_incidents i ON i.id = f.incident_id
      LEFT JOIN officers o ON o.commune_food_safety_unit_id = f.recipient_commune_food_safety_unit_id
      WHERE f.recipient_commune_food_safety_unit_id IS NOT NULL
        AND i.status <> 'CLOSED'
        AND COALESCE(o.officer_count, 0) <> 1
    )
    SELECT (SELECT count(*)::int FROM officers WHERE officer_count > 1) AS "duplicateUnits",
           (SELECT count(*)::int FROM unresolved) AS "unresolvedUnits",
           (SELECT count(*)::int FROM foodprint.users u
             JOIN foodprint.roles r ON r.id = u.role_id
             WHERE u.role_code = 'COMMUNE_FOOD_SAFETY_OFFICER'
               AND (r.type <> 'AUTHORITY' OR u.school_id IS NOT NULL OR u.supplier_id IS NOT NULL
                 OR (u.status = 'ACTIVE' AND u.commune_food_safety_unit_id IS NULL))) AS "invalidOfficers"
  `;
  const counts = rows[0];
  if (!counts) throw new Error("Không thể kiểm tra dữ liệu cán bộ");
  const columns = await tx.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'foodprint' AND c.relname = 'food_safety_report_forwardings'
        AND a.attname = 'recipient_user_id' AND NOT a.attisdropped
    ) AS "exists"
  `;
  if (!columns[0]) throw new Error("Không thể kiểm tra cấu trúc báo cáo");
  let mismatchedRecipients = 0;
  if (columns[0].exists) {
    const mismatches = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS "count"
      FROM foodprint.food_safety_report_forwardings f
      LEFT JOIN foodprint.users u ON u.id = f.recipient_user_id
      WHERE f.recipient_user_id IS NOT NULL
        AND (u.id IS NULL OR u.role_code <> 'COMMUNE_FOOD_SAFETY_OFFICER'
          OR u.commune_food_safety_unit_id IS DISTINCT FROM f.recipient_commune_food_safety_unit_id)
    `;
    if (!mismatches[0]) throw new Error("Không thể kiểm tra người nhận");
    mismatchedRecipients = mismatches[0].count;
  }
  return evaluateLifecyclePreflight({ ...counts, mismatchedRecipients });
}
