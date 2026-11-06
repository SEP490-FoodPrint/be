import type { PrismaClient } from "../../generated/prisma/client";
import type { SessionUser } from "../../types/session-user";
import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { loadSessionUser } from "../../utils/session-identity";
import {
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
  assertPermission,
  assertSystemManager,
  type AuthorizationClient,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import {
  documentStorage,
  readDocuments,
  validateProfileFiles,
  type DocumentStorage,
  type OnboardingDocument,
} from "../../utils/onboarding-documents";
import { validateOnboarding } from "./onboarding.validation";
import { retainDocuments } from "./onboarding-submission";
import { reviewVersion } from "./registration-review";
import { reviewEmail } from "./registration-review-email";
import {
  onboardingRepository,
  type Application,
  type ReviewRow,
} from "./onboarding.repository";
import { formatRegistrationID } from "../../utils/registration-id";
import type {
  OnboardingSubmitRequestDTO,
  RegistrationParamsRequestDTO,
  RegistrationApproveRequestDTO,
  RegistrationRejectRequestDTO,
  OwnDocumentParamsRequestDTO,
  ReviewDocumentRequestDTO,
} from "./auth.request.dto";
import type {
  OnboardingResponseDTO,
  ReviewResponseDTO,
  SubmissionResponseDTO,
  ReviewDecisionResponseDTO,
} from "./auth.response.dto";

function applicant(user: SessionUser): "SCHOOL" | "SUPPLIER" {
  if (
    user.status !== "UNVERIFIED" ||
    !["SCHOOL", "SUPPLIER"].includes(user.orgType)
  )
    throw new HttpError(403, "Chỉ tài khoản đăng ký UNVERIFIED được nộp hồ sơ");
  if (user.schoolId || user.supplierId || user.communeFoodSafetyUnitId)
    throw new HttpError(
      409,
      "Tài khoản đã gắn tổ chức; cần kiểm tra trước khi nộp hồ sơ",
    );
  return user.orgType as "SCHOOL" | "SUPPLIER";
}
function view(row: Application): OnboardingResponseDTO {
  return {
    id: row.id,
    registrationID: formatRegistrationID(row.registrationNumber),
    applicantUserId: row.applicantUserId,
    requestType: row.requestType,
    status: row.status,
    profileData: validateOnboarding(row.profileData, row.requestType)
      .profileData,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    updatedAt: row.updatedAt.toISOString(),
    documents: readDocuments(row.supportingDocuments, row.applicantUserId).map(
      (document) => ({
        id: document.id,
        field: document.field,
        format: document.format,
        fileName: document.fileName,
        bytes: document.bytes,
      }),
    ),
  };
}
function reviewView(row: ReviewRow): ReviewResponseDTO {
  return {
    ...view(row),
    applicantUser: {
      id: row.applicantUser.id,
      username: row.applicantUser.username,
      fullName: row.applicantUser.fullName,
      email: row.applicantUser.email,
      phone: row.applicantUser.phone,
      status: row.applicantUser.status,
      emailVerifiedAt: row.applicantUser.emailVerifiedAt?.toISOString() ?? null,
    },
    reviewedByUserId: row.reviewedByUserId,
    reviewedByUser: row.reviewedByUser
      ? { id: row.reviewedByUser.id, fullName: row.reviewedByUser.fullName }
      : null,
    reviewVersion: reviewVersion(row),
  };
}
async function createOrganization<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new HttpError(
        409,
        "Mã trường hoặc mã số thuế đã tồn tại; cần kiểm tra hồ sơ",
        "ORGANIZATION_CONFLICT",
      );
    throw error;
  }
}
const lockApplicant = (tx: AuthorizationClient, id: string) =>
  onboardingRepository.lockApplicant(tx, id);
async function editable(tx: AuthorizationClient, userId: string) {
  const user = await lockApplicant(tx, userId);
  const requestType = applicant(user);
  const current = await onboardingRepository.findOwn(tx, userId);
  if (
    current &&
    (current.requestType !== requestType ||
      !["PENDING", "REJECTED"].includes(current.status))
  )
    throw new HttpError(409, "Hồ sơ đã được duyệt và không còn được chỉnh sửa");
  return { requestType, current };
}

