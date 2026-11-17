import { requirePrincipal } from "../../utils/authorization";
import { asyncHandler } from "../../utils/async-handler";
import { sendSuccess } from "../../utils/response";
import {
  blockchainProofService,
  type BlockchainProofService,
} from "./blockchain-proof.service";
import {
  validateChainParams,
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
    chain: asyncHandler(async (req, res) => {
      const params = validateChainParams(req.params);
      const query = validateChainQuery(req.query);
      const result = await service.chain(params, query, requirePrincipal(req));
      sendSuccess(res, result, "Lấy chuỗi bằng chứng blockchain thành công");
    }),
  };
}
