import type { Response } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { HttpError } from "../../utils/http-error";
import {
  renderPublicTraceErrorHtml,
  renderPublicTraceHtml,
} from "../../utils/public-trace-html";
import { RequestValidationError } from "../../utils/request-validation";
import { sendError, sendSuccess } from "../../utils/response";
import {
  deliveryTraceService,
  type DeliveryTraceService,
} from "./delivery-trace.service";
import {
  validatePublicDeliveryTraceParams,
  validatePublicDeliveryTraceQuery,
} from "./delivery-trace.validation";

function applyPublicTraceHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader("Vary", "Accept");
}

export function createDeliveryTraceController(
  service: DeliveryTraceService = deliveryTraceService,
) {
  return {
    getPublicTrace: asyncHandler(async (req, res) => {
      applyPublicTraceHeaders(res);
      const negotiated = req.accepts(["application/json", "text/html"]);
      if (negotiated === false) {
        sendError(res, "Định dạng phản hồi không được hỗ trợ", 406);
        return;
      }

      try {
        const params = validatePublicDeliveryTraceParams(req.params);
        const query = validatePublicDeliveryTraceQuery(req.query);
        const result = await service.getPublicTrace(params, query);

        if (negotiated === "text/html") {
          res
            .status(200)
            .type("text/html; charset=utf-8")
            .send(renderPublicTraceHtml(result));
          return;
        }

        sendSuccess(
          res,
          result,
          "Lấy thông tin truy xuất nguyên liệu thành công",
        );
      } catch (error) {
        let statusCode = 503;
        let message = "Dịch vụ truy xuất tạm thời không khả dụng";
        let fields: unknown;

        if (error instanceof RequestValidationError) {
          statusCode = error.statusCode;
          message = error.message;
          fields = error.fields;
        } else if (error instanceof HttpError) {
          statusCode = error.statusCode;
          message = error.message;
        }

        if (negotiated === "text/html") {
          res
            .status(statusCode)
            .type("text/html; charset=utf-8")
            .send(renderPublicTraceErrorHtml(statusCode, message));
          return;
        }

        sendError(res, message, statusCode, fields ? { fields } : null);
      }
    }),
  };
}
