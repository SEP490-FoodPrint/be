import { asyncHandler } from "../../utils/async-handler";
import { requireSessionUser } from "../../utils/session-identity";
import { sendSuccess } from "../../utils/response";
import { profileService, type ProfileService } from "./profile.service";
import { validateProfileUpdate } from "./profile.validation";

export function createProfileController(
  service: ProfileService = profileService,
) {
  return {
    update: asyncHandler(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const data = validateProfileUpdate(req.body as unknown);
      const result = await service.update(requireSessionUser(req), data);
      sendSuccess(res, result, "Cập nhật hồ sơ cá nhân thành công");
    }),
  };
}
