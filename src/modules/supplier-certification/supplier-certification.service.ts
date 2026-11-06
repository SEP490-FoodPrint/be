import type { AuthPrincipal } from "../../types/auth";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { listScopes } from "../../utils/resource-access";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import {
  readDocuments,
  documentStorage,
  type DocumentStorage,
  type OnboardingDocument,
} from "../../utils/onboarding-documents";
import type {
  CertificationListRequestDTO,
  SupplierCertificationParamsDTO,
  CertificationDocumentRequestDTO,
} from "./supplier-certification.request.dto";
import type {
  CertificationDTO,
  SupplierCertificationListDTO,
  CertificationDocumentResponseDTO,
} from "./supplier-certification.response.dto";
import {
  createSupplierCertificationRepository,
  type CertificationReader,
  type CertificationRow,
  type CertificateApplication,
  type SupplierCertificationRepository,
} from "./supplier-certification.repository";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const anchorPattern = new RegExp(
  `^/api/registration-requests/(${UUID})/documents/(${UUID})$`,
  "i",
);
function anchor(url: string | null) {
  const found = url?.match(anchorPattern);
  return found ? { applicationId: found[1], documentId: found[2] } : null;
}
function map(row: CertificationRow): CertificationDTO {
  return {
    id: row.id,
    supplierId: row.supplierId,
    certificationType: row.certificationType,
    certificateNo: row.certificateNo,
    issuedDate: row.issuedDate?.toISOString() ?? null,
    expiryDate: row.expiryDate?.toISOString() ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
/** Resolve only metadata whose anchor proves the certificate group. Never follow URLs. */
export function resolveCertificationDocuments(
  url: string | null,
  application: CertificateApplication | undefined,
): OnboardingDocument[] {
  const target = anchor(url);
  if (
    !target ||
    !application ||
    application.id.toLowerCase() !== target.applicationId.toLowerCase()
  )
    return [];
  try {
    const documents = readDocuments(
      application.supportingDocuments,
      application.applicantUserId,
    );
    if (
      new Set(documents.map((d) => d.id.toLowerCase())).size !==
        documents.length ||
      documents.some((d) => !Number.isSafeInteger(d.bytes) || d.bytes <= 0)
    )
      return [];
    const first = documents.find(
      (d) => d.id.toLowerCase() === target.documentId.toLowerCase(),
    );
    const field = first?.field.match(/^certificate_(0|[1-9]\d*)$/);
    const profile = application.profileData;
    if (
      !first ||
      !field ||
      !profile ||
      typeof profile !== "object" ||
      Array.isArray(profile) ||
      !Array.isArray(profile.certifications) ||
      Number(field[1]) >= profile.certifications.length ||
      !profile.certifications[Number(field[1])]
    )
      return [];
    return documents.filter((d) => d.field === first.field);
  } catch {
    return [];
  }
}
export function createSupplierCertificationService(
  read?: CertificationReader,
  repository: SupplierCertificationRepository = createSupplierCertificationRepository(
    read,
  ),
  connect: () => Promise<PrismaClient> = getPrisma,
  storage: DocumentStorage = documentStorage,
  run: <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => Promise<T> = (operation) => withReadTransaction(operation, connect),
) {
  return {
    async getAll(query: CertificationListRequestDTO, principal: AuthPrincipal) {
      const scope = listScopes["supplier-certification"](principal);
      let rows: CertificationRow[];
      try {
        rows = await repository.legacy(scope, query.page, query.limit);
      } catch {
        throw new HttpError(503, "Không thể tải danh sách chứng nhận");
      }
      return {
        items: rows.slice(0, query.limit).map(map),
        pagination: {
          page: query.page,
          limit: query.limit,
          hasNext: rows.length > query.limit,
        },
      };
    },
    async getBySupplier(
      params: SupplierCertificationParamsDTO,
      query: CertificationListRequestDTO,
      principal: AuthPrincipal,
    ): Promise<SupplierCertificationListDTO> {
      const scope = listScopes["supplier-certification"](principal);
      return run(async (tx) => {
        if (!(await repository.parent(tx, scope, params.supplierId)))
          throw new HttpError(404, "Không tìm thấy nhà cung cấp");
        const page = await repository.page(
          tx,
          scope,
          params.supplierId,
          query.page,
          query.limit,
        );
        const ids = [
          ...new Set(
            page.items.flatMap((row) => {
              const a = anchor(row.documentUrl);
              return a ? [a.applicationId] : [];
            }),
          ),
        ];
        const applications = ids.length
          ? await repository.applications(tx, ids)
          : [];
        return {
          items: page.items.map((row) => ({
            ...map(row),
            documents: resolveCertificationDocuments(
              row.documentUrl,
              applications.find(
                (a) =>
                  a.id.toLowerCase() ===
                  anchor(row.documentUrl)?.applicationId.toLowerCase(),
              ),
            ).map((d) => ({
              id: d.id,
              field: d.field,
              format: d.format,
              fileName: d.fileName,
              bytes: d.bytes,
            })),
          })),
          pagination: {
            page: query.page,
            limit: query.limit,
            total: page.total,
            hasNext:
              (query.page - 1) * query.limit + page.items.length < page.total,
          },
        };
      });
    },
    async document(
      params: CertificationDocumentRequestDTO,
      principal: AuthPrincipal,
    ): Promise<CertificationDocumentResponseDTO> {
      const scope = listScopes["supplier-certification"](principal);
      const document = await run(async (tx) => {
        const certificate = await repository.find(tx, scope, params.id);
        if (!certificate) throw new HttpError(404, "Không tìm thấy tài liệu");
        const a = anchor(certificate.documentUrl);
        const applications = a
          ? await repository.applications(tx, [a.applicationId])
          : [];
        const found = resolveCertificationDocuments(
          certificate.documentUrl,
          applications[0],
        ).find((d) => d.id.toLowerCase() === params.documentId.toLowerCase());
        if (!found) throw new HttpError(404, "Không tìm thấy tài liệu");
        return found;
      });
      try {
        return { url: storage.download(document), expiresIn: 60 };
      } catch {
        throw new HttpError(
          503,
          "Không thể mở tài liệu. Vui lòng thử lại sau.",
        );
      }
    },
  };
}
export const supplierCertificationService =
  createSupplierCertificationService();
export type SupplierCertificationService = ReturnType<
  typeof createSupplierCertificationService
>;
