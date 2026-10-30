import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { objectBody, uuid } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
import { sendSuccess } from "../../utils/response";
import * as service from "./supplier-onboarding.service";
import {
  activationPayload,
  contractPayload,
  listQuery,
  orderPayload,
  reasonPayload,
} from "./supplier-onboarding.validation";

export const onboardingController = {
  directory: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.directory(requirePrincipal(req), listQuery(req.query)),
    );
  }),
  filters: asyncHandler(async (req, res) => {
    sendSuccess(res, {
      categories: await service.categories(requirePrincipal(req)),
    });
  }),
  locations: asyncHandler(async (req, res) => {
    objectBody(req.query, ["parentId"]);
    sendSuccess(
      res,
      await service.locations(
        requirePrincipal(req),
        req.query.parentId ? uuid(req.query.parentId) : undefined,
      ),
    );
  }),
  detail: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.supplierDetail(
        requirePrincipal(req),
        uuid(req.params.supplierId),
      ),
    );
  }),
  partners: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.partners(requirePrincipal(req), listQuery(req.query)),
    );
  }),
  contract: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.getContract(requirePrincipal(req), uuid(req.params.id)),
    );
  }),
  create: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.saveDraft(
        requirePrincipal(req),
        contractPayload(req.body as unknown, true),
      ),
    );
  }),
  update: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.saveDraft(
        requirePrincipal(req),
        contractPayload(req.body as unknown, false),
        uuid(req.params.id),
      ),
    );
  }),
  upload: asyncHandler(async (req, res) => {
    const body = objectBody(req.body as unknown, ["kind"]);
    if (!req.file || typeof body.kind !== "string")
      throw new HttpError(400, "Chọn loại hồ sơ và tệp tải lên.");
    sendSuccess(
      res,
      await service.uploadDocument(
        requirePrincipal(req),
        uuid(req.params.id),
        body.kind,
        req.file,
      ),
    );
  }),
  download: asyncHandler(async (req, res) => {
    const file = await service.downloadDocument(
      requirePrincipal(req),
      uuid(req.params.id),
    );
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(file.content));
  }),
  removeDocument: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.removeDocument(requirePrincipal(req), uuid(req.params.id)),
    );
  }),
  activate: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.activateContract(
        requirePrincipal(req),
        uuid(req.params.id),
        activationPayload(req.body as unknown),
      ),
    );
  }),
  close: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.closeContract(
        requirePrincipal(req),
        uuid(req.params.id),
        reasonPayload(req.body as unknown),
      ),
    );
  }),
  transition: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.changeRelationship(
        requirePrincipal(req),
        uuid(req.params.id),
        String(req.params.action),
        reasonPayload(req.body as unknown),
      ),
    );
  }),
  createOrder: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.createOrderDraft(
        requirePrincipal(req),
        orderPayload(req.body as unknown),
      ),
    );
  }),
  sendOrder: asyncHandler(async (req, res) => {
    const body = objectBody(req.body as unknown, ["contractId"]);
    sendSuccess(
      res,
      await service.sendOrder(
        requirePrincipal(req),
        uuid(req.params.id),
        uuid(body.contractId),
      ),
    );
  }),
  orderEvidence: asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await service.orderEvidence(requirePrincipal(req), uuid(req.params.id)),
    );
  }),
};
