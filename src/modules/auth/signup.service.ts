import bcrypt from "bcryptjs";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { ROLES } from "../../constants/roles";
import type { SignupInput } from "./signup.validation";
import {
  emailVerificationService,
  type EmailVerificationService,
} from "./email-verification.service";

interface RegisteredApplicant {
  user: { id: string; username: string; fullName: string; status: string };
  onboardingRequired: true;
}
export interface SignupReceipt extends RegisteredApplicant {
  emailVerificationRequired: true;
  verificationEmailSent: boolean;
}
export type RegisterApplicant = (
  input: Omit<SignupInput, "password"> & { passwordHash: string },
) => Promise<RegisteredApplicant>;

const registerApplicant: RegisterApplicant = async (input) => {
  const prisma = await getPrisma();
  return prisma.$transaction(async (tx) => {
    const code =
      input.requestType === "SCHOOL"
        ? ROLES.SCHOOL_ADMINISTRATION
        : ROLES.INGREDIENT_SUPPLIER_ADMIN;
    const role = await tx.role.findUnique({
      where: { code },
      select: { id: true, code: true, type: true },
    });
    if (!role || role.type !== input.requestType)
      throw new HttpError(503, "Catalog role đăng ký chưa sẵn sàng");
    const user = await tx.user.create({
      data: {
        username: input.username,
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        phone: input.phone,
        roleId: role.id,
        roleCode: role.code,
        status: "UNVERIFIED",
      },
      select: { id: true, username: true, fullName: true, status: true },
    });
    // Review begins only after the applicant submits a completed profile.
    return { user, onboardingRequired: true };
  });
};

export function createSignupService(
  register: RegisterApplicant = registerApplicant,
  verification: Pick<
    EmailVerificationService,
    "request"
  > = emailVerificationService,
) {
  return {
    async signup(input: SignupInput, ip?: string): Promise<SignupReceipt> {
      const { password, ...data } = input;
      const passwordHash = await bcrypt.hash(password, 12);
      let result: RegisteredApplicant;
      try {
        result = await register({ ...data, passwordHash });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "P2002"
        )
          throw new HttpError(409, "Không thể đăng ký với username/email này");
        throw new HttpError(
          503,
          "Không thể xử lý đăng ký. Vui lòng thử lại sau.",
        );
      }
      let verificationEmailSent = false;
      try {
        verificationEmailSent = await verification.request(input.email, ip);
      } catch {
        console.error("Signup account created; verification email not sent");
      }
      return {
        ...result,
        emailVerificationRequired: true,
        verificationEmailSent,
      };
    },
  };
}
export type SignupService = ReturnType<typeof createSignupService>;
export const signupService = createSignupService();
