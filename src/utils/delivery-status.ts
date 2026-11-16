import type {
  DeliveryStatus,
  SupplyRequestStatus,
} from "../generated/prisma/enums";

const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  CREATED: "Mới tạo",
  PREPARING: "Đang chuẩn bị hàng",
  IN_TRANSIT: "Đang giao hàng",
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

export type SupplierDeliveryNextAction =
  "ENTER_SHIPPING" | "TRACK_DELIVERY" | "VIEW_DELIVERY" | "NONE";

export function resolveSupplierDeliveryNextAction(input: {
  workflowVersion: number | null;
  status: DeliveryStatus;
  supplyRequestStatus: SupplyRequestStatus | null;
  canManage: boolean;
  canRead: boolean;
}): SupplierDeliveryNextAction {
  const sourceTerminal =
    input.supplyRequestStatus === "CANCELLED" ||
    input.supplyRequestStatus === "COMPLETED";
  if (
    input.workflowVersion === 2 &&
    input.status === "PREPARING" &&
    input.canManage &&
    !sourceTerminal
  ) {
    return "ENTER_SHIPPING";
  }
  if (input.status === "IN_TRANSIT" && input.canRead) {
    return "TRACK_DELIVERY";
  }
  if (input.canRead) {
    return "VIEW_DELIVERY";
  }
  return "NONE";
}

export function getAllDeliveryStatusLabels(): Readonly<
  Record<DeliveryStatus, string>
> {
  return DELIVERY_STATUS_LABELS;
}
