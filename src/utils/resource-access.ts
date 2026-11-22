import { ROLES, ORG_TYPES } from "../constants/roles";
import type { Prisma } from "../generated/prisma/client";
import type { AuthPrincipal } from "../types/auth";
import {
  assertPermission,
  assertOrganizationManager,
  assertSystemManager,
} from "./authorization";
import { HttpError } from "./http-error";

export interface PermissionCatalogScope {
  kind: "SYSTEM";
}
export interface PermissionUserScope {
  kind: "SYSTEM" | "ORGANIZATION";
  schoolId: string | null;
  supplierId: string | null;
  communeFoodSafetyUnitId: string | null;
}
export function permissionCatalogScope(
  principal: AuthPrincipal,
  guard:
    | "permission.view"
    | "permission.create"
    | "role.view"
    | "role_permission.manage",
): PermissionCatalogScope {
  assertSystemManager(principal, guard);
  return { kind: "SYSTEM" };
}
export function permissionUserScope(
  principal: AuthPrincipal,
  write = false,
): PermissionUserScope {
  if (principal.orgType === "SYSTEM" && !write)
    assertSystemManager(principal, "user.manage");
  else assertOrganizationManager(principal);
  return {
    kind: principal.orgType === "SYSTEM" ? "SYSTEM" : "ORGANIZATION",
    schoolId: principal.schoolId,
    supplierId: principal.supplierId,
    communeFoodSafetyUnitId: principal.communeFoodSafetyUnitId,
  };
}
function school(p: AuthPrincipal): string {
  if (!p.schoolId || p.orgType !== "SCHOOL")
    throw new HttpError(403, "Không có phạm vi trường");
  return p.schoolId;
}
function supplier(p: AuthPrincipal): string {
  if (!p.supplierId || p.orgType !== "SUPPLIER")
    throw new HttpError(403, "Không có phạm vi supplier");
  return p.supplierId;
}
function authority(p: AuthPrincipal): string {
  if (!p.communeFoodSafetyUnitId || p.orgType !== "AUTHORITY")
    throw new HttpError(403, "Không có phạm vi ATTP xã");
  return p.communeFoodSafetyUnitId;
}
function authorityReports(
  p: AuthPrincipal,
): Prisma.FoodSafetyReportForwardingWhereInput {
  return {
    recipientCommuneFoodSafetyUnitId: authority(p),
    OR: [{ recipientUserId: p.id }, { recipientUserId: null }],
  };
}
export const RESOURCE_PERMISSIONS = {
  auth: ["role.view"],
  user: ["user.manage", "school_user.manage", "supplier_staff.manage"],
  "supplier-staff": ["supplier_staff.manage"],
  organization: ["school.manage"],
  ingredient: ["ingredient.view", "ingredient.manage"],
  menu: ["menu.view"],
  "supply-order": ["supply_request.view"],
  warehouse: ["inventory.view"],
  kitchen: ["cooking_batch.view"],
  "meal-attendance": ["daily_meal_portion.view"],
  feedback: ["meal_complaint.view"],
  "food-safety-incident": ["food_safety_incident.view"],
  supplier: ["supplier.view", "supplier.manage"],
  authority: ["authority.view", "food_safety_report.view"],
  class: ["class.view"],
  "school-grade": ["class.manage"],
  "source-facility": ["source_facility.manage"],
  "supplier-certification": ["supplier_certification.view"],
  registration: ["registration.view"],
  "school-supplier": [
    "supplier_relationship.view",
    "supplier_relationship.manage",
  ],
  "supplier-school": [
    "supplier_relationship.view",
    "supplier_relationship.manage",
  ],
  "ingredient-entry": ["ingredient.view", "ingredient.manage"],
  allergy: ["class_allergy.view"],
  delivery: ["delivery.view", "delivery.manage", "delivery.receive"],
  dish: ["menu.view"],
  inventory: ["inventory.view"],
  "retained-sample": ["retained_sample.view"],
  "meal-allocation": ["meal_allocation.view"],
  "ingredient-quality-feedback": [
    "ingredient_quality_feedback.view_own",
    "ingredient_quality_feedback.view_details",
  ],
  reporting: ["food_safety_report.view"],
  "system-complaint": ["system_complaint.view", "system_complaint.submit"],
  "authority-complaint": ["authority_complaint.view"],
  "food-analysis": ["food_analysis_result.view"],
  "school-alert": ["school_alert.view"],
  "menu-review": ["menu.view", "menu.review", "menu.approve"],
  traceability: ["traceability.view"],
} as const;
export const isComplaintSubmitter = (role: string) =>
  role === ROLES.HOMEROOM_TEACHER || role === ROLES.PARENTS_COMMITTEE;