export function createOnboardingService(
  connect: () => Promise<PrismaClient> = getPrisma,
  storage: DocumentStorage = documentStorage,
) {
  async function readOwn(user: SessionUser) {
    const db = await connect();
    return databaseOperation(async () => {
      await loadSessionUser(user.id, db);
      return onboardingRepository.findOwn(db, user.id);
    });
  }
  async function reviewedApplication(
    tx: AuthorizationClient,
    actor: AuthPrincipal,
    id: string,
    permission: string,
    expectedVersion: string,
  ) {
    assertSystemManager(await loadPrincipal(actor.id, tx), permission);
    // Lock order matches submission: applicant first, then registration row updates.
    const header = await onboardingRepository.findHeader(
      tx,
      { kind: "system" },
      id,
    );
    if (!header) throw new HttpError(404, "Không tìm thấy hồ sơ");
    const user = await lockApplicant(tx, header.applicantUserId);
    const row = await onboardingRepository.findReview(
      tx,
      { kind: "system" },
      id,
    );
    if (!row) throw new HttpError(404, "Không tìm thấy hồ sơ");
    if (row.status !== "PENDING")
      throw new HttpError(
        409,
        "Hồ sơ không còn chờ duyệt",
        "REGISTRATION_ALREADY_REVIEWED",
      );
    if (reviewVersion(row) !== expectedVersion)
      throw new HttpError(
        409,
        "Hồ sơ đã thay đổi; vui lòng xem lại trước khi xét duyệt",
        "REGISTRATION_STALE",
      );
    const requestType = applicant(user);
    if (row.requestType !== requestType)
      throw new HttpError(409, "Loại hồ sơ không khớp tài khoản");
    return row;
  }
  return {
    async own(user: SessionUser) {
      const row = await readOwn(user);
      return row ? view(row) : null;
    },
    async submit(
      user: SessionUser,
      input: OnboardingSubmitRequestDTO,
      files: Express.Multer.File[] = [],
    ): Promise<SubmissionResponseDTO> {
      applicant(user);
      const { profile, retained, expected } = input;
      validateProfileFiles(files, profile);
      const db = await connect();
      const snapshot = await authorizationTransaction(db, async (tx) => {
        const { current } = await editable(tx, user.id);
        if (
          (current?.status === "PENDING" && !expected) ||
          (expected && current?.updatedAt.getTime() !== expected.getTime())
        )
          throw new HttpError(
            409,
            "Hồ sơ đã thay đổi; tải lại trước khi chỉnh sửa",
          );
        retainDocuments(
          current ? readDocuments(current.supportingDocuments, user.id) : [],
          retained,
          files,
        );
        return current?.updatedAt.getTime() ?? null;
      });
      const uploaded: OnboardingDocument[] = [];
      let obsolete: OnboardingDocument[] = [];
      try {
        for (const file of files)
          uploaded.push(await storage.upload(user.id, file));
        const result = await authorizationTransaction(db, async (tx) => {
          const { current, requestType } = await editable(tx, user.id);
          if (requestType !== profile.requestType)
            throw new HttpError(
              409,
              "Loại tài khoản đã thay đổi; tải lại hồ sơ",
            );
          if ((current?.updatedAt.getTime() ?? null) !== snapshot)
            throw new HttpError(
              409,
              "Hồ sơ đã thay đổi; tải lại trước khi chỉnh sửa",
            );
          const previous = current
            ? readDocuments(current.supportingDocuments, user.id)
            : [];
          const kept = retainDocuments(previous, retained, files);
          obsolete = previous.filter(
            (document) => !kept.some((item) => item.id === document.id),
          );
          const submission = {
            profile,
            documents: [...kept, ...uploaded],
            submittedAt: new Date(),
          };
          const row = current
            ? await onboardingRepository.updateSubmission(
                tx,
                current.id,
                user.id,
                submission,
              )
            : await onboardingRepository.createSubmission(
                tx,
                user.id,
                submission,
              );
          return { ...view(row), accountStatus: "UNVERIFIED" as const };
        });
        // The replacement has committed; cleanup failure must not undo or hide submission success.
        for (const document of obsolete) {
          try {
            await storage.remove(document);
          } catch {
            console.error("Replaced onboarding document cleanup failed", {
              documentId: document.id,
            });
          }
        }
        return result;
      } catch (error) {
        // Only compensate assets created by this submission, never older or foreign assets.
        for (const document of uploaded) {
          try {
            await storage.remove(document);
          } catch {
            console.error("Onboarding document cleanup failed", {
              documentId: document.id,
            });
          }
        }
        throw error;
      }
    },
    async detail(
      actor: AuthPrincipal,
      { id }: RegistrationParamsRequestDTO,
    ): Promise<ReviewResponseDTO> {
      const db = await connect();
      return databaseOperation(async () => {
        assertSystemManager(
          await loadPrincipal(actor.id, db),
          "registration.view",
        );
        const row = await onboardingRepository.findReview(
          db,
          { kind: "system" },
          id,
        );
        if (!row) throw new HttpError(404, "Không tìm thấy hồ sơ");
        return reviewView(row);
      });
    },
    async approve(
      actor: AuthPrincipal,
      {
        id,
        expectedReviewVersion: expectedVersion,
      }: RegistrationApproveRequestDTO,
    ): Promise<ReviewDecisionResponseDTO> {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        const row = await reviewedApplication(
          tx,
          actor,
          id,
          "registration.approve",
          expectedVersion,
        );
        const profile = validateOnboarding(row.profileData, row.requestType);
        const documents = readDocuments(
          row.supportingDocuments,
          row.applicantUserId,
        );
        const membership: { schoolId?: string; supplierId?: string } = {};
        if (profile.requestType === "SCHOOL") {
          membership.schoolId = (
            await createOrganization(() =>
              onboardingRepository.createSchool(tx, profile.profileData),
            )
          ).id;
        } else {
          const { certifications, ...supplier } = profile.profileData;
          const created = await createOrganization(() =>
            onboardingRepository.createSupplier(tx, supplier),
          );
          membership.supplierId = created.id;
          if (certifications.length)
            await onboardingRepository.createCertifications(
              tx,
              created.id,
              certifications.map((certificate, index) => {
                const document = documents.find(
                  (item) => item.field === `certificate_${index}`,
                );
                return {
                  ...certificate,
                  documentUrl: document
                    ? `/api/registration-requests/${row.id}/documents/${document.id}`
                    : null,
                };
              }),
            );
        }
        await onboardingRepository.activateApplicant(
          tx,
          row.applicantUserId,
          membership,
        );
        const result = await onboardingRepository.updateReview(
          tx,
          { kind: "system" },
          id,
          {
            status: "APPROVED",
            reviewedByUserId: actor.id,
            reviewedAt: new Date(),
            rejectionReason: null,
          },
        );
        const notification = await onboardingRepository.queueReviewEmail(
          tx,
          id,
          reviewEmail(row),
        );
        return {
          ...reviewView(result),
          accountStatus: "ACTIVE" as const,
          ...membership,
          emailNotification: {
            id: notification.id,
            status: notification.status,
          },
        };
      });
    },
    async reject(
      actor: AuthPrincipal,
      {
        id,
        expectedReviewVersion: expectedVersion,
        rejectionReason,
      }: RegistrationRejectRequestDTO,
    ): Promise<ReviewDecisionResponseDTO> {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        const original = await reviewedApplication(
          tx,
          actor,
          id,
          "registration.reject",
          expectedVersion,
        );
        const row = await onboardingRepository.updateReview(
          tx,
          { kind: "system" },
          id,
          {
            status: "REJECTED",
            reviewedByUserId: actor.id,
            reviewedAt: new Date(),
            rejectionReason,
          },
        );
        const notification = await onboardingRepository.queueReviewEmail(
          tx,
          id,
          reviewEmail(original, rejectionReason),
        );
        return {
          ...reviewView(row),
          accountStatus: "UNVERIFIED" as const,
          emailNotification: {
            id: notification.id,
            status: notification.status,
          },
        };
      });
    },
    async ownDocument(
      user: SessionUser,
      { documentId }: OwnDocumentParamsRequestDTO,
    ) {
      const row = await readOwn(user);
      if (!row) throw new HttpError(404, "Không tìm thấy tài liệu");
      const document = readDocuments(row.supportingDocuments, user.id).find(
        (item) => item.id === documentId,
      );
      if (!document) throw new HttpError(404, "Không tìm thấy tài liệu");
      return { url: storage.download(document), expiresIn: 60 };
    },
    async reviewDocument(
      actor: AuthPrincipal,
      { id, documentId }: ReviewDocumentRequestDTO,
    ) {
      const db = await connect();
      const row = await databaseOperation(async () => {
        const current = await loadPrincipal(actor.id, db);
        if (current.orgType === "SYSTEM") {
          assertSystemManager(current, "registration.view");
        } else if (current.orgType === "SUPPLIER" && current.supplierId) {
          assertPermission(current, "supplier_certification.view");
          const application =
            await onboardingRepository.findApprovedSupplierApplication(db, id);
          if (!application) throw new HttpError(404, "Không tìm thấy tài liệu");
          const documents = readDocuments(
            application.supportingDocuments,
            application.applicantUserId,
          );
          const requested = documents.find(
            (document) => document.id === documentId,
          );
          if (!requested) throw new HttpError(404, "Không tìm thấy tài liệu");
          // documentUrl remains the first-file anchor for a certificate. Authorize
          // every file in that group through the certificate's current supplier owner.
          const anchors = documents
            .filter((document) => document.field === requested.field)
            .map(
              (document) =>
                `/api/registration-requests/${id}/documents/${document.id}`,
            );
          const certificate =
            await onboardingRepository.findSupplierCertificate(
              db,
              current.supplierId,
              anchors,
            );
          if (!certificate) throw new HttpError(404, "Không tìm thấy tài liệu");
          return application;
        } else throw new HttpError(403, "Không có quyền đọc tài liệu này");
        return onboardingRepository.findForDocument(db, { kind: "system" }, id);
      });
      const document =
        row &&
        readDocuments(row.supportingDocuments, row.applicantUserId).find(
          (item) => item.id === documentId,
        );
      if (!document) throw new HttpError(404, "Không tìm thấy tài liệu");
      return { url: storage.download(document), expiresIn: 60 };
    },
  };
}
export const onboardingService = createOnboardingService();
export type OnboardingService = ReturnType<typeof createOnboardingService>;
