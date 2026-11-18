import { ROLES } from "./roles";

// Bốn bộ phận được tham gia kiểm tra đầu vào (thay thế deliveryInspectionRoles cũ).
export const DELIVERY_INSPECTION_ROLES = [
  ROLES.SCHOOL_KITCHEN_STAFF,
  ROLES.INGREDIENT_MANAGEMENT, // "INGREDIENT_MANAGEMENT_DEPARTMENT"
  ROLES.SCHOOL_NUTRITION_OFFICER,
  ROLES.PARENTS_COMMITTEE,
] as const;

export type DeliveryInspectionRoleCode =
  (typeof DELIVERY_INSPECTION_ROLES)[number];

// Ba bộ phận BGH được phân nhóm (thứ tự hiển thị trên UI).
export const CONFIGURABLE_INSPECTION_ROLES = [
  ROLES.SCHOOL_KITCHEN_STAFF,
  ROLES.INGREDIENT_MANAGEMENT,
  ROLES.SCHOOL_NUTRITION_OFFICER,
] as const;

export type ConfigurableInspectionRoleCode =
  (typeof CONFIGURABLE_INSPECTION_ROLES)[number];

// Bộ phận cố định nhóm tùy chọn.
export const FIXED_OPTIONAL_INSPECTION_ROLES = [
  ROLES.PARENTS_COMMITTEE,
] as const;

export type DeliveryInspectionTierCode = "PRIMARY" | "REQUIRED" | "OPTIONAL";

export const DEFAULT_INSPECTION_TIERS: Record<
  DeliveryInspectionRoleCode,
  DeliveryInspectionTierCode
> = {
  [ROLES.SCHOOL_KITCHEN_STAFF]: "PRIMARY",
  [ROLES.INGREDIENT_MANAGEMENT]: "REQUIRED",
  [ROLES.SCHOOL_NUTRITION_OFFICER]: "REQUIRED",
  [ROLES.PARENTS_COMMITTEE]: "OPTIONAL",
} as const;

export const INSPECTION_TIER_LABELS: Record<
  DeliveryInspectionTierCode,
  string
> = {
  PRIMARY: "Người duyệt chính",
  REQUIRED: "Bắt buộc duyệt",
  OPTIONAL: "Tùy chọn",
} as const;

export const LEGACY_INSPECTION_TIERS: Record<
  DeliveryInspectionRoleCode,
  DeliveryInspectionTierCode
> = {
  [ROLES.SCHOOL_KITCHEN_STAFF]: "REQUIRED",
  [ROLES.INGREDIENT_MANAGEMENT]: "REQUIRED",
  [ROLES.SCHOOL_NUTRITION_OFFICER]: "REQUIRED",
  [ROLES.PARENTS_COMMITTEE]: "REQUIRED",
} as const;

/**
 * Phân giải cấu hình tier theo trường: lấy cấu hình DB nếu có,
 * thiếu role nào dùng DEFAULT_INSPECTION_TIERS; PARENTS_COMMITTEE luôn OPTIONAL.
 */
export function resolveSchoolTiers(
  rows: Array<{
    tier: DeliveryInspectionTierCode;
    Role?: { code: string } | null;
    roleCode?: string;
  }>,
): Record<DeliveryInspectionRoleCode, DeliveryInspectionTierCode> {
  const result: Record<DeliveryInspectionRoleCode, DeliveryInspectionTierCode> = {
    ...DEFAULT_INSPECTION_TIERS,
  };

  for (const row of rows) {
    const code = (row.Role?.code ?? row.roleCode) as DeliveryInspectionRoleCode;
    if (code && code !== ROLES.PARENTS_COMMITTEE) {
      if (
        code === ROLES.SCHOOL_KITCHEN_STAFF ||
        code === ROLES.INGREDIENT_MANAGEMENT ||
        code === ROLES.SCHOOL_NUTRITION_OFFICER
      ) {
        result[code] = row.tier;
      }
    }
  }

  // PARENTS_COMMITTEE luôn là OPTIONAL
  result[ROLES.PARENTS_COMMITTEE] = "OPTIONAL";
  return result;
}

/**
 * Phân giải snapshot tier của đợt giao: nếu snapshot rỗng trả về null.
 */
export function resolveDeliveryTiers(
  snapshotRows?: Array<{
    tier: DeliveryInspectionTierCode;
    Role?: { code: string } | null;
    roleCode?: string;
  }> | null,
): Record<DeliveryInspectionRoleCode, DeliveryInspectionTierCode> | null {
  if (!snapshotRows || snapshotRows.length === 0) {
    return null;
  }

  const result: Record<DeliveryInspectionRoleCode, DeliveryInspectionTierCode> = {
    ...DEFAULT_INSPECTION_TIERS,
  };

  let hasValid = false;
  for (const row of snapshotRows) {
    const code = (row.Role?.code ?? row.roleCode) as DeliveryInspectionRoleCode;
    if (code && DELIVERY_INSPECTION_ROLES.includes(code)) {
      result[code] = row.tier;
      hasValid = true;
    }
  }

  return hasValid ? result : null;
}

/**
 * Kiểm tra hoàn tất kiểm nhận: mọi role PRIMARY và REQUIRED đều đã APPROVE.
 */
export function isInspectionComplete(
  tiers: Record<DeliveryInspectionRoleCode, DeliveryInspectionTierCode>,
  approvedRoleCodes: string[],
): boolean {
  const approvedSet = new Set(approvedRoleCodes);
  for (const role of DELIVERY_INSPECTION_ROLES) {
    const tier = tiers[role];
    if (tier === "PRIMARY" || tier === "REQUIRED") {
      if (!approvedSet.has(role)) {
        return false;
      }
    }
  }
  return true;
}
