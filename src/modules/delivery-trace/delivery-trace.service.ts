import { getDeliveryStatusLabel } from "../../utils/delivery-status";
import { HttpError } from "../../utils/http-error";
import {
  deliveryTraceRepository,
  type DeliveryTraceRepository,
  type PublicDeliveryTraceRecord,
} from "./delivery-trace.repository";
import type {
  PublicDeliveryTraceParamsDTO,
  PublicDeliveryTraceQueryDTO,
} from "./delivery-trace.request.dto";
import type { PublicDeliveryTraceDTO } from "./delivery-trace.response.dto";
import { PUBLIC_TRACE_NOT_FOUND_MESSAGE } from "./delivery-trace.validation";

function mapPublicTrace(
  record: PublicDeliveryTraceRecord,
): PublicDeliveryTraceDTO {
  if (
    record.Delivery.traceabilityVersion !== 1 ||
    !record.sourceFacilityNameSnapshot ||
    !record.ingredientNameSnapshot
  ) {
    throw new HttpError(404, PUBLIC_TRACE_NOT_FOUND_MESSAGE);
  }

  return {
    supplierName: record.Delivery.Supplier.name,
    deliveryNo: record.Delivery.deliveryNo,
    status: record.Delivery.status,
    statusLabel: getDeliveryStatusLabel(record.Delivery.status),
    ingredientName: record.ingredientNameSnapshot,
    actualQuantity: record.actualQuantity.toString(),
    unit: record.unit,
    sourceFacility: {
      name: record.sourceFacilityNameSnapshot,
      facilityCode: record.sourceFacilityCodeSnapshot,
    },
  };
}

export function createDeliveryTraceService(
  repository: DeliveryTraceRepository = deliveryTraceRepository,
) {
  return {
    async getPublicTrace(
      params: PublicDeliveryTraceParamsDTO,
      _query: PublicDeliveryTraceQueryDTO,
    ): Promise<PublicDeliveryTraceDTO> {
      let record: PublicDeliveryTraceRecord | null;
      try {
        const db = await repository.connect();
        record = await repository.findByQrToken(db, params.token);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        console.error("Public delivery trace lookup failed");
        throw new HttpError(503, "Dịch vụ truy xuất tạm thời không khả dụng");
      }

      if (!record) {
        throw new HttpError(404, PUBLIC_TRACE_NOT_FOUND_MESSAGE);
      }

      return mapPublicTrace(record);
    },
  };
}

export const deliveryTraceService = createDeliveryTraceService();
export type DeliveryTraceService = ReturnType<
  typeof createDeliveryTraceService
>;
