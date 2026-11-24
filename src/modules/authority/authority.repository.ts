import type { Prisma } from "../../generated/prisma/client";
import {
  wardLocationSelect,
  type WardLocationRow,
} from "../../utils/ward-location";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Prisma.TransactionClient, "school">;

const locationSummarySelect = { id: true, code: true, name: true } as const;

export const authoritySchoolSelect = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  email: true,
  status: true,
  location: { select: locationSummarySelect },
} as const satisfies Prisma.SchoolSelect;

export type AuthoritySchoolRow = Prisma.SchoolGetPayload<{
  select: typeof authoritySchoolSelect;
}>;

/** FR-011: chỉ NCC còn hoạt động có quan hệ `ACTIVE`/`SUSPENDED` (ẩn `UNLINKED`). */
const visibleSupplierLink = {
  status: { in: ["ACTIVE", "SUSPENDED"] },
  Supplier: { status: "ACTIVE" },
} as const satisfies Prisma.SchoolSupplierRelationshipWhereInput;

export const authoritySchoolDetailSelect = {
  ...authoritySchoolSelect,
  schoolSupplierRelationships: {
    where: visibleSupplierLink,
    orderBy: [{ Supplier: { name: "asc" } }, { supplierId: "asc" }],
    select: {
      status: true,
      linkedAt: true,
      suspendedAt: true,
      Supplier: {
        select: {
          id: true,
          name: true,
          taxCode: true,
          phone: true,
          email: true,
          address: true,
          intakeState: true,
          location: { select: locationSummarySelect },
        },
      },
    },
  },
} as const satisfies Prisma.SchoolSelect;

export type AuthoritySchoolDetailRow = Prisma.SchoolGetPayload<{
  select: typeof authoritySchoolDetailSelect;
}>;

export interface OrganizationLocationRow {
  id: string;
  name: string;
  location: { id: string; code: string; name: string } | null;
}

const unitLocationSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  location: { select: { id: true, code: true, name: true } },
} as const satisfies Prisma.CommuneFoodSafetyUnitSelect;

export type AuthorityLocationRow = Prisma.CommuneFoodSafetyUnitGetPayload<{
  select: typeof unitLocationSelect;
}>;

export function createAuthorityRepository() {
  return {
    /** Khóa dòng đơn vị để các lần gắn địa bàn cùng đơn vị chạy tuần tự. */
    async lockUnit(tx: Tx, id: string): Promise<boolean> {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM foodprint.commune_food_safety_units
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      return rows.length === 1;
    },
    findLocation(
      tx: Tx,
      id: string,
    ): Promise<{ id: string; level: number; isActive: boolean } | null> {
      return tx.location.findUnique({
        where: { id },
        select: { id: true, level: true, isActive: true },
      });
    },
    findUnitByLocation(
      tx: Tx,
      locationId: string,
    ): Promise<{ id: string } | null> {
      return tx.communeFoodSafetyUnit.findFirst({
        where: { locationId },
        select: { id: true },
      });
    },
    findWard(tx: Tx, id: string): Promise<WardLocationRow | null> {
      return tx.location.findUnique({
        where: { id },
        select: wardLocationSelect,
      });
    },
    /** Khóa dòng trường/NCC trước khi đổi phường/xã để các lần gắn chạy tuần tự. */
    async lockOrganization(
      tx: Tx,
      kind: "school" | "supplier",
      id: string,
    ): Promise<boolean> {
      const rows =
        kind === "school"
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM foodprint.schools WHERE id = ${id}::uuid FOR UPDATE
            `
          : await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM foodprint.suppliers WHERE id = ${id}::uuid FOR UPDATE
            `;
      return rows.length === 1;
    },
    updateOrganizationLocation(
      tx: Tx,
      kind: "school" | "supplier",
      id: string,
      locationId: string,
    ): Promise<OrganizationLocationRow> {
      const select = {
        id: true,
        name: true,
        location: { select: locationSummarySelect },
      } as const;
      return kind === "school"
        ? tx.school.update({ where: { id }, data: { locationId }, select })
        : tx.supplier.update({ where: { id }, data: { locationId }, select });
    },
    listSchools(
      client: Reader,
      args: { where: Prisma.SchoolWhereInput; skip: number; take: number },
    ): Promise<AuthoritySchoolRow[]> {
      return client.school.findMany({
        ...args,
        select: authoritySchoolSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
    findSchoolDetail(
      client: Reader,
      where: Prisma.SchoolWhereInput,
    ): Promise<AuthoritySchoolDetailRow | null> {
      return client.school.findFirst({
        where,
        select: authoritySchoolDetailSelect,
      });
    },
    updateLocation(
      tx: Tx,
      id: string,
      locationId: string,
    ): Promise<AuthorityLocationRow> {
      return tx.communeFoodSafetyUnit.update({
        where: { id },
        data: { locationId },
        select: unitLocationSelect,
      });
    },
  };
}

export type AuthorityRepository = ReturnType<typeof createAuthorityRepository>;
export const authorityRepository = createAuthorityRepository();
