import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  authorizationTransaction,
  loadPrincipal,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import { HttpError } from "../../utils/http-error";
import { uuid } from "../../utils/auth-validation";
import { listScopes } from "../../utils/resource-access";
import {
  contractIssues,
  dayString,
  schoolToday,
  validateDocument,
} from "./supplier-onboarding.rules";
import type {
  contractPayload,
  listQuery,
  orderPayload,
} from "./supplier-onboarding.validation";

type Tx = Prisma.TransactionClient;
type Filters = ReturnType<typeof listQuery>;
type Draft = ReturnType<typeof contractPayload>;

const documentSelect = {
  id: true,
  kind: true,
  fileName: true,
  mimeType: true,
  size: true,
  sha256: true,
  createdAt: true,
} as const;
const contractInclude = {
  items: {
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          defaultUnit: true,
          status: true,
        },
      },
    },
  },
  documents: { select: documentSelect, orderBy: { createdAt: "asc" } },
  certification: true,
  createdBy: { select: { fullName: true } },
  activatedBy: { select: { fullName: true } },
} as const satisfies Prisma.SupplierContractInclude;
type ContractRow = Prisma.SupplierContractGetPayload<{
  include: typeof contractInclude;
}>;

export function schoolScope(
  principal: AuthPrincipal,
  ...permissions: string[]
) {
  assertPermission(principal, ...permissions);
  if (principal.orgType !== "SCHOOL" || !principal.schoolId)
    throw new HttpError(403, "Tài khoản chưa thuộc phạm vi trường học.");
  return principal.schoolId;
}

export function assertContractManager(principal: AuthPrincipal) {
  const schoolId = schoolScope(principal, "supplier_relationship.manage");
  if (
    !["SCHOOL_MANAGEMENT_BOARD", "SCHOOL_ADMINISTRATION"].includes(
      principal.role,
    )
  )
    throw new HttpError(
      403,
      "Chỉ người phụ trách liên kết của trường được thay đổi hồ sơ.",
    );
  return schoolId;
}

function contractDto(contract: ContractRow) {
  const issues = currentContractIssues(contract, schoolToday());
  return {
    ...contract,
    issues,
    eligible: contract.status === "ACTIVE" && issues.length === 0,
  };
}

function currentContractIssues(contract: ContractRow, on: Date) {
  const issues = contractIssues(contract, on);
  if (contract.items.some((item) => item.ingredient.status !== "ACTIVE"))
    issues.push("Có nguyên liệu trong hợp đồng đã ngừng hoạt động.");
  return issues;
}