export const listScopes = {
  auth: (p: AuthPrincipal): Prisma.RoleWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["auth"]);
    if (p.orgType === "SYSTEM") return {};
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  user: (p: AuthPrincipal): Prisma.UserWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["user"]);
    if (p.orgType === "SYSTEM") {
      assertPermission(p, "user.manage");
      return {};
    }
    assertOrganizationManager(p);
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    if (p.orgType === "SUPPLIER") return { supplierId: supplier(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "supplier-staff": (p: AuthPrincipal): Prisma.UserWhereInput => {
    const { supplierId } = supplierStaffManagementScope(p);
    return {
      supplierId,
      schoolId: null,
      communeFoodSafetyUnitId: null,
      roleCode: ROLES.INGREDIENT_SUPPLIER_STAFF,
      Role: {
        code: ROLES.INGREDIENT_SUPPLIER_STAFF,
        type: ORG_TYPES.SUPPLIER,
      },
    };
  },
  organization: (p: AuthPrincipal): Prisma.SchoolWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["organization"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { id: school(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  ingredient: (p: AuthPrincipal): Prisma.IngredientWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["ingredient"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        status: "ACTIVE",
        Supplier: {
          status: "ACTIVE",
          schoolSupplierRelationships: {
            some: {
              schoolId: school(p),
              status: "ACTIVE",
            },
          },
        },
      };
    if (p.orgType === "SUPPLIER") return { supplierId: supplier(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  menu: (p: AuthPrincipal): Prisma.WeeklyMenuWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["menu"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "supply-order": (p: AuthPrincipal): Prisma.SupplyRequestWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["supply-order"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    if (p.orgType === "SUPPLIER") return { supplierId: supplier(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  warehouse: (p: AuthPrincipal): Prisma.IngredientLotWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["warehouse"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        DeliveryItem: { Delivery: { schoolId: school(p) } },
      };
    if (p.orgType === "SUPPLIER")
      return { DeliveryItem: { Delivery: { supplierId: supplier(p) } } };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  kitchen: (p: AuthPrincipal): Prisma.CookingBatchWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["kitchen"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return { MenuDay: { WeeklyMenu: { schoolId: school(p) } } };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "meal-attendance": (p: AuthPrincipal): Prisma.DailyMealPortionWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["meal-attendance"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        Class: {
          schoolId: school(p),
          ...(p.role === "HOMEROOM_TEACHER" && {
            homeroomAssignments: {
              some: { teacherUserId: p.id, endedAt: null },
            },
          }),
        },
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  /** Khiếu nại suất ăn (bảng cha `complaints`, kind MEAL); trường nhận lưu ở `meal_complaints.school_id`. */
  feedback: (p: AuthPrincipal): Prisma.ComplaintWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["feedback"]);
    if (p.orgType === "SYSTEM") return { kind: "MEAL" };
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_MANAGEMENT_BOARD)
      return { kind: "MEAL", mealComplaint: { is: { schoolId: school(p) } } };
    if (p.orgType === "SCHOOL" && isComplaintSubmitter(p.role))
      return {
        kind: "MEAL",
        mealComplaint: { is: { schoolId: school(p) } },
        senderUserId: p.id,
      };
    throw new HttpError(403, "Vai trò không được phép xem khiếu nại");
  },
  /** Khiếu nại gửi System Admin (kind SYSTEM): admin xem toàn bộ, người gửi chỉ xem đơn của mình. */
  "system-complaint": (p: AuthPrincipal): Prisma.ComplaintWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["system-complaint"]);
    if (p.orgType === "SYSTEM") {
      if (p.role !== ROLES.SYSTEM_ADMIN)
        throw new HttpError(403, "Vai trò không được phép xem khiếu nại");
      assertPermission(p, "system_complaint.view");
      return { kind: "SYSTEM" };
    }
    assertPermission(p, "system_complaint.submit");
    return { kind: "SYSTEM", senderUserId: p.id };
  },
  /**
   * C05 (specs/authority-complaints FR-005): ATTP xem đơn gửi đơn vị mình; BGH xem đơn của trường (chỉ đọc);
   * vai trò trường khác (phụ huynh) chỉ xem đơn mình gửi trong trường hiện tại.
   */
  "authority-complaint": (p: AuthPrincipal): Prisma.ComplaintWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["authority-complaint"]);
    if (p.orgType === "AUTHORITY")
      return {
        kind: "AUTHORITY",
        authorityComplaint: {
          is: { recipientCommuneFoodSafetyUnitId: authority(p) },
        },
      };
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_ADMINISTRATION)
      throw new HttpError(403, "Vai trò không được phép xem khiếu nại");
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_MANAGEMENT_BOARD)
      return {
        kind: "AUTHORITY",
        authorityComplaint: { is: { schoolId: school(p) } },
      };
    if (p.orgType === "SCHOOL")
      return {
        kind: "AUTHORITY",
        authorityComplaint: { is: { schoolId: school(p) } },
        senderUserId: p.id,
      };
    throw new HttpError(403, "Vai trò không được phép xem khiếu nại");
  },
  "food-safety-incident": (
    p: AuthPrincipal,
  ): Prisma.FoodSafetyIncidentWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["food-safety-incident"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_ADMINISTRATION)
      throw new HttpError(403, "Vai trò không được phép xem sự cố");
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_MANAGEMENT_BOARD)
      return { schoolId: school(p) };
    // Q23: người báo (PH/GVCN) chỉ theo dõi hồ sơ mình báo; không thấy hồ sơ BGH tự lập.
    if (p.orgType === "SCHOOL")
      return {
        schoolId: school(p),
        reportedByUserId: p.id,
        source: { in: ["PARENT_REPORT", "TEACHER_REPORT"] },
      };
    if (p.orgType === "AUTHORITY")
      return {
        foodSafetyReportForwardings: {
          some: authorityReports(p),
        },
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  supplier: (p: AuthPrincipal): Prisma.SupplierWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["supplier"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SUPPLIER") return { id: supplier(p) };
    if (p.orgType === "SCHOOL")
      return {
        schoolSupplierRelationships: {
          some: {
            schoolId: school(p),
            status: { in: ["ACTIVE", "SUSPENDED"] },
          },
        },
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  authority: (p: AuthPrincipal): Prisma.CommuneFoodSafetyUnitWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["authority"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "AUTHORITY") return { id: authority(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "school-grade": (p: AuthPrincipal): Prisma.SchoolGradeWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["school-grade"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_MANAGEMENT_BOARD)
      return { schoolId: school(p) };
    throw new HttpError(403, "Chỉ Ban Giám hiệu được xem khối học");
  },
  class: (p: AuthPrincipal): Prisma.ClassWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["class"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "source-facility": (p: AuthPrincipal): Prisma.SourceFacilityWhereInput => {
    return { supplierId: sourceFacilityManagementScope(p).supplierId };
  },
  "supplier-certification": (
    p: AuthPrincipal,
  ): Prisma.SupplierCertificationWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["supplier-certification"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SUPPLIER") return { supplierId: supplier(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  registration: (p: AuthPrincipal): Prisma.RegistrationRequestWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["registration"]);
    if (p.orgType === "SYSTEM") return {};
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "school-supplier": (
    p: AuthPrincipal,
  ): Prisma.SchoolSupplierRelationshipWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["school-supplier"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    if (p.orgType === "SUPPLIER") return { supplierId: supplier(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "supplier-school": (
    p: AuthPrincipal,
  ): Prisma.SchoolSupplierRelationshipWhereInput => {
    return { supplierId: supplierSchoolReadScope(p).supplierId };
  },
  "ingredient-entry": (p: AuthPrincipal): Prisma.IngredientEntryWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["ingredient-entry"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  allergy: (p: AuthPrincipal): Prisma.ClassAllergyWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["allergy"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { Class: { schoolId: school(p) } };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  delivery: (p: AuthPrincipal): Prisma.DeliveryWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["delivery"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    if (p.orgType === "SUPPLIER") return { supplierId: supplier(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  dish: (p: AuthPrincipal): Prisma.DishWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["dish"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  inventory: (p: AuthPrincipal): Prisma.InventoryTransactionWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["inventory"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        IngredientLot: {
          DeliveryItem: {
            Delivery: { schoolId: school(p) },
          },
        },
      };
    if (p.orgType === "SUPPLIER")
      return {
        IngredientLot: {
          DeliveryItem: { Delivery: { supplierId: supplier(p) } },
        },
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "retained-sample": (
    p: AuthPrincipal,
  ): Prisma.RetainedFoodSampleWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["retained-sample"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        CookingBatch: { MenuDay: { WeeklyMenu: { schoolId: school(p) } } },
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "meal-allocation": (p: AuthPrincipal): Prisma.MealAllocationWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["meal-allocation"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return { DailyMealPortion: { Class: { schoolId: school(p) } } };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "ingredient-quality-feedback": (
    p: AuthPrincipal,
  ): Prisma.ComplaintWhereInput => {
    const scope = ingredientQualityFeedbackReadScope(p, "list");
    if (scope.kind === "SYSTEM") return { kind: "INGREDIENT" };
    if (scope.kind === "SCHOOL") {
      return {
        kind: "INGREDIENT",
        ingredientQualityFeedback: {
          is: { Delivery: { schoolId: scope.schoolId } },
        },
        ...(scope.submittedByUserId
          ? { senderUserId: scope.submittedByUserId }
          : {}),
      };
    }
    return {
      kind: "INGREDIENT",
      ingredientQualityFeedback: {
        is: { Delivery: { supplierId: scope.supplierId } },
      },
    };
  },
  reporting: (
    p: AuthPrincipal,
  ): Prisma.FoodSafetyReportForwardingWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["reporting"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return { FoodSafetyIncident: { schoolId: school(p) } };
    if (p.orgType === "AUTHORITY") return authorityReports(p);
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "food-analysis": (p: AuthPrincipal): Prisma.FoodAnalysisResultWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["food-analysis"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return { FoodSafetyIncident: { schoolId: school(p) } };
    if (p.orgType === "AUTHORITY")
      return {
        FoodSafetyIncident: {
          foodSafetyReportForwardings: {
            some: authorityReports(p),
          },
        },
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "school-alert": (p: AuthPrincipal): Prisma.IncidentSchoolAlertWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["school-alert"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { targetSchoolId: school(p) };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
  "menu-review": (p: AuthPrincipal): Prisma.MenuReviewRecordWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["menu-review"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { WeeklyMenu: { schoolId: school(p) } };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
  },
};
export type Resource = keyof typeof listScopes;

export interface SupplierStaffManagementScope {
  readonly supplierId: string;
}

export function supplierStaffManagementScope(
  principal: AuthPrincipal,
): SupplierStaffManagementScope {
  if (
    principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN ||
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId ||
    principal.communeFoodSafetyUnitId
  )
    throw new HttpError(
      403,
      "Chỉ quản trị viên nhà cung cấp được quản lý nhân viên",
    );
  assertPermission(principal, ...RESOURCE_PERMISSIONS["supplier-staff"]);
  return { supplierId: principal.supplierId };
}

export interface SupplierSchoolReadScope {
  readonly supplierId: string;
}

export function supplierSchoolReadScope(
  principal: AuthPrincipal,
): SupplierSchoolReadScope {
  if (
    principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN ||
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId ||
    principal.communeFoodSafetyUnitId
  )
    throw new HttpError(
      403,
      "Chỉ quản trị viên nhà cung cấp được xem trường đã liên kết",
    );
  assertPermission(principal, ...RESOURCE_PERMISSIONS["supplier-school"]);
  return { supplierId: principal.supplierId };
}

export interface SourceFacilityManagementScope {
  readonly supplierId: string;
}

export function sourceFacilityManagementScope(
  principal: AuthPrincipal,
): SourceFacilityManagementScope {
  if (
    principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN ||
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId ||
    principal.communeFoodSafetyUnitId
  )
    throw new HttpError(
      403,
      "Chỉ quản trị nhà cung cấp được quản lý cơ sở cung cấp",
    );
  assertPermission(principal, "source_facility.manage");
  return { supplierId: principal.supplierId };
}

export interface IngredientManagementScope {
  readonly supplierId: string;
}
export function ingredientManagementScope(
  principal: AuthPrincipal,
): IngredientManagementScope {
  if (
    principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN ||
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId ||
    principal.communeFoodSafetyUnitId
  )
    throw new HttpError(
      403,
      "Chỉ quản trị nhà cung cấp được quản lý nguyên liệu",
    );
  assertPermission(principal, "ingredient.manage");
  return { supplierId: principal.supplierId };
}

export interface SupplierOrderScope {
  readonly supplierId: string;
}

function assertSupplierOrderActor(principal: AuthPrincipal): string {
  if (
    (principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN &&
      principal.role !== ROLES.INGREDIENT_SUPPLIER_STAFF) ||
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId ||
    principal.communeFoodSafetyUnitId
  )
    throw new HttpError(
      403,
      "Chỉ quản trị viên hoặc nhân viên nhà cung cấp được quản lý đơn giao hàng",
    );
  return principal.supplierId;
}

export function supplierOrderManagementScope(
  principal: AuthPrincipal,
): SupplierOrderScope {
  const supplierId = assertSupplierOrderActor(principal);
  assertPermission(principal, "delivery.manage");
  return { supplierId };
}

export function supplierOrderReadScope(
  principal: AuthPrincipal,
): Prisma.DeliveryWhereInput & SupplierOrderScope {
  const supplierId = assertSupplierOrderActor(principal);
  const deliveryScope = listScopes["delivery"](principal);
  return { ...deliveryScope, supplierId };
}

export function supplierOrderSourceOptionScope(
  principal: AuthPrincipal,
): Prisma.SourceFacilityWhereInput & SupplierOrderScope {
  const { supplierId } = supplierOrderManagementScope(principal);
  return { supplierId, status: "ACTIVE" };
}

export function supplierOrderLabelScope(
  principal: AuthPrincipal,
): Prisma.DeliveryWhereInput & SupplierOrderScope {
  return supplierOrderReadScope(principal);
}

export function hasSupplierOrderManagePermission(
  principal: AuthPrincipal,
): boolean {
  return principal.permissions.includes("delivery.manage");
}

export function hasSupplierOrderReadPermission(
  principal: AuthPrincipal,
): boolean {
  return RESOURCE_PERMISSIONS.delivery.some((permission) =>
    principal.permissions.includes(permission),
  );
}

/** School scope for blockchain proof versions; `null` means SYSTEM (unrestricted). */
export function blockchainProofScope(principal: AuthPrincipal): string | null {
  assertPermission(principal, ...RESOURCE_PERMISSIONS["traceability"]);
  if (principal.orgType === "SYSTEM") return null;
  if (principal.orgType === "SCHOOL") return school(principal);
  throw new HttpError(
    403,
    "Loại tổ chức không có phạm vi truy cập tài nguyên này",
  );
}

export type IngredientQualityFeedbackReadScope =
  | { readonly kind: "SUPPLIER"; readonly supplierId: string }
  | {
      readonly kind: "SCHOOL";
      readonly schoolId: string;
      readonly submittedByUserId: string | null;
    }
  | { readonly kind: "SYSTEM" };

export type IngredientQualityFeedbackDetailScope = Exclude<
  IngredientQualityFeedbackReadScope,
  { kind: "SYSTEM" }
>;

export interface IngredientQualityFeedbackResponseScope {
  readonly supplierId: string;
}

function assertSupplierFeedbackActor(principal: AuthPrincipal): string {
  if (
    (principal.role !== ROLES.INGREDIENT_SUPPLIER_ADMIN &&
      principal.role !== ROLES.INGREDIENT_SUPPLIER_STAFF) ||
    principal.orgType !== ORG_TYPES.SUPPLIER ||
    !principal.supplierId ||
    principal.schoolId ||
    principal.communeFoodSafetyUnitId
  ) {
    throw new HttpError(
      403,
      "Chỉ quản trị viên hoặc nhân viên nhà cung cấp được truy cập phản hồi chất lượng nguyên liệu",
    );
  }
  return principal.supplierId;
}

export function ingredientQualityFeedbackReadScope(
  principal: AuthPrincipal,
  mode: "list",
): IngredientQualityFeedbackReadScope;
export function ingredientQualityFeedbackReadScope(
  principal: AuthPrincipal,
  mode: "detail",
): IngredientQualityFeedbackDetailScope;
export function ingredientQualityFeedbackReadScope(
  principal: AuthPrincipal,
  mode: "list" | "detail",
): IngredientQualityFeedbackReadScope {
  assertPermission(
    principal,
    ...RESOURCE_PERMISSIONS["ingredient-quality-feedback"],
  );
  if (principal.orgType === "SYSTEM") {
    if (mode === "detail") {
      throw new HttpError(
        403,
        "Loại tổ chức không có phạm vi truy cập chi tiết phản hồi này",
      );
    }
    return { kind: "SYSTEM" };
  }
  if (principal.orgType === "SCHOOL") {
    const schoolId = school(principal);
    const hasViewDetails = principal.permissions.includes(
      "ingredient_quality_feedback.view_details",
    );
    return {
      kind: "SCHOOL",
      schoolId,
      submittedByUserId: hasViewDetails ? null : principal.id,
    };
  }
  if (principal.orgType === "SUPPLIER") {
    const supplierId = assertSupplierFeedbackActor(principal);
    assertPermission(principal, "ingredient_quality_feedback.view_details");
    return { kind: "SUPPLIER", supplierId };
  }
  throw new HttpError(
    403,
    "Loại tổ chức không có phạm vi truy cập tài nguyên này",
  );
}

export function ingredientQualityFeedbackResponseScope(
  principal: AuthPrincipal,
): IngredientQualityFeedbackResponseScope {
  const supplierId = assertSupplierFeedbackActor(principal);
  assertPermission(principal, "ingredient_quality_feedback.view_details");
  assertPermission(principal, "ingredient_quality_feedback.respond");
  return { supplierId };
}
