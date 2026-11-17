import type { AuthPrincipal } from "../../types/auth";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { withReadTransaction } from "../../utils/read-transaction";
import {
  supplierSchoolReadScope,
  type SupplierSchoolReadScope,
} from "../../utils/resource-access";
import type {
  SupplierSchoolContractListQueryRequest,
  SupplierSchoolContractParamsRequest,
  SupplierSchoolDocumentParamsRequest,
  SupplierSchoolDocumentQueryRequest,
  SupplierSchoolListQueryRequest,
  SupplierSchoolParamsRequest,
} from "./supplier-school.request.dto";
import type {
  AllowedContractDocumentMimeType,
  SupplierSchoolContract,
  SupplierSchoolContractDocumentMetadata,
  SupplierSchoolContractListResponse,
  SupplierSchoolDetail,
  SupplierSchoolDocumentBinary,
  SupplierSchoolListItem,
  SupplierSchoolListResponse,
} from "./supplier-school.response.dto";
import {
  supplierSchoolRepository,
  type LinkedSchoolDetailRow,
  type LinkedSchoolListRow,
  type SchoolContractRow,
  type SupplierSchoolRepository,
  type SupplierSchoolTx,
} from "./supplier-school.repository";

const NOT_FOUND_MESSAGE = "Không tìm thấy dữ liệu trong phạm vi được phép";
const UNREADABLE_DOCUMENT_MESSAGE =
  "Không thể đọc nội dung tệp hợp đồng. Vui lòng thử lại sau.";

