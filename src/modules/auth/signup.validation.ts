import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";
import { validateNewPassword } from "./password.validation";

export interface SignupInput {
  username: string;
  email: string;
  password: string;
  fullName: string;
  phone: string | null;
  requestType: "SCHOOL" | "SUPPLIER";
}

export function validateSignup(value: unknown): SignupInput {
  const body = objectBody(value, [
    "username",
    "email",
    "password",
    "fullName",
    "phone",
    "requestType",
  ]);
  const username = text(body.username, 120);
  const email = text(body.email, 254).toLowerCase();
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,119}$/.test(username) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new HttpError(400, "Username hoặc email không hợp lệ");
  const password = validateNewPassword(body.password);
  const requestType = body.requestType;
  if (requestType !== "SCHOOL" && requestType !== "SUPPLIER")
    throw new HttpError(400, "Chỉ hỗ trợ đăng ký SCHOOL hoặc SUPPLIER");
  return {
    username,
    email,
    password,
    fullName: text(body.fullName, 255),
    phone:
      body.phone === undefined || body.phone === null
        ? null
        : text(body.phone, 30),
    requestType,
  };
}
