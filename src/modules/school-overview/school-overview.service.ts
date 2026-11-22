import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { assertPermission } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { ROLES } from "../../constants/roles";
import { isComplaintSubmitter, listScopes } from "../../utils/resource-access";

function countComplaints(
  rows: { complaintType: string; Complaint: { status: string } }[],
) {
  const counts = new Map<
    string,
    { status: string; type: string; count: number }
  >();
  for (const row of rows) {
    const key = `${row.Complaint.status}|${row.complaintType}`;
    const entry = counts.get(key) ?? {
      status: row.Complaint.status,
      type: row.complaintType,
      count: 0,
    };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()];
}

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
  // Q23: phụ huynh/GVCN chỉ thấy hồ sơ sự cố mình báo (cùng phạm vi với /api/food-safety-incidents).
  const incidentScope =
    allowed("food_safety_incident.view") &&
    principal.role !== ROLES.SCHOOL_ADMINISTRATION
      ? listScopes["food-safety-incident"](principal)
      : null;
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
      // Trạng thái nằm ở bảng cha, loại khiếu nại ở bảng con: đếm theo cặp sau khi đọc.
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
        where: incidentScope
          ? { ...incidentScope, schoolId }
          : { schoolId, id: { in: [] } },
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
    complaints: canReadComplaints ? countComplaints(complaints) : null,
    suppliers: allowed(
      "supplier_relationship.view",
      "supplier_relationship.manage",
    )
      ? suppliers.map(({ status, _count }) => ({ status, count: _count._all }))
      : null,
    incidents: incidentScope ? incidents : null,
    updatedAt: new Date().toISOString(),
  };
}
