import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { assertPermission } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";

export async function getSchoolOverview(
  principal: AuthPrincipal,
  connect: typeof getPrisma = getPrisma,
) {
  assertPermission(principal, "dashboard.view");
  if (principal.orgType !== "SCHOOL" || !principal.schoolId) {
    throw new HttpError(403, "Tài khoản chưa thuộc phạm vi trường học.");
  }
  const db = await connect();
  const schoolId = principal.schoolId;
  const allowed = (...codes: string[]) =>
    codes.some((code) => principal.permissions.includes(code));
  // Dashboard access does not grant access to another business module.
  const [school, menus, complaints, suppliers, incidents] =
    await db.$transaction([
      db.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { id: true, name: true },
      }),
      db.weeklyMenu.findMany({
        where: {
          schoolId,
          ...(!allowed("menu.view") ? { id: { in: [] } } : {}),
        },
        select: { id: true, title: true, status: true, weekStartDate: true },
        orderBy: { weekStartDate: "desc" },
      }),
      db.mealComplaint.groupBy({
        by: ["status", "complaintType"],
        where: {
          MealAllocation: { DailyMealPortion: { Class: { schoolId } } },
          ...(!allowed("meal_complaint.view") ? { id: { in: [] } } : {}),
        },
        _count: { _all: true },
      }),
      db.schoolSupplierRelationship.groupBy({
        by: ["status"],
        where: {
          schoolId,
          ...(!allowed(
            "supplier_relationship.view",
            "supplier_relationship.manage",
          )
            ? { id: { in: [] } }
            : {}),
        },
        _count: { _all: true },
      }),
      db.foodSafetyIncident.findMany({
        where: {
          schoolId,
          ...(!allowed("food_safety_incident.view") ? { id: { in: [] } } : {}),
        },
        select: {
          id: true,
          title: true,
          status: true,
          occurredAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
  return {
    school,
    menus: allowed("menu.view") ? menus : null,
    complaints: allowed("meal_complaint.view")
      ? complaints.map(({ status, complaintType, _count }) => ({
          status,
          type: complaintType,
          count: _count._all,
        }))
      : null,
    suppliers: allowed(
      "supplier_relationship.view",
      "supplier_relationship.manage",
    )
      ? suppliers.map(({ status, _count }) => ({ status, count: _count._all }))
      : null,
    incidents: allowed("food_safety_incident.view") ? incidents : null,
    updatedAt: new Date().toISOString(),
  };
}
