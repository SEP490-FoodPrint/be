import { asyncHandler } from "../../utils/async-handler";
import { requirePrincipal } from "../../utils/authorization";
import { sendSuccess } from "../../utils/response";
import {
  accountLifecycleService,
  type AccountLifecycleService,
} from "./account-lifecycle.service";
import {
  validateLifecycleParams,
  validateLifecycleQuery,
  validateLifecycleAction,
  validateIntakeState,
} from "./account-lifecycle.validation";

export function createAccountLifecycleController(
  service: AccountLifecycleService = accountLifecycleService,
) {
  return {
    getLifecycle: asyncHandler(async (req, res) => {
      const params = validateLifecycleParams(req.params);
      validateLifecycleQuery(req.query);
      sendSuccess(
        res,
        await service.getLifecycle(params, requirePrincipal(req)),
      );
    }),
    deactivate: asyncHandler(async (req, res) => {
      const params = validateLifecycleParams(req.params);
      validateLifecycleQuery(req.query);
      validateLifecycleAction(req.body);
      sendSuccess(res, await service.deactivate(params, requirePrincipal(req)));
    }),
    setIntakeState: asyncHandler(async (req, res) => {
      const params = validateLifecycleParams(req.params);
      validateLifecycleQuery(req.query);
      const input = validateIntakeState(req.body);
      sendSuccess(
        res,
        await service.setIntakeState(params, input, requirePrincipal(req)),
      );
    }),
  };
}