export async function lockSupplier(
  tx: Tx,
  schoolId: string,
  supplierId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schoolId + ":" + supplierId}, 0))`;
}

async function write<T>(
  principal: AuthPrincipal,
  supplierId: string,
  operation: (tx: Tx, actor: AuthPrincipal, schoolId: string) => Promise<T>,
  permission = "supplier_relationship.manage",
) {
  const schoolId =
    permission === "supplier_relationship.manage"
      ? assertContractManager(principal)
      : schoolScope(principal, permission);
  const db = await getPrisma();
  return authorizationTransaction(db, async (tx) => {
    const actor = await loadPrincipal(principal.id, tx);
    const currentSchool =
      permission === "supplier_relationship.manage"
        ? assertContractManager(actor)
        : schoolScope(actor, permission);
    if (currentSchool !== schoolId)
      throw new HttpError(
        403,
        "Phạm vi tài khoản đã thay đổi. Vui lòng tải lại trang.",
      );
    await lockSupplier(tx, schoolId, supplierId);
    try {
      return await operation(tx, actor, schoolId);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "P2002"
      )
        throw new HttpError(
          409,
          "Số hồ sơ đã tồn tại hoặc liên kết vừa được thay đổi. Vui lòng tải lại.",
        );
      throw error;
    }
  });
}

async function event(
  tx: Tx,
  actor: AuthPrincipal,
  relationshipId: string,
  action: string,
  reason: string,
  contractId?: string,
) {
  await tx.supplierRelationshipEvent.create({
    data: {
      relationshipId,
      contractId,
      actorId: actor.id,
      actorName: actor.fullName,
      action,
      reason,
    },
  });
}

async function findContract(principal: AuthPrincipal, id: string) {
  const schoolId = schoolScope(
    principal,
    "supplier_relationship.view",
    "supplier_relationship.manage",
  );
  const db = await getPrisma();
  const contract = await db.supplierContract.findFirst({
    where: { id, schoolId },
    include: contractInclude,
  });
  if (!contract)
    throw new HttpError(404, "Không tìm thấy hồ sơ hợp đồng của trường.");
  return contract;
}

export async function getContract(principal: AuthPrincipal, id: string) {
  return contractDto(await findContract(principal, id));
}

async function validateScope(tx: Tx, supplierId: string, draft: Draft) {
  const count = await tx.ingredient.count({
    where: { id: { in: draft.ingredientIds }, supplierId, status: "ACTIVE" },
  });
  if (count !== draft.ingredientIds.length)
    throw new HttpError(
      400,
      "Nguyên liệu phải đang hoạt động và thuộc đúng nhà cung cấp.",
    );
  if (
    draft.data.certificationId &&
    !(await tx.supplierCertification.findFirst({
      where: { id: draft.data.certificationId, supplierId },
      select: { id: true },
    }))
  )
    throw new HttpError(400, "Chứng nhận không thuộc nhà cung cấp này.");
}

export async function directory(principal: AuthPrincipal, query: Filters) {
  const schoolId = schoolScope(
    principal,
    "supplier.view",
    "supplier.manage",
    "supplier_relationship.manage",
  );
  const db = await getPrisma();
  const where: Prisma.SupplierWhereInput = {};
  if (query.status && !["ACTIVE", "INACTIVE"].includes(query.status))
    throw new HttpError(400, "Trạng thái nhà cung cấp không hợp lệ.");
  if (query.status) where.status = query.status as "ACTIVE" | "INACTIVE";
  if (query.q)
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { taxCode: { contains: query.q, mode: "insensitive" } },
    ];
  if (query.category)
    where.ingredients = {
      some: { category: query.category, status: "ACTIVE" },
    };
  let provinceId = query.provinceId;
  if (
    provinceId &&
    !(await db.location.findFirst({
      where: { id: provinceId, parentId: null, isActive: true },
    }))
  )
    throw new HttpError(400, "Tỉnh/thành không hợp lệ.");
  if (query.wardId) {
    const ward = await db.location.findFirst({
      where: { id: query.wardId, isActive: true, parentId: { not: null } },
      select: { parentId: true },
    });
    if (!ward || (provinceId && ward.parentId !== provinceId))
      throw new HttpError(400, "Xã/phường không thuộc tỉnh/thành đã chọn.");
    provinceId = ward.parentId || undefined;
  }
  if (query.wardId || provinceId) {
    if (query.locationMode === "SERVICE") {
      where.serviceAreas = {
        some: query.wardId
          ? {
              locationId: {
                in: [query.wardId, ...(provinceId ? [provinceId] : [])],
              },
            }
          : {
              OR: [
                { locationId: provinceId },
                { location: { parentId: provinceId } },
              ],
            },
      };
    } else
      where.location = query.wardId
        ? { id: query.wardId }
        : { OR: [{ id: provinceId }, { parentId: provinceId }] };
  }
  const [total, rows] = await db.$transaction([
    db.supplier.count({ where }),
    db.supplier.findMany({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        taxCode: true,
        status: true,
        address: true,
        phone: true,
        email: true,
        location: { include: { parent: true } },
        serviceAreas: { include: { location: true } },
        ingredients: {
          where: { status: "ACTIVE" },
          select: { category: true },
          distinct: ["category"],
        },
        schoolSupplierRelationships: {
          where: { schoolId, status: { in: ["ACTIVE", "SUSPENDED"] } },
          select: { id: true, status: true },
          take: 1,
        },
      },
    }),
  ]);
  return {
    items: rows.map(({ schoolSupplierRelationships, ...row }) => ({
      ...row,
      relationship: schoolSupplierRelationships[0] || null,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      hasNext: query.page * query.limit < total,
    },
  };
}

export async function locations(principal: AuthPrincipal, parentId?: string) {
  schoolScope(
    principal,
    "supplier.view",
    "supplier.manage",
    "supplier_relationship.manage",
  );
  return (await getPrisma()).location.findMany({
    where: { isActive: true, parentId: parentId ? uuid(parentId) : null },
    select: { id: true, code: true, name: true, type: true, parentId: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
}

export async function categories(principal: AuthPrincipal) {
  schoolScope(
    principal,
    "supplier.view",
    "supplier.manage",
    "supplier_relationship.manage",
  );
  const rows = await (
    await getPrisma()
  ).ingredient.findMany({
    where: { status: "ACTIVE", category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
    take: 200,
  });
  return rows.map((row) => row.category).filter(Boolean);
}

export async function supplierDetail(
  principal: AuthPrincipal,
  supplierId: string,
) {
  const schoolId = schoolScope(
    principal,
    "supplier.view",
    "supplier.manage",
    "supplier_relationship.manage",
  );
  const db = await getPrisma();
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    include: {
      location: { include: { parent: true } },
      serviceAreas: { include: { location: true } },
      ingredients: { where: { status: "ACTIVE" }, orderBy: { name: "asc" } },
      supplierCertifications: { orderBy: { createdAt: "desc" } },
      sourceFacilities: {
        where: { status: "ACTIVE" },
        select: { id: true, name: true, address: true },
      },
    },
  });
  if (!supplier) throw new HttpError(404, "Không tìm thấy nhà cung cấp.");
  const canRead = principal.permissions.some((code) =>
    ["supplier_relationship.view", "supplier_relationship.manage"].includes(
      code,
    ),
  );
  const relationships = await db.schoolSupplierRelationship.findMany({
    where: { schoolId, supplierId },
    orderBy: { linkedAt: "desc" },
  });
  const contracts = canRead
    ? await db.supplierContract.findMany({
        where: { schoolId, supplierId },
        include: contractInclude,
        orderBy: { createdAt: "desc" },
      })
    : [];
  const events = canRead
    ? await db.supplierRelationshipEvent.findMany({
        where: { relationship: { schoolId, supplierId } },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  return {
    supplier,
    relationships: canRead
      ? relationships
      : relationships.map(({ id, status }) => ({ id, status })),
    contracts: contracts.map((contract) => ({
      ...contractDto(contract),
      eligible:
        supplier.status === "ACTIVE" &&
        relationships.some(
          (relationship) =>
            relationship.id === contract.relationshipId &&
            relationship.status === "ACTIVE",
        ) &&
        contractDto(contract).eligible,
    })),
    events,
    canManage:
      principal.permissions.includes("supplier_relationship.manage") &&
      ["SCHOOL_MANAGEMENT_BOARD", "SCHOOL_ADMINISTRATION"].includes(
        principal.role,
      ),
  };
}

export async function partners(principal: AuthPrincipal, query: Filters) {
  const schoolId = schoolScope(
    principal,
    "supplier_relationship.view",
    "supplier_relationship.manage",
  );
  if (
    query.status &&
    !["ACTIVE", "SUSPENDED", "UNLINKED"].includes(query.status)
  )
    throw new HttpError(400, "Trạng thái liên kết không hợp lệ.");
  const where: Prisma.SchoolSupplierRelationshipWhereInput = {
    schoolId,
    ...(query.status
      ? { status: query.status as "ACTIVE" | "SUSPENDED" | "UNLINKED" }
      : {}),
    ...(query.q
      ? {
          Supplier: {
            OR: [
              { name: { contains: query.q, mode: "insensitive" } },
              { taxCode: { contains: query.q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };
  const db = await getPrisma();
  const [total, rows] = await db.$transaction([
    db.schoolSupplierRelationship.count({ where }),
    db.schoolSupplierRelationship.findMany({
      where,
      include: {
        Supplier: {
          select: { id: true, name: true, taxCode: true, status: true },
        },
        contracts: { include: contractInclude },
      },
      orderBy: [{ linkedAt: "desc" }, { id: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  return {
    items: rows.map(({ Supplier, contracts, ...row }) => ({
      ...row,
      supplier: Supplier,
      contracts: contracts.map(contractDto),
      eligible:
        row.status === "ACTIVE" &&
        Supplier.status === "ACTIVE" &&
        contracts.some((contract) => contractDto(contract).eligible),
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      hasNext: query.page * query.limit < total,
    },
  };
}

export async function saveDraft(
  principal: AuthPrincipal,
  draft: Draft,
  id?: string,
) {
  const existing = id ? await findContract(principal, id) : null;
  const supplierId = existing?.supplierId || draft.supplierId;
  if (!supplierId) throw new HttpError(400, "Chưa chọn nhà cung cấp.");
  const result = await write(
    principal,
    supplierId,
    async (tx, actor, schoolId) => {
      if (
        !(await tx.supplier.findFirst({
          where: { id: supplierId, status: "ACTIVE" },
          select: { id: true },
        }))
      )
        throw new HttpError(
          409,
          "Nhà cung cấp chưa hoạt động hoặc đã bị khóa.",
        );
      await validateScope(tx, supplierId, draft);
      if (id) {
        const current = await tx.supplierContract.findFirst({
          where: { id, schoolId, status: "DRAFT", revision: draft.revision },
        });
        if (!current)
          throw new HttpError(
            409,
            "Hồ sơ đã đổi hoặc đã kích hoạt. Vui lòng tải lại.",
          );
        await tx.supplierContractItem.deleteMany({ where: { contractId: id } });
        return tx.supplierContract.update({
          where: { id },
          data: {
            ...draft.data,
            revision: { increment: 1 },
            items: {
              create: draft.ingredientIds.map((ingredientId) => ({
                ingredientId,
              })),
            },
          },
          select: { id: true },
        });
      }
      return tx.supplierContract.create({
        data: {
          ...draft.data,
          schoolId,
          supplierId,
          createdByUserId: actor.id,
          items: {
            create: draft.ingredientIds.map((ingredientId) => ({
              ingredientId,
            })),
          },
        },
        select: { id: true },
      });
    },
  );
  return contractDto(await findContract(principal, result.id));
}

export async function uploadDocument(
  principal: AuthPrincipal,
  id: string,
  kind: string,
  file: Express.Multer.File,
) {
  if (!["SIGNED_CONTRACT", "COMPLIANCE", "APPENDIX"].includes(kind))
    throw new HttpError(400, "Loại hồ sơ không hợp lệ.");
  const document = validateDocument(file.buffer, file.originalname);
  const owner = await findContract(principal, id);
  await write(principal, owner.supplierId, async (tx, actor, schoolId) => {
    const contract = await tx.supplierContract.findFirst({
      where: { id, schoolId, status: "DRAFT" },
      select: { id: true },
    });
    if (!contract)
      throw new HttpError(409, "Chỉ được thêm tài liệu cho hồ sơ nháp.");
    if (
      (await tx.supplierContractDocument.count({
        where: { contractId: id },
      })) >= 10
    )
      throw new HttpError(409, "Mỗi hồ sơ tối đa 10 tệp.");
    await tx.supplierContractDocument.create({
      data: { ...document, kind, contractId: id, uploadedByUserId: actor.id },
    });
    await tx.supplierContract.update({
      where: { id },
      data: { revision: { increment: 1 } },
    });
  });
  return contractDto(await findContract(principal, id));
}

export async function downloadDocument(principal: AuthPrincipal, id: string) {
  const schoolId = schoolScope(
    principal,
    "supplier_relationship.view",
    "supplier_relationship.manage",
  );
  const file = await (
    await getPrisma()
  ).supplierContractDocument.findFirst({
    where: { id, contract: { schoolId } },
  });
  if (!file) throw new HttpError(404, "Không tìm thấy tài liệu của trường.");
  return file;
}

export async function removeDocument(principal: AuthPrincipal, id: string) {
  const file = await downloadDocument(principal, id);
  const owner = await findContract(principal, file.contractId);
  await write(principal, owner.supplierId, async (tx, _actor, schoolId) => {
    if (
      !(await tx.supplierContract.findFirst({
        where: { id: owner.id, schoolId, status: "DRAFT" },
        select: { id: true },
      }))
    )
      throw new HttpError(
        409,
        "Không được xóa tài liệu hợp đồng đã kích hoạt.",
      );
    await tx.supplierContractDocument.delete({ where: { id } });
    await tx.supplierContract.update({
      where: { id: owner.id },
      data: { revision: { increment: 1 } },
    });
  });
  return contractDto(await findContract(principal, owner.id));
}

export async function activateContract(
  principal: AuthPrincipal,
  id: string,
  revision: number,
) {
  const owner = await findContract(principal, id);
  await write(principal, owner.supplierId, async (tx, actor, schoolId) => {
    const contract = await tx.supplierContract.findFirst({
      where: { id, schoolId },
      include: contractInclude,
    });
    if (!contract) throw new HttpError(404, "Không tìm thấy hồ sơ.");
    if (contract.status === "ACTIVE") return;
    if (contract.status !== "DRAFT" || contract.revision !== revision)
      throw new HttpError(
        409,
        "Hồ sơ đã đổi. Vui lòng tải lại trước khi xác nhận.",
      );
    const issues = currentContractIssues(contract, schoolToday());
    if (issues.length) throw new HttpError(409, issues.join(" "));
    const supplier = await tx.supplier.findUniqueOrThrow({
      where: { id: contract.supplierId },
      select: {
        id: true,
        name: true,
        taxCode: true,
        address: true,
        status: true,
        location: { select: { code: true, name: true } },
      },
    });
    if (
      supplier.status !== "ACTIVE" ||
      contract.items.some((item) => item.ingredient.status !== "ACTIVE")
    )
      throw new HttpError(
        409,
        "Nhà cung cấp hoặc nguyên liệu đã ngừng hoạt động.",
      );
    if (
      await tx.supplierContract.findFirst({
        where: {
          schoolId,
          supplierId: contract.supplierId,
          status: "ACTIVE",
          relationship: { status: { in: ["ACTIVE", "SUSPENDED"] } },
          startsOn: { lte: contract.endsOn! },
          endsOn: { gte: contract.startsOn! },
          items: {
            some: {
              ingredientId: {
                in: contract.items.map((item) => item.ingredientId),
              },
            },
          },
        },
        select: { id: true },
      })
    )
      throw new HttpError(
        409,
        "Đã có hợp đồng hiệu lực trùng nguyên liệu và thời gian. Đóng hồ sơ cũ hoặc điều chỉnh thời hạn.",
      );
    let relationship = await tx.schoolSupplierRelationship.findFirst({
      where: {
        schoolId,
        supplierId: contract.supplierId,
        status: { in: ["ACTIVE", "SUSPENDED"] },
      },
    });
    if (!relationship) {
      relationship = await tx.schoolSupplierRelationship.create({
        data: {
          schoolId,
          supplierId: contract.supplierId,
          linkedByUserId: actor.id,
          linkNote: `Liên kết theo hợp đồng ${contract.number}`,
        },
      });
      await event(
        tx,
        actor,
        relationship.id,
        "LINKED",
        "Đã kiểm tra hồ sơ và xác nhận liên kết.",
        id,
      );
    }
    const snapshot = {
      supplier,
      number: contract.number,
      signedOn: dayString(contract.signedOn!),
      startsOn: dayString(contract.startsOn!),
      endsOn: dayString(contract.endsOn!),
      scopeNote: contract.scopeNote,
      items: contract.items.map((item) => ({
        id: item.ingredientId,
        name: item.ingredient.name,
        unit: item.ingredient.defaultUnit,
      })),
      certification: contract.certification,
      exemptionNote: contract.exemptionNote,
      documents: contract.documents.map((file) => ({
        id: file.id,
        kind: file.kind,
        fileName: file.fileName,
        sha256: file.sha256,
      })),
      verifiedBy: { id: actor.id, name: actor.fullName },
      verifiedAt: new Date().toISOString(),
    };
    await tx.supplierContract.update({
      where: { id },
      data: {
        status: "ACTIVE",
        relationshipId: relationship.id,
        activatedByUserId: actor.id,
        activatedAt: new Date(),
        revision: { increment: 1 },
        snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
      },
    });
    await event(
      tx,
      actor,
      relationship.id,
      "CONTRACT_ACTIVATED",
      `Kích hoạt hợp đồng ${contract.number}.`,
      id,
    );
  });
  return contractDto(await findContract(principal, id));
}

export async function closeContract(
  principal: AuthPrincipal,
  id: string,
  reason: string,
) {
  const owner = await findContract(principal, id);
  await write(principal, owner.supplierId, async (tx, actor, schoolId) => {
    const current = await tx.supplierContract.findFirst({
      where: { id, schoolId, status: "ACTIVE" },
    });
    if (!current?.relationshipId)
      throw new HttpError(409, "Chỉ đóng hợp đồng đã kích hoạt.");
    await tx.supplierContract.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closeReason: reason,
        revision: { increment: 1 },
      },
    });
    await event(
      tx,
      actor,
      current.relationshipId,
      "CONTRACT_CLOSED",
      reason,
      id,
    );
  });
  return contractDto(await findContract(principal, id));
}

export async function changeRelationship(
  principal: AuthPrincipal,
  id: string,
  action: string,
  reason: string,
) {
  const schoolId = assertContractManager(principal);
  const db = await getPrisma();
  const owner = await db.schoolSupplierRelationship.findFirst({
    where: { id, schoolId },
  });
  if (!owner) throw new HttpError(404, "Không tìm thấy liên kết của trường.");
  return write(principal, owner.supplierId, async (tx, actor) => {
    const current = await tx.schoolSupplierRelationship.findFirstOrThrow({
      where: { id, schoolId },
    });
    if (
      current.status === "UNLINKED" ||
      !["suspend", "resume", "unlink"].includes(action)
    )
      throw new HttpError(409, "Không thể thay đổi trạng thái liên kết này.");
    if (action === "suspend" && current.status !== "ACTIVE")
      throw new HttpError(409, "Liên kết không ở trạng thái hoạt động.");
    if (action === "resume") {
      if (current.status !== "SUSPENDED")
        throw new HttpError(409, "Liên kết chưa tạm dừng.");
      const contracts = await tx.supplierContract.findMany({
        where: { relationshipId: id, status: "ACTIVE" },
        include: contractInclude,
      });
      const supplier = await tx.supplier.findUniqueOrThrow({
        where: { id: owner.supplierId },
        select: { status: true },
      });
      if (
        supplier.status !== "ACTIVE" ||
        !contracts.some(
          (contract) =>
            currentContractIssues(contract, schoolToday()).length === 0,
        )
      )
        throw new HttpError(
          409,
          "Chưa có hợp đồng/hồ sơ hợp lệ để khôi phục liên kết.",
        );
    }
    const updated = await tx.schoolSupplierRelationship.update({
      where: { id },
      data:
        action === "suspend"
          ? {
              status: "SUSPENDED",
              suspendedAt: new Date(),
              suspendedByUserId: actor.id,
              suspensionReason: reason,
            }
          : action === "resume"
            ? {
                status: "ACTIVE",
                suspendedAt: null,
                suspendedByUserId: null,
                suspensionReason: null,
              }
            : {
                status: "UNLINKED",
                unlinkedAt: new Date(),
                unlinkedByUserId: actor.id,
                unlinkReason: reason,
              },
    });
    await event(
      tx,
      actor,
      id,
      action === "suspend"
        ? "SUSPENDED"
        : action === "resume"
          ? "RESUMED"
          : "UNLINKED",
      reason,
    );
    return updated;
  });
}

export async function createOrderDraft(
  principal: AuthPrincipal,
  body: ReturnType<typeof orderPayload>,
) {
  return write(
    principal,
    body.supplierId,
    async (tx, actor, schoolId) => {
      const entries = await tx.ingredientEntry.findMany({
        where: {
          id: { in: body.items.map((item) => item.ingredientEntryId) },
          schoolId,
          status: "ACTIVE",
          Ingredient: { supplierId: body.supplierId, status: "ACTIVE" },
        },
        include: { Ingredient: { select: { defaultUnit: true } } },
      });
      if (entries.length !== body.items.length)
        throw new HttpError(
          400,
          "Nguyên liệu phải thuộc trường và đúng nhà cung cấp.",
        );
      return tx.supplyRequest.create({
        data: {
          schoolId,
          supplierId: body.supplierId,
          createdByUserId: actor.id,
          requestNo: body.requestNo,
          requestedDeliveryDate: body.deliveryDate,
          supplyRequestItems: {
            create: body.items.map((item) => ({
              ingredientEntryId: item.ingredientEntryId,
              requestedQuantity: item.quantity,
              unit: entries.find(
                (entry) => entry.id === item.ingredientEntryId,
              )!.Ingredient.defaultUnit,
            })),
          },
        },
        select: { id: true, status: true, requestNo: true },
      });
    },
    "supply_request.create",
  );
}

export async function sendOrder(
  principal: AuthPrincipal,
  id: string,
  contractId: string,
) {
  const schoolId = schoolScope(principal, "supply_request.create");
  const db = await getPrisma();
  const owner = await db.supplyRequest.findFirst({ where: { id, schoolId } });
  if (!owner)
    throw new HttpError(404, "Không tìm thấy đơn đặt hàng của trường.");
  return write(
    principal,
    owner.supplierId,
    async (tx) => {
      const order = await tx.supplyRequest.findFirstOrThrow({
        where: { id, schoolId },
        include: {
          supplyRequestItems: {
            include: { IngredientEntry: { include: { Ingredient: true } } },
          },
        },
      });
      if (order.status === "SENT" && order.contractId === contractId)
        return { id, status: order.status, contractId };
      if (
        order.status !== "DRAFT" ||
        !order.requestedDeliveryDate ||
        !order.supplyRequestItems.length
      )
        throw new HttpError(
          409,
          "Đơn chưa ở trạng thái nháp hoặc thiếu ngày giao/nguyên liệu.",
        );
      const contract = await tx.supplierContract.findFirst({
        where: {
          id: contractId,
          schoolId,
          supplierId: order.supplierId,
          status: "ACTIVE",
          relationship: {
            status: "ACTIVE",
            schoolId,
            supplierId: order.supplierId,
          },
          supplier: { status: "ACTIVE" },
        },
        include: contractInclude,
      });
      if (!contract)
        throw new HttpError(
          409,
          "NCC phải đang liên kết và có hợp đồng được kích hoạt.",
        );
      const issues = currentContractIssues(
        contract,
        order.requestedDeliveryDate,
      );
      if (order.requestedDeliveryDate < schoolToday())
        issues.push("Ngày giao dự kiến đã qua.");
      if (
        order.supplyRequestItems.some(
          (item) =>
            item.IngredientEntry.schoolId !== schoolId ||
            item.IngredientEntry.status !== "ACTIVE" ||
            item.IngredientEntry.Ingredient.status !== "ACTIVE" ||
            item.IngredientEntry.Ingredient.supplierId !== order.supplierId ||
            !contract.items.some(
              (scope) =>
                scope.ingredientId === item.IngredientEntry.ingredientId,
            ),
        )
      )
        issues.push(
          "Có nguyên liệu ngoài phạm vi hợp đồng hoặc đã ngừng hoạt động.",
        );
      if (issues.length) throw new HttpError(409, issues.join(" "));
      return tx.supplyRequest.update({
        where: { id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          contractId,
          contractSnapshot: {
            contractId,
            contract: contract.snapshot,
            deliveryDate: dayString(order.requestedDeliveryDate),
          },
        },
        select: { id: true, status: true, contractId: true },
      });
    },
    "supply_request.create",
  );
}

export async function orderEvidence(principal: AuthPrincipal, id: string) {
  assertPermission(principal, "supply_request.view", "traceability.view");
  let where: Prisma.SupplyRequestWhereInput;
  if (principal.permissions.includes("supply_request.view"))
    where = listScopes["supply-order"](principal);
  else if (principal.orgType === "SCHOOL" && principal.schoolId)
    where = { schoolId: principal.schoolId };
  else if (principal.orgType === "SUPPLIER" && principal.supplierId)
    where = { supplierId: principal.supplierId };
  else if (principal.orgType === "SYSTEM") where = {};
  else throw new HttpError(403, "Không có phạm vi truy xuất đơn đặt hàng.");
  const order = await (
    await getPrisma()
  ).supplyRequest.findFirst({
    where: { id, ...where },
    select: {
      id: true,
      requestNo: true,
      contractId: true,
      contractSnapshot: true,
    },
  });
  if (!order)
    throw new HttpError(
      404,
      "Không tìm thấy đơn đặt hàng trong phạm vi tài khoản.",
    );
  return order;
}
