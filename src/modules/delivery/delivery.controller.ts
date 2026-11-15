import { requirePrincipal } from "../../utils/authorization";
import { uploadRecordPhoto, removeRecordPhoto } from "../../utils/record-photo";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import { deliveryService, type DeliveryService } from "./delivery.service";
import {
  validateDeliveryArrivalBody,
  validateDeliveryArrivalQuery,
  validateDeliveryListQuery,
  validateDeliveryInspectionQuery,
  validateDeliveryId,
  validateDeliveryInspectionDecision,
} from "./delivery.validation";
import type { DeliveryInspectionService } from "./delivery.service";

export function createDeliveryInspectionController(
  service: DeliveryInspectionService,
) {
  return {
    arrive: asyncHandler(async (req, res) => {
      const id = validateDeliveryId(req.params).id;
      const query = validateDeliveryArrivalQuery(req.query);
      const body = validateDeliveryArrivalBody(req.body);
      const result = await service.arrive(
        id,
        body,
        query,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Xác nhận đợt giao đã đến trường thành công");
    }),
    decide: asyncHandler(async (req, res) => {
      const id = validateDeliveryId(req.params).id;
      const input = validateDeliveryInspectionDecision(req.body);
      const principal = requirePrincipal(req);
      const upload = await uploadRecordPhoto(principal.id, req.file);
      let result;
      try {
        result = await service.decide(id, input, principal, upload?.photo);
      } catch (error) {
        if (upload) await removeRecordPhoto(upload.document);
        throw error;
      }
      if (upload && !result.created) await removeRecordPhoto(upload.document);
      sendSuccess(res, result, "Đã ghi nhận kiểm tra đợt giao");
    }),
    list: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.list(
          validateDeliveryInspectionQuery(req.query),
          requirePrincipal(req),
        ),
      );
    }),
    detail: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.detail(
          validateDeliveryId(req.params).id,
          requirePrincipal(req),
        ),
      );
    }),
  };
}

export function createDeliveryController(
  service: DeliveryService = deliveryService,
) {
  return {
    getAll: asyncHandler(async (req, res) => {
      const query = validateDeliveryListQuery(req.query);
      const result = await service.getAll(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách đợt giao hàng thành công");
    }),
  };
}
