import type { Prisma, PrismaClient } from "../../generated/prisma/client";
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
import { readSubmission, retainDocuments } from "./onboarding-submission";
import { registrationApplicantSelect } from "../registration/registration.select";

const select = {
  id: true,
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
const detailSelect = {
  ...select,
  reviewedByUserId: true,
  applicantUser: { select: registrationApplicantSelect },
  reviewedByUser: { select: { id: true, fullName: true } },
} as const satisfies Prisma.RegistrationRequestSelect;
type Application = Prisma.RegistrationRequestGetPayload<{
  select: typeof select;
}>;

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
function view(row: Application) {
  const { supportingDocuments, ...fields } = row;
  return {
    ...fields,
    profileData: validateOnboarding(row.profileData, row.requestType)
      .profileData,
    documents: readDocuments(supportingDocuments, row.applicantUserId).map(
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
      );
    throw error;
  }
}
async function lockApplicant(tx: AuthorizationClient, id: string) {
  await tx.$queryRaw`SELECT id FROM foodprint.users WHERE id = ${id}::uuid FOR UPDATE`;
  return loadSessionUser(id, tx);
}
async function editable(tx: AuthorizationClient, userId: string) {
  const user = await lockApplicant(tx, userId);
  const requestType = applicant(user);
  const current = await tx.registrationRequest.findUnique({
    where: { applicantUserId: userId },
    select,
  });
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
      return db.registrationRequest.findUnique({
        where: { applicantUserId: user.id },
        select,
      });
    });
  }
  async function reviewedApplication(
    tx: AuthorizationClient,
    actor: AuthPrincipal,
    id: string,
    permission: string,
  ) {
    assertSystemManager(await loadPrincipal(actor.id, tx), permission);
    // Lock order matches submission: applicant first, then registration row updates.
    const header = await tx.registrationRequest.findUnique({
      where: { id },
      select: { applicantUserId: true },
    });
    if (!header) throw new HttpError(404, "Không tìm thấy hồ sơ");
    const user = await lockApplicant(tx, header.applicantUserId);
    const row = await tx.registrationRequest.findUniqueOrThrow({
      where: { id },
      select,
    });
    if (row.status !== "PENDING")
      throw new HttpError(409, "Hồ sơ không còn chờ duyệt");
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
      value: unknown,
      files: Express.Multer.File[] = [],
    ) {
      const { profile, retained, expected } = readSubmission(
        value,
        applicant(user),
      );
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
          const data = {
            requestType,
            status: "PENDING" as const,
            profileData: JSON.parse(
              JSON.stringify(profile.profileData),
            ) as Prisma.InputJsonObject,
            supportingDocuments: [...kept, ...uploaded].map((document) => ({
              ...document,
            })),
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedByUserId: null,
            rejectionReason: null,
          };
          const row = current
            ? await tx.registrationRequest.update({
                where: { id: current.id },
                data,
                select,
              })
            : await tx.registrationRequest.create({
                data: { applicantUserId: user.id, ...data },
                select,
              });
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
    async detail(actor: AuthPrincipal, id: string) {
      const db = await connect();
      return databaseOperation(async () => {
        assertSystemManager(
          await loadPrincipal(actor.id, db),
          "registration.view",
        );
        const row = await db.registrationRequest.findUnique({
          where: { id },
          select: detailSelect,
        });
        if (!row) throw new HttpError(404, "Không tìm thấy hồ sơ");
        const {
          applicantUser,
          reviewedByUserId,
          reviewedByUser,
          ...application
        } = row;
        return {
          ...view(application),
          applicantUser,
          reviewedByUserId,
          reviewedByUser,
        };
      });
    },
    async approve(actor: AuthPrincipal, id: string) {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        const row = await reviewedApplication(
          tx,
          actor,
          id,
          "registration.approve",
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
              tx.school.create({
                data: profile.profileData,
                select: { id: true },
              }),
            )
          ).id;
        } else {
          const { certifications, ...supplier } = profile.profileData;
          const created = await createOrganization(() =>
            tx.supplier.create({ data: supplier, select: { id: true } }),
          );
          membership.supplierId = created.id;
          if (certifications.length)
            await tx.supplierCertification.createMany({
              data: certifications.map((certificate, index) => {
                const document = documents.find(
                  (item) => item.field === `certificate_${index}`,
                );
                return {
                  supplierId: created.id,
                  ...certificate,
                  issuedDate: certificate.issuedDate
                    ? new Date(certificate.issuedDate + "T00:00:00.000Z")
                    : null,
                  expiryDate: certificate.expiryDate
                    ? new Date(certificate.expiryDate + "T00:00:00.000Z")
                    : null,
                  // Store a stable internal path, never an expiring signature or public Cloudinary URL.
                  documentUrl: document
                    ? `/api/registration-requests/${row.id}/documents/${document.id}`
                    : null,
                };
              }),
            });
        }
        await tx.user.update({
          where: { id: row.applicantUserId },
          data: { ...membership, status: "ACTIVE" },
        });
        const result = await tx.registrationRequest.update({
          where: { id },
          data: {
            status: "APPROVED",
            reviewedByUserId: actor.id,
            reviewedAt: new Date(),
            rejectionReason: null,
          },
          select,
        });
        return {
          ...view(result),
          accountStatus: "ACTIVE" as const,
          ...membership,
        };
      });
    },
    async reject(actor: AuthPrincipal, id: string, rejectionReason: string) {
      const db = await connect();
      return authorizationTransaction(db, async (tx) => {
        await reviewedApplication(tx, actor, id, "registration.reject");
        const row = await tx.registrationRequest.update({
          where: { id },
          data: {
            status: "REJECTED",
            reviewedByUserId: actor.id,
            reviewedAt: new Date(),
            rejectionReason,
          },
          select,
        });
        return { ...view(row), accountStatus: "UNVERIFIED" as const };
      });
    },
    async ownDocument(user: SessionUser, documentId: string) {
      const row = await readOwn(user);
      if (!row) throw new HttpError(404, "Không tìm thấy tài liệu");
      const document = readDocuments(row.supportingDocuments, user.id).find(
        (item) => item.id === documentId,
      );
      if (!document) throw new HttpError(404, "Không tìm thấy tài liệu");
      return { url: storage.download(document), expiresIn: 60 };
    },
    async reviewDocument(actor: AuthPrincipal, id: string, documentId: string) {
      const db = await connect();
      const row = await databaseOperation(async () => {
        const current = await loadPrincipal(actor.id, db);
        let where: Prisma.RegistrationRequestWhereInput;
        if (current.orgType === "SYSTEM") {
          assertSystemManager(current, "registration.view");
          where = { id };
        } else if (current.orgType === "SUPPLIER" && current.supplierId) {
          assertPermission(current, "supplier_certification.view");
          const certificate = await db.supplierCertification.findFirst({
            where: {
              supplierId: current.supplierId,
              documentUrl: `/api/registration-requests/${id}/documents/${documentId}`,
            },
            select: { id: true },
          });
          if (!certificate) throw new HttpError(404, "Không tìm thấy tài liệu");
          where = {
            id,
            status: "APPROVED",
            requestType: "SUPPLIER",
          };
        } else throw new HttpError(403, "Không có quyền đọc tài liệu này");
        return db.registrationRequest.findFirst({ where, select });
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
