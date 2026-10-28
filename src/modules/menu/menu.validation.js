export const MENU_STATUSES = {
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REVISION_REQUESTED: "REVISION_REQUIRED",
}

export const validateApprovalPayload = payload => {
  if (payload?.notes != null && typeof payload.notes !== "string") {
    return ["Ý kiến phê duyệt phải là chuỗi"]
  }
  return []
}

export const validateRevisionPayload = payload => {
  if (!payload?.reason?.trim()) return ["Lý do yêu cầu điều chỉnh là bắt buộc"]
  if (payload.reason.trim().length > 2000) return ["Lý do không được vượt quá 2000 ký tự"]
  return []
}
