import type { Prisma } from "../../generated/prisma/client";
import type { SourceFacilityManagementScope } from "../../utils/resource-access";
import { getPrisma } from "../../utils/database";
import { loadPrincipal } from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import { listWindow, type ListQuery } from "../../utils/list-query";

type Tx = Prisma.TransactionClient;

export const sourceFacilityListSelect = {
  id: true,
  supplierId: true,
  facilityCode: true,
  name: true,
  status: true,
  isVisible: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SourceFacilitySelect;

export const sourceFacilityDetailSelect = {
  ...sourceFacilityListSelect,
  address: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
} as const satisfies Prisma.SourceFacilitySelect;

export type SourceFacilityListRow = Prisma.SourceFacilityGetPayload<{
  select: typeof sourceFacilityListSelect;
}>;

export type SourceFacilityRow = Prisma.SourceFacilityGetPayload<{
  select: typeof sourceFacilityDetailSelect;
}>;

export interface SourceFacilityEditable {
  name?: string;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export type SourceFacilityCreateInput = SourceFacilityEditable & {
  name: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNameConstraint(value: unknown): boolean {
  if (Array.isArray(value)) {
    return (
      value.length === 2 &&
      value.includes("name") &&
      (value.includes("supplierId") || value.includes("supplier_id"))
    );
  }
  return (
    value === "source_facilities_supplier_id_name_key" ||
    value === "SourceFacility_supplierId_name_key"
  );
}

/** Only a proven name conflict is a business error; code conflicts must retry. */
export function sourceFacilityWriteError(error: unknown): never {
  const outer = record(error);
  const meta = record(outer?.meta);
  const adapter = record(meta?.driverAdapterError);
  const cause = record(adapter?.cause);
  const constraint = record(cause?.constraint);
  const unique =
    outer?.code === "P2002" ||
    outer?.code === "23505" ||
    cause?.code === "23505" ||
    cause?.originalCode === "23505";
  if (
    unique &&
    [
      meta?.target,
      outer?.constraint,
      cause?.constraint,
      constraint?.name,
      constraint?.index,
      constraint?.fields,
    ].some(isNameConstraint)
  )
    throw new HttpError(
      409,
      "Tên cơ sở cung cấp đã tồn tại trong nhà cung cấp",
    );
  throw error;
}

export function createSourceFacilityRepository(connect = getPrisma) {
  return {
    actor(id: string, tx: Tx) {
      return loadPrincipal(id, tx);
    },
    async supplierStatus(scope: SourceFacilityManagementScope, tx?: Tx) {
      return (tx ?? (await connect())).supplier.findUnique({
        where: { id: scope.supplierId },
        select: { status: true },
      });
    },
    async lockSupplier(scope: SourceFacilityManagementScope, tx: Tx) {
      await tx.$queryRaw`SELECT id FROM foodprint.suppliers WHERE id = ${scope.supplierId}::uuid FOR UPDATE`;
    },
    async lockTarget(scope: SourceFacilityManagementScope, id: string, tx: Tx) {
      await tx.$queryRaw`SELECT id FROM foodprint.source_facilities WHERE id = ${id}::uuid AND supplier_id = ${scope.supplierId}::uuid FOR UPDATE`;
    },
    async list(
      scope: SourceFacilityManagementScope,
      query: ListQuery,
    ): Promise<SourceFacilityListRow[]> {
      return (await connect()).sourceFacility.findMany({
        where: { supplierId: scope.supplierId },
        select: sourceFacilityListSelect,
        ...listWindow(query),
        orderBy: { id: "asc" },
      });
    },
    async find(
      scope: SourceFacilityManagementScope,
      id: string,
      tx?: Tx,
    ): Promise<SourceFacilityRow | null> {
      return (tx ?? (await connect())).sourceFacility.findFirst({
        where: { id, supplierId: scope.supplierId },
        select: sourceFacilityDetailSelect,
      });
    },
    async nameExists(
      scope: SourceFacilityManagementScope,
      name: string,
      tx: Tx,
      excludeId?: string,
    ): Promise<boolean> {
      return Boolean(
        await tx.sourceFacility.findFirst({
          where: {
            supplierId: scope.supplierId,
            name,
            ...(excludeId ? { id: { not: excludeId } } : {}),
          },
          select: { id: true },
        }),
      );
    },
    async highestCodeNumber(
      scope: SourceFacilityManagementScope,
      tx: Tx,
    ): Promise<bigint> {
      // Guard each cast before MAX: legacy codes must never reach numeric casts.
      const rows = await tx.$queryRaw<{ highest: string }[]>`
        SELECT COALESCE(MAX(
          CASE
            WHEN facility_code ~ '^FP-SF-([0-9]{5}|[1-9][0-9]{5,73})$'
            THEN NULLIF(substring(facility_code FROM 7)::numeric, 0)
          END
        ), 0)::text AS highest
        FROM foodprint.source_facilities
        WHERE supplier_id = ${scope.supplierId}::uuid
      `;
      const highest = rows[0]?.highest;
      if (typeof highest !== "string" || !/^[0-9]+$/.test(highest))
        throw new HttpError(
          503,
          "Không thể cấp mã cơ sở cung cấp. Vui lòng thử lại sau.",
        );
      return BigInt(highest);
    },
    async create(
      scope: SourceFacilityManagementScope,
      input: SourceFacilityCreateInput,
      actorId: string,
      facilityCode: string,
      tx: Tx,
    ): Promise<SourceFacilityRow> {
      try {
        return await tx.sourceFacility.create({
          data: {
            supplierId: scope.supplierId,
            facilityCode,
            name: input.name,
            address: input.address ?? null,
            contactName: input.contactName ?? null,
            contactPhone: input.contactPhone ?? null,
            contactEmail: input.contactEmail ?? null,
            status: "ACTIVE",
            isVisible: true,
            createdByUserId: actorId,
            updatedByUserId: actorId,
          },
          select: sourceFacilityDetailSelect,
        });
      } catch (error) {
        return sourceFacilityWriteError(error);
      }
    },
    async update(
      scope: SourceFacilityManagementScope,
      id: string,
      input: SourceFacilityEditable,
      actorId: string,
      tx: Tx,
    ): Promise<SourceFacilityRow | null> {
      try {
        const result = await tx.sourceFacility.updateMany({
          where: { id, supplierId: scope.supplierId },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.address === undefined ? {} : { address: input.address }),
            ...(input.contactName === undefined
              ? {}
              : { contactName: input.contactName }),
            ...(input.contactPhone === undefined
              ? {}
              : { contactPhone: input.contactPhone }),
            ...(input.contactEmail === undefined
              ? {}
              : { contactEmail: input.contactEmail }),
            updatedByUserId: actorId,
          },
        });
        return result.count ? this.find(scope, id, tx) : null;
      } catch (error) {
        return sourceFacilityWriteError(error);
      }
    },
    async deactivate(
      scope: SourceFacilityManagementScope,
      id: string,
      actorId: string,
      tx: Tx,
    ): Promise<SourceFacilityRow | null> {
      await tx.sourceFacility.updateMany({
        where: { id, supplierId: scope.supplierId, status: "ACTIVE" },
        data: { status: "INACTIVE", updatedByUserId: actorId },
      });
      return this.find(scope, id, tx);
    },
  };
}

export type SourceFacilityRepository = ReturnType<
  typeof createSourceFacilityRepository
>;
export const sourceFacilityRepository = createSourceFacilityRepository();
