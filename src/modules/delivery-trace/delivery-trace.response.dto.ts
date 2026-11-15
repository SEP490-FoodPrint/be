import type { DeliveryStatus } from "../../generated/prisma/enums";

export interface PublicDeliveryTraceSourceFacilityDTO {
  name: string;
  facilityCode: string | null;
}

export interface PublicDeliveryTraceDTO {
  supplierName: string;
  deliveryNo: string;
  status: DeliveryStatus;
  statusLabel: string;
  ingredientName: string;
  actualQuantity: string;
  unit: string;
  sourceFacility: PublicDeliveryTraceSourceFacilityDTO;
}
