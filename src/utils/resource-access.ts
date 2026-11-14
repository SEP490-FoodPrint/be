import { ROLES, ORG_TYPES } from "../constants/roles";
import type { Prisma } from "../generated/prisma/client";
import type { AuthPrincipal } from "../types/auth";
import { assertPermission, assertOrganizationManager } from "./authorization";
import { HttpError } from "./http-error";
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
  organization: ["school.manage"],
  ingredient: ["ingredient.view", "ingredient.manage"],
  menu: ["menu.view"],
  "supply-order": ["supply_request.view"],
  warehouse: ["inventory.view"],
  kitchen: ["cooking_batch.view"],
  "meal-attendance": ["daily_meal_portion.view"],
  feedback: ["meal_complaint.view"],
  inspection: ["food_safety_incident.view"],
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
      return { ingredientEntries: { some: { schoolId: school(p) } } };
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
        DeliveryItem: { Delivery: { SupplyRequest: { schoolId: school(p) } } },
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
  feedback: (p: AuthPrincipal): Prisma.MealComplaintWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["feedback"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL" && p.role === ROLES.SCHOOL_MANAGEMENT_BOARD)
      return { DailyMealPortion: { Class: { schoolId: school(p) } } };
    if (p.orgType === "SCHOOL" && isComplaintSubmitter(p.role))
      return {
        DailyMealPortion: { Class: { schoolId: school(p) } },
        submittedByUserId: p.id,
      };
    throw new HttpError(403, "Vai trò không được phép xem khiếu nại");
  },
  inspection: (p: AuthPrincipal): Prisma.FoodSafetyIncidentWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["inspection"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL") return { schoolId: school(p) };
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
    if (p.orgType === "SCHOOL")
      return { SupplyRequest: { schoolId: school(p) } };
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
            Delivery: { SupplyRequest: { schoolId: school(p) } },
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
  ): Prisma.IngredientQualityFeedbackWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["ingredient-quality-feedback"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        Delivery: { SupplyRequest: { schoolId: school(p) } },
        ...(p.permissions.includes("ingredient_quality_feedback.view_details")
          ? {}
          : { submittedByUserId: p.id }),
      };
    if (p.orgType === "SUPPLIER")
      return {
        Delivery: { supplierId: supplier(p) },
        ...(p.permissions.includes("ingredient_quality_feedback.view_details")
          ? {}
          : { submittedByUserId: p.id }),
      };
    throw new HttpError(
      403,
      "Loại tổ chức không có phạm vi truy cập tài nguyên này",
    );
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
  traceability: (p: AuthPrincipal): Prisma.TraceabilityAnchorWhereInput => {
    assertPermission(p, ...RESOURCE_PERMISSIONS["traceability"]);
    if (p.orgType === "SYSTEM") return {};
    if (p.orgType === "SCHOOL")
      return {
        OR: [
          { Delivery: { SupplyRequest: { schoolId: school(p) } } },
          {
            IngredientLot: {
              DeliveryItem: {
                Delivery: { SupplyRequest: { schoolId: school(p) } },
              },
            },
          },
          {
            CookingBatch: { MenuDay: { WeeklyMenu: { schoolId: school(p) } } },
          },
          {
            MealAllocation: {
              DailyMealPortion: { Class: { schoolId: school(p) } },
            },
          },
          { FoodSafetyIncident: { schoolId: school(p) } },
        ],
      };
    if (p.orgType === "SUPPLIER")
      return {
        OR: [
          { Delivery: { supplierId: supplier(p) } },
          {
            IngredientLot: {
              DeliveryItem: { Delivery: { supplierId: supplier(p) } },
            },
          },
        ],
      };
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
};
export type Resource = keyof typeof listScopes;

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
