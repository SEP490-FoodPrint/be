import { HttpError } from "../../utils/http-error";

export type DayStatus =
  "DRAFT" | "PENDING_APPROVAL" | "REVISION_REQUIRED" | "APPROVED";
export type ApprovalDay = { id: string; approvalStatus: DayStatus };

export function decisionTargets(
  days: ApprovalDay[],
  menuDayId?: string,
): ApprovalDay[] {
  if (menuDayId && !days.some((day) => day.id === menuDayId)) {
    throw new HttpError(404, "Ngày thực đơn không thuộc tuần này");
  }
  const targets = days.filter(
    (day) =>
      (!menuDayId || day.id === menuDayId) &&
      day.approvalStatus === "PENDING_APPROVAL",
  );
  if (!targets.length) {
    throw new HttpError(409, "Không còn ngày chờ duyệt trong phạm vi đã chọn");
  }
  return targets;
}

export function aggregateDayStatus(days: ApprovalDay[]): DayStatus {
  if (days.length && days.every((day) => day.approvalStatus === "APPROVED"))
    return "APPROVED";
  if (days.some((day) => day.approvalStatus === "REVISION_REQUIRED"))
    return "REVISION_REQUIRED";
  return "PENDING_APPROVAL";
}
