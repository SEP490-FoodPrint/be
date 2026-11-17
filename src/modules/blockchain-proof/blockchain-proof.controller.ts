import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  blockchainProofService,
  type BlockchainProofService,
} from "./blockchain-proof.service";
import {
  validateChainParams,
  validateGradeChainQuery,
  validateGradeMealsQuery,
  validateGradeParams,
  validatePublicGradeChainQuery,
  validatePublicGradeMealsQuery,
  validatePublicGradeParams,
  validatePublicSchoolParams,
  validateChainQuery,
  validateRecordParams,
  validateVersionParams,
} from "./blockchain-proof.validation";

export function createBlockchainProofController(
  service: BlockchainProofService = blockchainProofService,
) {
  return {
    listVersions: asyncHandler(async (req, res) => {
      const params = validateRecordParams(req.params);
      const result = await service.listVersions(params, requirePrincipal(req));
      sendSuccess(
        res,
        result,
        "Lấy danh sách bằng chứng blockchain thành công",
      );
    }),
    anchor: asyncHandler(async (req, res) => {
      const params = validateVersionParams(req.params);
      const result = await service.anchor(params, requirePrincipal(req));
      sendSuccess(res, result, "Đã gửi lại bằng chứng lên blockchain");
    }),
    verify: asyncHandler(async (req, res) => {
      const params = validateVersionParams(req.params);
      const result = await service.verify(params, requirePrincipal(req));
      sendSuccess(res, result, "Đã xác minh bằng chứng blockchain");
    }),
    gradeMeals: asyncHandler(async (req, res) => {
      const query = validateGradeMealsQuery(req.query);
      const result = await service.gradeMeals(query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy danh sách bữa ăn theo khối thành công");
    }),
    gradeChain: asyncHandler(async (req, res) => {
      const params = validateGradeParams(req.params);
      const query = validateGradeChainQuery(req.query);
      const result = await service.gradeChain(
        params,
        query,
        requirePrincipal(req),
      );
      sendSuccess(res, result, "Lấy hành trình bữa ăn của khối thành công");
    }),
    publicGradeMeals: asyncHandler(async (req, res) => {
      const params = validatePublicSchoolParams(req.params);
      const query = validatePublicGradeMealsQuery(req.query);
      const result = await service.publicGradeMeals(params, query);
      sendSuccess(res, result, "Lấy danh sách bữa ăn theo khối thành công");
    }),
    publicGradeChain: asyncHandler(async (req, res) => {
      const params = validatePublicGradeParams(req.params);
      const query = validatePublicGradeChainQuery(req.query);
      const result = await service.publicGradeChain(params, query);
      sendSuccess(res, result, "Lấy hành trình bữa ăn của khối thành công");
    }),
    publicMealAllocationChain: asyncHandler(async (req, res) => {
      const params = validateChainParams(req.params);
      const query = validateChainQuery(req.query);
      const result = await service.publicMealAllocationChain(
        params.mealAllocationId,
        query.verify,
      );
      sendSuccess(res, result, "Lấy chuỗi bằng chứng blockchain thành công");
    }),
    chain: asyncHandler(async (req, res) => {
      const params = validateChainParams(req.params);
      const query = validateChainQuery(req.query);
      const result = await service.chain(params, query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy chuỗi bằng chứng blockchain thành công");
    }),
  };
}
