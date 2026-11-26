import type {
  ApprovalDecision,
  DeliveryPreparationStage,
  DeliveryStatus,
  IngredientLotStatus,
} from "../../generated/prisma/enums";

export interface DeliveryInspectionDTO {
  id: string;
  deliveryNo: string;
  schoolId: string;
  sourceType: "REQUEST" | "STANDALONE";
  traceabilityVersion: number | null;
  isDryOnly?: boolean;
  supplyRequestId: string | null;
  requestNo: string | null;
  orderType: "DIRECT_USE" | "DRY_STOCK" | null;
  batchNo: number | null;
  supplierName: string;
  status: DeliveryStatus;
  statusLabel: string;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  vehiclePlate: string | null;
  note: string | null;
  currentRole: string;
  currentTier?: "PRIMARY" | "REQUIRED" | "OPTIONAL" | null;
  canConfirmArrival?: boolean;
  canInspect: boolean;
  approvalSummary?: {
    requiredApproved: number;
    requiredTotal: number;
    optionalApproved: number;
    optionalTotal: number;
  };
  /**
   * Lý do đợt giao không thể tiếp nhận vào kho (dữ liệu lô/danh mục không khớp),
   * kiểm tra sớm khi xe đến và trước chữ ký "Đạt" đầu tiên; null nếu hợp lệ.
   */
  receiptIssue?: string | null;
  redeliveryRequiredCount: number | null;
  redeliveryLimit: number | null;
  cancellationNotice: string | null;
  requiredRoles: {
    code: string;
    name: string;
    tier?: "PRIMARY" | "REQUIRED" | "OPTIONAL";
    tierLabel?: string;
  }[];
  deliveryApprovals: {
    id: string;
    roleCode: string;
    roleName: string;
    userName: string;
    decision: ApprovalDecision;
    reason: string | null;
    photoUrl: string | null;
    decidedAt: string;
  }[];
  deliveryItems?: {
    id: string;
    ingredientName: string;
    category: string | null;
    actualQuantity: string;
    sampleTopUpQuantity?: string;
    unit: string;
    sourceFacility: {
      id: string | null;
      name: string;
      facilityCode: string | null;
    } | null;
    /** Link truy xuất trên nhãn QR bao bì do NCC tạo khi lập đơn giao (null với đơn cũ). */
    traceUrl: string | null;
    /** Ảnh PNG (data URL) của đúng mã QR đó; null nếu không có hoặc tạo ảnh lỗi. */
    qrImageDataUrl: string | null;
    ingredientLots: {
      id: string;
      lotCode: string;
      qrToken: string;
      sourceFacility: string | null;
      manufactureDate: string | null;
      expiryDate: string | null;
      receivedQuantity: string;
      unit: string;
      status: IngredientLotStatus;
    }[];
  }[];
}

export interface DeliveryInspectionLookupResultDTO {
  id: string;
  deliveryNo: string;
}

export interface DeliveryApprovalItemDTO {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  userId: string;
  userName: string;
  decision: ApprovalDecision;
  reason: string | null;
  decidedAt: string;
}

export interface DeliveryItemSummaryDTO {
  id: string;
  actualQuantity: string;
  sampleTopUpQuantity?: string;
  unit: string;
  note: string | null;
  requestedQuantity: string | null;
  ingredientName: string | null;
  handlingType: string | null;
}

export interface DeliveryListItemDTO {
  id: string;
  deliveryNo: string;
  supplyRequestId: string | null;
  orderNo: string | null;
  requestNo: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierPhone?: string | null;
  status: DeliveryStatus;
  /** Đợt 2 nấu riêng: giai đoạn chuẩn bị của chuyến (UC 23); null với chuyến khác. */
  preparationStage: DeliveryPreparationStage | null;
  vehiclePlate: string | null;
  expectedArrivalAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  requestedDeliveryDate?: string | null;
  note: string | null;
  deliveryApprovals: DeliveryApprovalItemDTO[];
  deliveryItems?: DeliveryItemSummaryDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryListResponseDTO {
  items: DeliveryListItemDTO[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
  };
}
