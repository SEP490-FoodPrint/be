import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import type { SupplierSchoolReadScope } from "../../utils/resource-access";

export type SupplierSchoolTx = Prisma.TransactionClient;

export interface LinkedSchoolListRow {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  status: "ACTIVE" | "INACTIVE";
  relationshipStatus: "ACTIVE" | "SUSPENDED" | "UNLINKED";
  linkedAt: Date;
}

export interface LinkedSchoolDetailRow extends LinkedSchoolListRow {
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  boardingScale: string | null;
  suspendedAt: Date | null;
  unlinkedAt: Date | null;
  suspensionReason: string | null;
  unlinkReason: string | null;
}

const VISIBLE_CONTRACT_STATUSES = ["ACTIVE", "CLOSED"] as const;
const VISIBLE_DOCUMENT_KINDS = ["SIGNED_CONTRACT", "APPENDIX"] as const;

const contractSelect = {
  id: true,
  number: true,
  status: true,
  signedOn: true,
  startsOn: true,
  endsOn: true,
  scopeNote: true,
  activatedAt: true,
  closedAt: true,
  closeReason: true,
  items: {
    orderBy: { ingredientId: "asc" as const },
    select: {
      ingredient: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  documents: {
    where: { kind: { in: [...VISIBLE_DOCUMENT_KINDS] } },
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      kind: true,
      fileName: true,
      mimeType: true,
      size: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.SupplierContractSelect;

export type SchoolContractRow = Prisma.SupplierContractGetPayload<{
  select: typeof contractSelect;
}>;

const documentContentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  content: true,
} as const satisfies Prisma.SupplierContractDocumentSelect;

export type ContractDocumentContentRow =
  Prisma.SupplierContractDocumentGetPayload<{
    select: typeof documentContentSelect;
  }>;

function pairContractWhere(scope: SupplierSchoolReadScope, schoolId: string) {
  return {
    schoolId,
    supplierId: scope.supplierId,
    status: { in: [...VISIBLE_CONTRACT_STATUSES] },
    school: {
      schoolSupplierRelationships: {
        some: { supplierId: scope.supplierId },
      },
    },
  };
}

export function createSupplierSchoolRepository(_connect = getPrisma) {
  return {
    async listLinkedSchools(
      tx: SupplierSchoolTx,
      scope: SupplierSchoolReadScope,
      offset: number,
      limit: number,
    ): Promise<LinkedSchoolListRow[]> {
      return tx.$queryRaw<LinkedSchoolListRow[]>`
        WITH representative AS (
          SELECT DISTINCT ON (r.school_id)
            r.school_id AS "schoolId",
            r.status::text AS "relationshipStatus",
            r.linked_at AS "linkedAt"
          FROM foodprint.school_supplier_relationships r
          WHERE r.supplier_id = ${scope.supplierId}::uuid
          ORDER BY
            r.school_id ASC,
            CASE WHEN r.status IN ('ACTIVE', 'SUSPENDED') THEN 0 ELSE 1 END ASC,
            r.linked_at DESC,
            r.id ASC
        )
        SELECT
          s.id AS "id",
          s.name AS "name",
          s.code AS "code",
          s.address_line AS "address",
          s.email AS "email",
          s.phone AS "phone",
          s.status::text AS "status",
          rep."relationshipStatus" AS "relationshipStatus",
          rep."linkedAt" AS "linkedAt"
        FROM representative rep
        INNER JOIN foodprint.schools s ON s.id = rep."schoolId"
        ORDER BY rep."linkedAt" DESC, s.id ASC
        OFFSET ${offset}::bigint
        LIMIT ${limit}::int
      `;
    },
    async findLinkedSchoolDetail(
      tx: SupplierSchoolTx,
      scope: SupplierSchoolReadScope,
      schoolId: string,
    ): Promise<LinkedSchoolDetailRow | null> {
      const rows = await tx.$queryRaw<LinkedSchoolDetailRow[]>`
        WITH representative AS (
          SELECT DISTINCT ON (r.school_id)
            r.school_id AS "schoolId",
            r.status::text AS "relationshipStatus",
            r.linked_at AS "linkedAt",
            r.suspended_at AS "suspendedAt",
            r.unlinked_at AS "unlinkedAt",
            r.suspension_reason AS "suspensionReason",
            r.unlink_reason AS "unlinkReason"
          FROM foodprint.school_supplier_relationships r
          WHERE r.supplier_id = ${scope.supplierId}::uuid
            AND r.school_id = ${schoolId}::uuid
          ORDER BY
            r.school_id ASC,
            CASE WHEN r.status IN ('ACTIVE', 'SUSPENDED') THEN 0 ELSE 1 END ASC,
            r.linked_at DESC,
            r.id ASC
        )
        SELECT
          s.id AS "id",
          s.name AS "name",
          s.code AS "code",
          s.address_line AS "address",
          s.email AS "email",
          s.phone AS "phone",
          s.status::text AS "status",
          s.description AS "description",
          s.website_url AS "websiteUrl",
          s.logo_url AS "logoUrl",
          s.cover_image_url AS "coverImageUrl",
          s.boarding_scale AS "boardingScale",
          rep."relationshipStatus" AS "relationshipStatus",
          rep."linkedAt" AS "linkedAt",
          rep."suspendedAt" AS "suspendedAt",
          rep."unlinkedAt" AS "unlinkedAt",
          rep."suspensionReason" AS "suspensionReason",
          rep."unlinkReason" AS "unlinkReason"
        FROM representative rep
        INNER JOIN foodprint.schools s ON s.id = rep."schoolId"
      `;
      return rows[0] ?? null;
    },
    async hasSchoolRelationship(
      tx: SupplierSchoolTx,
      scope: SupplierSchoolReadScope,
      schoolId: string,
    ): Promise<boolean> {
      const row = await tx.schoolSupplierRelationship.findFirst({
        where: {
          schoolId,
          supplierId: scope.supplierId,
        },
        select: { id: true },
      });
      return row !== null;
    },
    async listSchoolContracts(
      tx: SupplierSchoolTx,
      scope: SupplierSchoolReadScope,
      schoolId: string,
      offset: number,
      limit: number,
    ): Promise<SchoolContractRow[]> {
      return tx.supplierContract.findMany({
        where: pairContractWhere(scope, schoolId),
        select: contractSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      });
    },
    async findSchoolContractDetail(
      tx: SupplierSchoolTx,
      scope: SupplierSchoolReadScope,
      schoolId: string,
      contractId: string,
    ): Promise<SchoolContractRow | null> {
      return tx.supplierContract.findFirst({
        where: {
          id: contractId,
          ...pairContractWhere(scope, schoolId),
        },
        select: contractSelect,
      });
    },
    async findContractDocumentContent(
      tx: SupplierSchoolTx,
      scope: SupplierSchoolReadScope,
      schoolId: string,
      contractId: string,
      documentId: string,
    ): Promise<ContractDocumentContentRow | null> {
      return tx.supplierContractDocument.findFirst({
        where: {
          id: documentId,
          kind: { in: [...VISIBLE_DOCUMENT_KINDS] },
          contract: {
            id: contractId,
            ...pairContractWhere(scope, schoolId),
          },
        },
        select: documentContentSelect,
      });
    },
  };
}

export type SupplierSchoolRepository = ReturnType<
  typeof createSupplierSchoolRepository
>;
export const supplierSchoolRepository = createSupplierSchoolRepository();
