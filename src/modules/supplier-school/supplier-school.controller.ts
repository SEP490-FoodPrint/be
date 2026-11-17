import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  supplierSchoolService,
  type SupplierSchoolService,
} from "./supplier-school.service";
import {
  validateSupplierSchoolContractListQuery,
  validateSupplierSchoolContractParams,
  validateSupplierSchoolDocumentParams,
  validateSupplierSchoolDocumentQuery,
  validateSupplierSchoolEmptyQuery,
  validateSupplierSchoolListQuery,
  validateSupplierSchoolParams,
} from "./supplier-school.validation";

function safeAsciiFallbackFileName(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .slice(0, 120);
  return /[A-Za-z0-9]/.test(ascii) ? ascii : "document";
}

function encodeRfc5987ValueChars(value: string): string {
  const safe = Buffer.from(value, "utf8").toString("utf8");
  const target = safe.length > 0 ? safe : "document";
  return encodeURIComponent(target).replace(
    /['()*!]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildContentDispositionHeader(
  disposition: "inline" | "attachment",
  fileName: string,
): string {
  const fallback = safeAsciiFallbackFileName(fileName);
  const encoded = encodeRfc5987ValueChars(fileName);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createSupplierSchoolController(
  service: SupplierSchoolService = supplierSchoolService,
) {
  return {
    listSchools: asyncHandler(async (req, res) => {
      const query = validateSupplierSchoolListQuery(req.query);
      const data = await service.listSchools(query, requirePrincipal(req));
      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(res, data, "Lấy danh sách trường đã liên kết thành công");
    }),
    getSchoolDetail: asyncHandler(async (req, res) => {
      const params = validateSupplierSchoolParams(req.params);
      validateSupplierSchoolEmptyQuery(req.query);
      const data = await service.getSchoolDetail(params, requirePrincipal(req));
      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(res, data, "Lấy chi tiết trường đã liên kết thành công");
    }),
    listContracts: asyncHandler(async (req, res) => {
      const params = validateSupplierSchoolParams(req.params);
      const query = validateSupplierSchoolContractListQuery(req.query);
      const data = await service.listContracts(
        params,
        query,
        requirePrincipal(req),
      );
      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(res, data, "Lấy danh sách hợp đồng thành công");
    }),
    getContractDetail: asyncHandler(async (req, res) => {
      const params = validateSupplierSchoolContractParams(req.params);
      validateSupplierSchoolEmptyQuery(req.query);
      const data = await service.getContractDetail(
        params,
        requirePrincipal(req),
      );
      res.setHeader("Cache-Control", "private, no-store");
      sendSuccess(res, data, "Lấy chi tiết hợp đồng thành công");
    }),
    getDocumentContent: asyncHandler(async (req, res) => {
      const params = validateSupplierSchoolDocumentParams(req.params);
      const query = validateSupplierSchoolDocumentQuery(req.query);
      const file = await service.getDocumentContent(
        params,
        query,
        requirePrincipal(req),
      );
      const body = Buffer.from(file.content);
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        buildContentDispositionHeader(query.disposition, file.fileName),
      );
      res.setHeader("Content-Length", String(body.byteLength));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).send(body);
    }),
  };
}
