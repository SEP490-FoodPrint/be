import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { assertPermission } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { ROLES } from "../../constants/roles";
import { isComplaintSubmitter } from "../../utils/resource-access";

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
  const canReadComplaints =
    allowed("meal_complaint.view") &&
    (principal.role === ROLES.SCHOOL_MANAGEMENT_BOARD ||
      isComplaintSubmitter(principal.role));
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
      db.mealComplaint.findMany({
        where: {
          schoolId,
          ...(isComplaintSubmitter(principal.role)
            ? { Complaint: { senderUserId: principal.id } }
            : {}),
          ...(!canReadComplaints ? { id: { in: [] } } : {}),
        },
        select: {
          complaintType: true,
          Complaint: { select: { status: true } },
        },
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
    complaints: canReadComplaints
      ? (() => {
          const map = new Map<string, { status: string; type: string; count: number }>();
          for (const item of complaints) {
            const status =
              item.Complaint.status === "RESPONDED"
                ? "RESOLVED"
                : item.Complaint.status;
            const key = `${status}_${item.complaintType}`;
            const existing = map.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              map.set(key, { status, type: item.complaintType, count: 1 });
            }
          }
          return Array.from(map.values());
        })()
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
