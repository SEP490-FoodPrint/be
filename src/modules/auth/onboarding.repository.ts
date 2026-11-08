import type { Prisma } from "../../generated/prisma/client";
import type { AuthorizationClient } from "../../utils/authorization";
import { loadSessionUser } from "../../utils/session-identity";
import type { OnboardingDocument } from "../../utils/onboarding-documents";
import type {
  OnboardingProfile,
  OrganizationProfile,
  CertificationInput,
} from "./onboarding.validation";
import { registrationApplicantSelect } from "../registration/registration.select";

export const applicationSelect = {
  id: true,
  registrationNumber: true,
  applicantUserId: true,
  requestType: true,
  status: true,
  profileData: true,
  supportingDocuments: true,
  submittedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  updatedAt: true,
} as const satisfies Prisma.RegistrationRequestSelect;
export const reviewSelect = {
  ...applicationSelect,
  reviewedByUserId: true,
  applicantUser: { select: registrationApplicantSelect },
  reviewedByUser: { select: { id: true, fullName: true } },
} as const satisfies Prisma.RegistrationRequestSelect;
export type Application = Prisma.RegistrationRequestGetPayload<{
  select: typeof applicationSelect;
}>;
export type ReviewRow = Prisma.RegistrationRequestGetPayload<{
  select: typeof reviewSelect;
}>;
export type RegistrationScope =
  { kind: "system" } | { kind: "applicant"; applicantUserId: string };
function scopedId(scope: RegistrationScope, id: string) {
  return scope.kind === "system"
    ? { id }
    : { id, applicantUserId: scope.applicantUserId };
}
interface SubmissionWrite {
  profile: OnboardingProfile;
  documents: OnboardingDocument[];
  submittedAt: Date;
}
function submissionData(input: SubmissionWrite) {
  return {
    requestType: input.profile.requestType,
    status: "PENDING" as const,
    profileData: JSON.parse(
      JSON.stringify(input.profile.profileData),
    ) as Prisma.InputJsonObject,
    supportingDocuments: input.documents.map((document) => ({
      id: document.id,
      field: document.field,
      publicId: document.publicId,
      format: document.format,
      fileName: document.fileName,
      bytes: document.bytes,
    })),
    submittedAt: input.submittedAt,
    reviewedAt: null,
    reviewedByUserId: null,
    rejectionReason: null,
  };
}
interface ReviewDecision {
  status: "APPROVED" | "REJECTED";
  reviewedByUserId: string;
  reviewedAt: Date;
  rejectionReason: string | null;
}
export const onboardingRepository = {
  async lockApplicant(tx: AuthorizationClient, id: string) {
    await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
    return loadSessionUser(id, tx);
  },
  findOwn(client: AuthorizationClient, applicantUserId: string) {
    return client.registrationRequest.findUnique({
      where: { applicantUserId },
      select: applicationSelect,
    });
  },
  findHeader(
    client: AuthorizationClient,
    scope: RegistrationScope,
    id: string,
  ) {
    return client.registrationRequest.findUnique({
      where: scopedId(scope, id),
      select: { applicantUserId: true },
    });
  },
  findReview(
    client: AuthorizationClient,
    scope: RegistrationScope,
    id: string,
  ) {
    return client.registrationRequest.findUnique({
      where: scopedId(scope, id),
      select: reviewSelect,
    });
  },
  createSubmission(
    tx: AuthorizationClient,
    applicantUserId: string,
    input: SubmissionWrite,
  ) {
    return tx.registrationRequest.create({
      data: { applicantUserId, ...submissionData(input) },
      select: applicationSelect,
    });
  },
  updateSubmission(
    tx: AuthorizationClient,
    id: string,
    applicantUserId: string,
    input: SubmissionWrite,
  ) {
    return tx.registrationRequest.update({
      where: { id, applicantUserId },
      data: submissionData(input),
      select: applicationSelect,
    });
  },
  createSchool(
    tx: AuthorizationClient,
    profile: OrganizationProfile & { code: string | null },
  ) {
    return tx.school.create({
      data: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        code: profile.code,
      },
      select: { id: true },
    });
  },
  createSupplier(
    tx: AuthorizationClient,
    profile: OrganizationProfile & { taxCode: string | null },
  ) {
    return tx.supplier.create({
      data: {
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        taxCode: profile.taxCode,
      },
      select: { id: true },
    });
  },
  createCertifications(
    tx: AuthorizationClient,
    supplierId: string,
    certificates: (CertificationInput & { documentUrl: string | null })[],
  ) {
    return tx.supplierCertification.createMany({
      data: certificates.map((certificate) => ({
        supplierId,
        certificationType: certificate.certificationType,
        certificateNo: certificate.certificateNo,
        issuedDate: certificate.issuedDate
          ? new Date(certificate.issuedDate + "T00:00:00.000Z")
          : null,
        expiryDate: certificate.expiryDate
          ? new Date(certificate.expiryDate + "T00:00:00.000Z")
          : null,
        documentUrl: certificate.documentUrl,
      })),
    });
  },
  activateApplicant(
    tx: AuthorizationClient,
    id: string,
    membership: { schoolId?: string; supplierId?: string },
  ) {
    return tx.user.update({
      where: { id },
      data: { ...membership, status: "ACTIVE" },
      select: { id: true },
    });
  },
  updateReview(
    tx: AuthorizationClient,
    scope: RegistrationScope,
    id: string,
    decision: ReviewDecision,
  ) {
    return tx.registrationRequest.update({
      where: scopedId(scope, id),
      data: {
        status: decision.status,
        reviewedByUserId: decision.reviewedByUserId,
        reviewedAt: decision.reviewedAt,
        rejectionReason: decision.rejectionReason,
      },
      select: reviewSelect,
    });
  },
  queueRegistrationEmail(
    tx: AuthorizationClient,
    registrationId: string,
    email: {
      recipientEmail: string;
      subject: string;
      text: string;
      html: string;
    },
  ) {
    return tx.emailOutbox.create({
      data: {
        registrationId,
        recipientEmail: email.recipientEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
      },
      select: { id: true, status: true },
    });
  },
  findApprovedSupplierApplication(client: AuthorizationClient, id: string) {
    return client.registrationRequest.findFirst({
      where: { id, status: "APPROVED", requestType: "SUPPLIER" },
      select: applicationSelect,
    });
  },
  findSupplierCertificate(
    client: AuthorizationClient,
    supplierId: string,
    anchors: string[],
  ) {
    return client.supplierCertification.findFirst({
      where: { supplierId, documentUrl: { in: anchors } },
      select: { id: true },
    });
  },
  findForDocument(
    client: AuthorizationClient,
    scope: RegistrationScope,
    id: string,
  ) {
    return client.registrationRequest.findFirst({
      where: scopedId(scope, id),
      select: applicationSelect,
    });
  },
};