const ALLOWED_DOCUMENT_MIMES: readonly AllowedContractDocumentMimeType[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

function isAllowedMimeType(
  value: string,
): value is AllowedContractDocumentMimeType {
  return (ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(value);
}

function toIsoTimestamp(value: Date): string {
  return value.toISOString();
}

function toNullableIsoTimestamp(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toNullableDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function mapSchoolListItem(row: LinkedSchoolListRow): SupplierSchoolListItem {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    address: row.address ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status,
    relationship: {
      status: row.relationshipStatus,
      linkedAt: toIsoTimestamp(row.linkedAt),
    },
  };
}

function mapSchoolDetail(row: LinkedSchoolDetailRow): SupplierSchoolDetail {
  const base = mapSchoolListItem(row);
  return {
    ...base,
    description: row.description ?? null,
    websiteUrl: row.websiteUrl ?? null,
    logoUrl: row.logoUrl ?? null,
    coverImageUrl: row.coverImageUrl ?? null,
    boardingScale: row.boardingScale ?? null,
    relationship: {
      ...base.relationship,
      suspendedAt: toNullableIsoTimestamp(row.suspendedAt),
      unlinkedAt: toNullableIsoTimestamp(row.unlinkedAt),
      suspensionReason: row.suspensionReason ?? null,
      unlinkReason: row.unlinkReason ?? null,
    },
  };
}

function mapDocumentMetadata(
  doc: SchoolContractRow["documents"][number],
): SupplierSchoolContractDocumentMetadata {
  if (doc.kind !== "SIGNED_CONTRACT" && doc.kind !== "APPENDIX") {
    throw new HttpError(503, "Không thể tải dữ liệu. Vui lòng thử lại sau.");
  }
  return {
    id: doc.id,
    kind: doc.kind,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    createdAt: toIsoTimestamp(doc.createdAt),
  };
}

function mapContract(row: SchoolContractRow): SupplierSchoolContract {
  if (row.status !== "ACTIVE" && row.status !== "CLOSED") {
    throw new HttpError(503, "Không thể tải dữ liệu. Vui lòng thử lại sau.");
  }
  return {
    id: row.id,
    number: row.number ?? null,
    status: row.status,
    signedOn: toNullableDateOnly(row.signedOn),
    startsOn: toNullableDateOnly(row.startsOn),
    endsOn: toNullableDateOnly(row.endsOn),
    scopeNote: row.scopeNote ?? null,
    ingredients: row.items.map((item) => ({
      id: item.ingredient.id,
      name: item.ingredient.name,
    })),
    activatedAt: toNullableIsoTimestamp(row.activatedAt),
    closedAt: toNullableIsoTimestamp(row.closedAt),
    closeReason: row.closeReason ?? null,
    documents: row.documents.map(mapDocumentMetadata),
  };
}

export function createSupplierSchoolService(
  repo: SupplierSchoolRepository = supplierSchoolRepository,
  connect = getPrisma,
) {
  async function assertLinkedSchoolParent(
    tx: SupplierSchoolTx,
    scope: SupplierSchoolReadScope,
    schoolId: string,
  ): Promise<void> {
    const exists = await repo.hasSchoolRelationship(tx, scope, schoolId);
    if (!exists) throw new HttpError(404, NOT_FOUND_MESSAGE);
  }

  return {
    async listSchools(
      query: SupplierSchoolListQueryRequest,
      principal: AuthPrincipal,
    ): Promise<SupplierSchoolListResponse> {
      const scope = supplierSchoolReadScope(principal);
      return withReadTransaction(async (tx) => {
        const offset = (query.page - 1) * query.limit;
        const rows = await repo.listLinkedSchools(
          tx,
          scope,
          offset,
          query.limit + 1,
        );
        return {
          items: rows.slice(0, query.limit).map(mapSchoolListItem),
          pagination: {
            page: query.page,
            limit: query.limit,
            hasNext: rows.length > query.limit,
          },
        };
      }, connect);
    },
    async getSchoolDetail(
      params: SupplierSchoolParamsRequest,
      principal: AuthPrincipal,
    ): Promise<SupplierSchoolDetail> {
      const scope = supplierSchoolReadScope(principal);
      return withReadTransaction(async (tx) => {
        const row = await repo.findLinkedSchoolDetail(
          tx,
          scope,
          params.schoolId,
        );
        if (!row) throw new HttpError(404, NOT_FOUND_MESSAGE);
        return mapSchoolDetail(row);
      }, connect);
    },
    async listContracts(
      params: SupplierSchoolParamsRequest,
      query: SupplierSchoolContractListQueryRequest,
      principal: AuthPrincipal,
    ): Promise<SupplierSchoolContractListResponse> {
      const scope = supplierSchoolReadScope(principal);
      return withReadTransaction(async (tx) => {
        await assertLinkedSchoolParent(tx, scope, params.schoolId);
        const offset = (query.page - 1) * query.limit;
        const rows = await repo.listSchoolContracts(
          tx,
          scope,
          params.schoolId,
          offset,
          query.limit + 1,
        );
        return {
          items: rows.slice(0, query.limit).map(mapContract),
          pagination: {
            page: query.page,
            limit: query.limit,
            hasNext: rows.length > query.limit,
          },
        };
      }, connect);
    },
    async getContractDetail(
      params: SupplierSchoolContractParamsRequest,
      principal: AuthPrincipal,
    ): Promise<SupplierSchoolContract> {
      const scope = supplierSchoolReadScope(principal);
      return withReadTransaction(async (tx) => {
        await assertLinkedSchoolParent(tx, scope, params.schoolId);
        const row = await repo.findSchoolContractDetail(
          tx,
          scope,
          params.schoolId,
          params.contractId,
        );
        if (!row) throw new HttpError(404, NOT_FOUND_MESSAGE);
        return mapContract(row);
      }, connect);
    },
    async getDocumentContent(
      params: SupplierSchoolDocumentParamsRequest,
      query: SupplierSchoolDocumentQueryRequest,
      principal: AuthPrincipal,
    ): Promise<SupplierSchoolDocumentBinary> {
      void query;
      const scope = supplierSchoolReadScope(principal);
      return withReadTransaction(async (tx) => {
        await assertLinkedSchoolParent(tx, scope, params.schoolId);
        const doc = await repo.findContractDocumentContent(
          tx,
          scope,
          params.schoolId,
          params.contractId,
          params.documentId,
        );
        if (!doc) throw new HttpError(404, NOT_FOUND_MESSAGE);
        if (
          !(doc.content instanceof Uint8Array) ||
          doc.content.byteLength === 0 ||
          !isAllowedMimeType(doc.mimeType)
        ) {
          throw new HttpError(503, UNREADABLE_DOCUMENT_MESSAGE);
        }
        return {
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          content: new Uint8Array(doc.content),
        };
      }, connect);
    },
  };
}

export const supplierSchoolService = createSupplierSchoolService();
export type SupplierSchoolService = ReturnType<
  typeof createSupplierSchoolService
>;
