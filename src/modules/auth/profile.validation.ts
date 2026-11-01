import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";

export interface PersonalProfileUpdate {
  fullName?: string;
  phone?: string | null;
}

export function validateProfileUpdate(value: unknown): PersonalProfileUpdate {
  const body = objectBody(value, ["fullName", "phone"]);
  if (Object.keys(body).length === 0)
    throw new HttpError(400, "Cần cung cấp fullName hoặc phone để cập nhật");
  const update: PersonalProfileUpdate = {};
  if (Object.hasOwn(body, "fullName"))
    update.fullName = text(body.fullName, 255);
  if (Object.hasOwn(body, "phone")) {
    if (
      body.phone === null ||
      (typeof body.phone === "string" && !body.phone.trim())
    )
      update.phone = null;
    else update.phone = text(body.phone, 30);
  }
  return update;
}
