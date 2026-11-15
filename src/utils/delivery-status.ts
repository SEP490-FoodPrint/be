import type { DeliveryStatus } from "../generated/prisma/enums";

const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  CREATED: "Mới tạo",
  IN_TRANSIT: "Đang giao",
  ARRIVED: "Đã đến nơi",
  PENDING_APPROVAL: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Yêu cầu giao hàng lại",
  CANCELLED_MEAL: "Đã hủy suất ăn",
  RECEIVED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

export function getDeliveryStatusLabel(status: DeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}

export function getAllDeliveryStatusLabels(): Readonly<
  Record<DeliveryStatus, string>
> {
  return DELIVERY_STATUS_LABELS;
}
