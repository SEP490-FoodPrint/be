import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
export const certificationSelect = {
  id: true,
  supplierId: true,
  certificationType: true,
  certificateNo: true,
  issuedDate: true,
  expiryDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.SupplierCertificationSelect;
export type CertificationRow = Prisma.SupplierCertificationGetPayload<{
  select: typeof certificationSelect;
}>;
export type CertificationListArguments = Pick<
  Prisma.SupplierCertificationFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & { select: typeof certificationSelect };
export type CertificationReader = (
  args: CertificationListArguments,
) => Promise<CertificationRow[]>;
const documentSelect = { ...certificationSelect, documentUrl: true } as const;
const applicationSelect = {
  id: true,
  applicantUserId: true,
  profileData: true,
  supportingDocuments: true,
} as const;
export type CertificateWithAnchor = Prisma.SupplierCertificationGetPayload<{
  select: typeof documentSelect;
}>;
export type CertificateApplication = Prisma.RegistrationRequestGetPayload<{
  select: typeof applicationSelect;
}>;
export function createSupplierCertificationRepository(
  read?: CertificationReader,
) {
  return {
    async legacy(
      scope: Prisma.SupplierCertificationWhereInput,
      page: number,
      limit: number,
    ) {
      const args = {
        where: scope,
        select: certificationSelect,
        skip: (page - 1) * limit,
        take: limit + 1,
        orderBy: [{ id: "asc" as const }],
      };
      return read
        ? read(args)
        : (await getPrisma()).supplierCertification.findMany(args);
    },
    async parent(
      tx: Prisma.TransactionClient,
      scope: Prisma.SupplierCertificationWhereInput,
      supplierId: string,
    ) {
      // Supplier ownership is authorized by the trusted certificate scope, including empty suppliers.
      const own = scope.supplierId;
      return tx.supplier.findFirst({
        where: {
          AND: [{ id: supplierId }, ...(own ? [{ id: own as string }] : [])],
        },
        select: { id: true },
      });
    },
    async page(
      tx: Prisma.TransactionClient,
      scope: Prisma.SupplierCertificationWhereInput,
      supplierId: string,
      page: number,
      limit: number,
    ) {
      const where = { AND: [scope, { supplierId }] };
      const total = await tx.supplierCertification.count({ where });
      const items = await tx.supplierCertification.findMany({
        where,
        select: documentSelect,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: "asc" },
      });
      return { items, total };
    },
    async find(
      tx: Prisma.TransactionClient,
      scope: Prisma.SupplierCertificationWhereInput,
      id: string,
    ) {
      return tx.supplierCertification.findFirst({
        where: { AND: [scope, { id }] },
        select: documentSelect,
      });
    },
    async applications(tx: Prisma.TransactionClient, ids: string[]) {
      return tx.registrationRequest.findMany({
        where: { id: { in: ids }, status: "APPROVED", requestType: "SUPPLIER" },
        select: applicationSelect,
      });
    },
  };
}
export type SupplierCertificationRepository = ReturnType<
  typeof createSupplierCertificationRepository
>;
