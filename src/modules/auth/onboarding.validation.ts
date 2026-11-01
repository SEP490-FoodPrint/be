import { objectBody, text } from "../../utils/auth-validation";
import { HttpError } from "../../utils/http-error";

export const MAX_CERTIFICATIONS = 20;
export interface CertificationInput {
  certificationType: string;
  certificateNo: string;
  issuedDate: string | null;
  expiryDate: string | null;
}
export interface OrganizationProfile {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
}
export type OnboardingProfile =
  | {
      requestType: "SCHOOL";
      profileData: OrganizationProfile & { code: string | null };
    }
  | {
      requestType: "SUPPLIER";
      profileData: OrganizationProfile & {
        taxCode: string | null;
        certifications: CertificationInput[];
      };
    };

function optionalText(value: unknown, maximum: number): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : text(value, maximum);
}
function calendarDate(value: unknown): string | null {
  const date = optionalText(value, 10);
  if (date === null) return null;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || date.startsWith("0000"))
    throw new HttpError(400, "Ngày phải có định dạng YYYY-MM-DD hợp lệ");
  const parsed = new Date(date + "T00:00:00.000Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new HttpError(400, "Ngày không tồn tại trong lịch");
  return date;
}

export function validateOnboarding(
  value: unknown,
  requestType: "SCHOOL" | "SUPPLIER",
): OnboardingProfile {
  const body = objectBody(value, [
    "name",
    "email",
    "phone",
    "address",
    ...(requestType === "SCHOOL" ? ["code"] : ["taxCode", "certifications"]),
  ]);
  const email = optionalText(body.email, 254)?.toLowerCase() ?? null;
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "Email liên hệ không hợp lệ");
  const common = {
    name: text(body.name, 255),
    email,
    phone: optionalText(body.phone, 30),
    address: optionalText(body.address, 4000),
  };
  if (requestType === "SCHOOL")
    return {
      requestType,
      profileData: { ...common, code: optionalText(body.code, 80) },
    };
  const source: unknown = body.certifications ?? [];
  if (!Array.isArray(source) || source.length > MAX_CERTIFICATIONS)
    throw new HttpError(
      400,
      `Chứng nhận phải là mảng tối đa ${MAX_CERTIFICATIONS} mục`,
    );
  const numbers = new Set<string>();
  const certifications = source.map((item: unknown): CertificationInput => {
    const row = objectBody(item, [
      "certificationType",
      "certificateNo",
      "issuedDate",
      "expiryDate",
    ]);
    const certificateNo = text(row.certificateNo, 120);
    if (numbers.has(certificateNo))
      throw new HttpError(400, "Số chứng nhận không được trùng trong hồ sơ");
    numbers.add(certificateNo);
    const issuedDate = calendarDate(row.issuedDate);
    const expiryDate = calendarDate(row.expiryDate);
    if (issuedDate && expiryDate && expiryDate < issuedDate)
      throw new HttpError(400, "Ngày hết hạn phải bằng hoặc sau ngày cấp");
    return {
      certificationType: text(row.certificationType, 120),
      certificateNo,
      issuedDate,
      expiryDate,
    };
  });
  return {
    requestType,
    profileData: {
      ...common,
      taxCode: optionalText(body.taxCode, 80),
      certifications,
    },
  };
}

export function readProfileBody(body: unknown, multipart: boolean): unknown {
  if (!multipart) return body;
  const fields = objectBody(body, ["profile"]);
  if (typeof fields.profile !== "string")
    throw new HttpError(400, "Multipart cần trường profile chứa JSON");
  try {
    return JSON.parse(fields.profile) as unknown;
  } catch {
    throw new HttpError(400, "profile không phải JSON hợp lệ");
  }
}
