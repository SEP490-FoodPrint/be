import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  ingredientService,
  type IngredientService,
} from "./ingredient.service";
import {
  validateIngredientListQuery,
  validateIngredientQuery,
  validateIngredientParams,
  validateIngredientCreate,
  validateIngredientUpdate,
  validateIngredientHide,
  validateIngredientUploadEnvelope,
  validateIngredientSingleUpload,
  validateIngredientMultipleUpload,
} from "./ingredient.validation";

export function createIngredientController(
  service: IngredientService = ingredientService,
) {
  return {
    authorizeUpload: (
      req: import("express").Request,
      _res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      void service
        .authorizeUpload(requirePrincipal(req))
        .then(() => next())
        .catch(next);
    },
    uploadImage: asyncHandler(async (req, res) => {
      validateIngredientUploadEnvelope(req.body, req.query);
      const files = Array.isArray(req.files) ? req.files : [];
      sendSuccess(
        res,
        await service.uploadImage(
          validateIngredientSingleUpload(files),
          requirePrincipal(req),
        ),
        "Tải ảnh thành công",
        201,
      );
    }),
    uploadImages: asyncHandler(async (req, res) => {
      validateIngredientUploadEnvelope(req.body, req.query);
      const files = Array.isArray(req.files) ? req.files : [];
      sendSuccess(
        res,
        await service.uploadImages(
          validateIngredientMultipleUpload(files),
          requirePrincipal(req),
        ),
        "Đã xử lý lượt tải ảnh",
        200,
      );
    }),
    getAll: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getAll(
          validateIngredientListQuery(req.query),
          requirePrincipal(req),
        ),
        "Lấy danh sách nguyên liệu thành công",
      );
    }),
    listManagement: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.listManagement(
          validateIngredientQuery(req.query),
          requirePrincipal(req),
        ),
      );
    }),
    listCategories: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.listCategories(
          validateIngredientQuery(req.query),
          requirePrincipal(req),
        ),
      );
    }),
    getDetail: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.getDetail(
          validateIngredientParams(req.params),
          requirePrincipal(req),
        ),
      );
    }),
    create: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.create(
          validateIngredientCreate(req.body),
          requirePrincipal(req),
        ),
        "Thêm nguyên liệu thành công",
        201,
      );
    }),
    update: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.update(
          validateIngredientParams(req.params),
          validateIngredientUpdate(req.body),
          requirePrincipal(req),
        ),
        "Sửa nguyên liệu thành công",
      );
    }),
    hide: asyncHandler(async (req, res) => {
      sendSuccess(
        res,
        await service.hide(
          validateIngredientParams(req.params),
          validateIngredientHide(req.body),
          requirePrincipal(req),
        ),
        "Ẩn nguyên liệu thành công",
      );
    }),
  };
}
