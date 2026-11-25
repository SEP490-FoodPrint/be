import type { Prisma } from "../../generated/prisma/client";
import type { AuthPrincipal } from "../../types/auth";
import {
  assertPermission,
  authorizationTransaction,
  databaseOperation,
  loadPrincipal,
} from "../../utils/authorization";
import { getPrisma } from "../../utils/database";
import {
  loadFreshDemand,
  saveBatch1Snapshot,
} from "../supply-order/fresh-demand.service";
import { HttpError } from "../../utils/http-error";
import { uuid } from "../../utils/auth-validation";
import { listScopes } from "../../utils/resource-access";
import {
  activationDate,
  contractIssues,
  dayString,
  schoolToday,
  validateDocument,
} from "./supplier-onboarding.rules";
import type {
  contractPayload,
  listQuery,
} from "./supplier-onboarding.validation";
import {
  contractInclude,
  ingredientHandlingRepository,
  lockSupplier,
  supplierOrderRepository,
} from "./supplier-onboarding.repository";
import { createIntakeAccessRepository } from "../account-lifecycle/intake-access.repository";
import { createIntakeAccessService } from "../account-lifecycle/intake-access.service";
import type {
  ContractItemsRequestDTO,
  IngredientHandlingParamsRequestDTO,
  IngredientHandlingRequestDTO,
  OrderDraftRequestDTO,
  OrderSendParamsRequestDTO,
  OrderSendRequestDTO,
} from "./supplier-onboarding.request.dto";
import type {
  IngredientHandlingResponseDTO,
  OrderDraftResponseDTO,
  OrderSendResponseDTO,
  SuppliedIngredientResponseDTO,
} from "./supplier-onboarding.response.dto";

const intakeRepository = createIntakeAccessRepository();
const intakeAccess = createIntakeAccessService(intakeRepository);

type Tx = Prisma.TransactionClient;
type Filters = ReturnType<typeof listQuery>;
type Draft = ReturnType<typeof contractPayload>;

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
  const issues = currentContractIssues(contract, activationDate(contract));
  return {
    ...contract,
    items: contract.items.map((item) => {
      const { ingredientCategory, ...ingredient } = item.ingredient;
      return {
        ...item,
        ingredient: {
          ...ingredient,
          category: ingredientCategory?.categoryName ?? null,
        },
      };
    }),
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
  const db = await databaseOperation(getPrisma);
  return authorizationTransaction(db, async (tx) => {
    let actor = await loadPrincipal(principal.id, tx);
    const currentSchool =
      permission === "supplier_relationship.manage"
        ? assertContractManager(actor)
        : schoolScope(actor, permission);
    if (currentSchool !== schoolId)
      throw new HttpError(
        403,
        "Phạm vi tài khoản đã thay đổi. Vui lòng tải lại trang.",
      );
    // All callers take the same parent locks before the pair advisory lock;
    // otherwise contract writes can deadlock with lifecycle changes.
    await intakeRepository.lockParents(tx, {
      schoolId,
      supplierId,
      userIds: [actor.id],
      roleIds: [actor.roleId],
    });
    await lockSupplier(tx, schoolId, supplierId);
    actor = await loadPrincipal(principal.id, tx);
    const lockedSchool =
      permission === "supplier_relationship.manage"
        ? assertContractManager(actor)
        : schoolScope(actor, permission);
    if (lockedSchool !== schoolId)
      throw new HttpError(
        403,
        "Phạm vi tài khoản đã thay đổi. Vui lòng tải lại trang.",
      );
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

type HandlingType = "DRY_STOCK" | "DIRECT_USE";
type HandlingItem = ContractItemsRequestDTO[number];
type HandlingChange = {
  ingredientId: string;
  from: HandlingType | null;
  to: HandlingType;
};

export const HANDLING_LABELS: Record<HandlingType, string> = {
  DRY_STOCK: "Lưu kho",
  DIRECT_USE: "Dùng ngay",
};

/** Hồ sơ tạo trước khi có cột loại nguyên liệu phải được chọn loại trước khi kích hoạt. */
export function contractHandlingItems(
  items: { ingredientId: string; handlingType: HandlingType | null }[],
): HandlingItem[] {
  if (items.some((item) => !item.handlingType))
    throw new HttpError(
      409,
      "Còn nguyên liệu chưa chọn loại Lưu kho/Dùng ngay. Cập nhật hồ sơ trước khi kích hoạt.",
    );
  return items.map((item) => ({
    ingredientId: item.ingredientId,
    handlingType: item.handlingType!,
  }));
}

/**
 * Tạo IngredientEntry còn thiếu và cập nhật loại/trạng thái entry đã có theo (trường, nguyên liệu).
 * Chạy trong transaction đã giữ khóa trường–NCC nên không tạo trùng.
 */
export async function syncIngredientEntries(
  tx: Tx,
  schoolId: string,
  actorId: string,
  items: HandlingItem[],
  repository: typeof ingredientHandlingRepository = ingredientHandlingRepository,
): Promise<HandlingChange[]> {
  if (!items.length) return [];
  const existing = await repository.findEntries(
    tx,
    schoolId,
    items.map((item) => item.ingredientId),
  );
  const byIngredient = new Map(
    existing.map((entry) => [entry.ingredientId, entry]),
  );
  const missing = items.filter((item) => !byIngredient.has(item.ingredientId));
  if (missing.length)
    await repository.createEntries(tx, schoolId, actorId, missing);
  const changes: HandlingChange[] = missing.map((item) => ({
    ingredientId: item.ingredientId,
    from: null,
    to: item.handlingType,
  }));
  for (const item of items) {
    const entry = byIngredient.get(item.ingredientId);
    if (
      !entry ||
      (entry.handlingType === item.handlingType && entry.status === "ACTIVE")
    )
      continue;
    const previous = entry.handlingType;
    await repository.updateEntry(tx, entry.id, item.handlingType);
    if (previous !== item.handlingType)
      changes.push({
        ingredientId: item.ingredientId,
        from: previous,
        to: item.handlingType,
      });
  }
  return changes;
}

async function suppliedIngredientsOf(
  db: Tx,
  schoolId: string,
  supplierId: string,
): Promise<SuppliedIngredientResponseDTO[]> {
  const rows = await ingredientHandlingRepository.activeContractItems(
    db,
    schoolId,
    supplierId,
  );
  if (!rows.length) return [];
  const entries = await ingredientHandlingRepository.findEntries(db, schoolId, [
    ...new Set(rows.map((row) => row.ingredientId)),
  ]);
  const handling = new Map(
    entries.map((entry) => [entry.ingredientId, entry.handlingType]),
  );
  const result = new Map<string, SuppliedIngredientResponseDTO>();
  for (const row of rows) {
    const item = result.get(row.ingredientId) ?? {
      ingredientId: row.ingredientId,
      name: row.ingredient.name,
      unit: row.ingredient.defaultUnit,
      category: row.ingredient.ingredientCategory?.categoryName ?? null,
      handlingType: handling.get(row.ingredientId) ?? null,
      contracts: [],
    };
    item.contracts.push({
      id: row.contract.id,
      number: row.contract.number,
      startsOn: row.contract.startsOn ? dayString(row.contract.startsOn) : null,
      endsOn: row.contract.endsOn ? dayString(row.contract.endsOn) : null,
    });
    result.set(row.ingredientId, item);
  }
  return [...result.values()];
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
      some: {
        ingredientCategory: { categoryName: query.category },
        status: "ACTIVE",
      },
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
          select: { ingredientCategory: { select: { categoryName: true } } },
          distinct: ["categoryId"],
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
      ingredients: row.ingredients.map(({ ingredientCategory }) => ({
        category: ingredientCategory?.categoryName ?? null,
      })),
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
    where: { status: "ACTIVE", categoryId: { not: null } },
    select: { ingredientCategory: { select: { categoryName: true } } },
    distinct: ["categoryId"],
    orderBy: { ingredientCategory: { categoryName: "asc" } },
    take: 200,
  });
  return rows
    .map((row) => row.ingredientCategory?.categoryName)
    .filter(Boolean);
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
      ingredients: {
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: {
          id: true,
          supplierId: true,
          name: true,
          defaultUnit: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          ingredientCategory: { select: { categoryName: true } },
        },
      },
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
  const suppliedIngredients = canRead
    ? await suppliedIngredientsOf(db, schoolId, supplierId)
    : [];
  const events = canRead
    ? await db.supplierRelationshipEvent.findMany({
        where: { relationship: { schoolId, supplierId } },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  return {
    supplier: {
      ...supplier,
      ingredients: supplier.ingredients.map(
        ({ ingredientCategory, ...ingredient }) => ({
          ...ingredient,
          category: ingredientCategory?.categoryName ?? null,
        }),
      ),
    },
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
    suppliedIngredients,
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
              create: draft.items.map(({ ingredientId, handlingType }) => ({
                ingredientId,
                handlingType,
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
            create: draft.items.map(({ ingredientId, handlingType }) => ({
              ingredientId,
              handlingType,
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
    const issues = currentContractIssues(contract, activationDate(contract));
    if (issues.length) throw new HttpError(409, issues.join(" "));
    const contractItems = contractHandlingItems(contract.items);
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
    await syncIngredientEntries(tx, schoolId, actor.id, contractItems);
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
        handlingType: item.handlingType,
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
            currentContractIssues(contract, activationDate(contract)).length ===
            0,
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

export function createOrderIntakeService(
  dependencies: {
    repository?: typeof supplierOrderRepository;
    guard?: Pick<typeof intakeAccess, "assertAccess">;
    write?: typeof write;
    freshDemand?: {
      load: typeof loadFreshDemand;
      saveBatch1: typeof saveBatch1Snapshot;
    };
  } = {},
) {
  const freshDemand = dependencies.freshDemand ?? {
    load: loadFreshDemand,
    saveBatch1: saveBatch1Snapshot,
  };
  const orderRepository = dependencies.repository ?? supplierOrderRepository;
  const guard = dependencies.guard ?? intakeAccess;
  const writeOrder = dependencies.write ?? write;
  async function createOrderDraft(
    principal: AuthPrincipal,
    body: OrderDraftRequestDTO,
  ): Promise<OrderDraftResponseDTO> {
    return writeOrder(
      principal,
      body.supplierId,
      async (tx, actor, schoolId) => {
        await guard.assertAccess(tx, actor, {
          operation: "SCHOOL_CREATE_ORDER",
          supplierId: body.supplierId,
        });
        const entries = await orderRepository.findEntries(
          tx,
          body.items.map((item) => item.ingredientEntryId),
          schoolId,
          body.supplierId,
        );
        if (entries.length !== body.items.length)
          throw new HttpError(
            400,
            "Nguyên liệu phải thuộc trường và đúng nhà cung cấp.",
          );
        // Đợt 2 (mã đuôi -D2 / -D2-n) tính theo sĩ số thực tế: mọi lớp có đăng ký suất ăn phải chốt
        // điểm danh bữa trưa của ngày giao trước khi được tạo yêu cầu nhập hàng.
        const mismatched = entries.find(
          (entry) => entry.handlingType !== body.orderType,
        );
        if (mismatched)
          throw new HttpError(
            400,
            `Nguyên liệu ${mismatched.Ingredient.name} không thuộc loại ${body.orderType === "DRY_STOCK" ? "Đồ lưu kho" : "Đồ tươi"} của đơn`,
          );
        if (body.orderType === "DIRECT_USE" && body.batchNo === 2) {
          const notFinalized = await tx.class.findMany({
            where: {
              schoolId,
              status: "ACTIVE",
              registeredMealPortions: { gt: 0 },
              NOT: {
                dailyMealPortions: {
                  some: {
                    mealDate: body.deliveryDate,
                    mealType: "LUNCH",
                    status: "FINALIZED",
                  },
                },
              },
            },
            select: { name: true },
            orderBy: { name: "asc" },
          });
          if (notFinalized.length)
            throw new HttpError(
              409,
              `Chưa thể tạo yêu cầu nhập hàng Đợt 2: còn ${notFinalized.length} lớp chưa chốt điểm danh (${notFinalized.map((c) => c.name).join(", ")})`,
            );
          const round2 = await tx.supplyRound.findUnique({
            where: {
              schoolId_deliveryDate_batchNo: {
                schoolId,
                deliveryDate: body.deliveryDate,
                batchNo: 2,
              },
            },
            select: { status: true },
          });
          if (round2?.status === "NOT_NEEDED")
            throw new HttpError(409, "Đợt 2 không cần đặt thêm hàng");
        }
        // TASK-08: Đợt 1 lưu mốc suất theo khối (dùng chung cho mọi NCC cùng ngày); Đợt 2 bắt buộc đã có mốc.
        let split = new Map<
          string,
          { carryOverQuantity: number; sampleCompensationQuantity: number }
        >();
        if (body.orderType === "DIRECT_USE" && body.batchNo) {
          const date = body.deliveryDate.toISOString().slice(0, 10);
          const demand = await freshDemand.load(
            tx,
            schoolId,
            date,
            body.batchNo,
          );
          // Đợt 2 của ngày có Đợt 1 cũ (chưa có mốc): lưu mốc bù để các đơn sau dùng chung.
          await freshDemand.saveBatch1(
            tx,
            schoolId,
            date,
            demand.grades,
            body.batchNo === 1 ? demand.items : [],
          );
          // V15: số lượng đơn đồ tươi theo đợt cố định theo hệ thống tính, không cho sửa.
          const round3 = (value: number) => Number(value.toFixed(3));
          for (const item of body.items) {
            const expected = demand.items.find(
              (row) => row.ingredientEntryId === item.ingredientEntryId,
            );
            if (
              !expected ||
              Math.abs(round3(item.quantity) - round3(expected.orderQuantity)) >
                0.0005
            )
              throw new HttpError(
                400,
                `Số lượng ${expected?.name ?? "nguyên liệu"} phải đúng lượng hệ thống tính cho đợt (không được sửa)`,
              );
          }
          if (body.batchNo === 2)
            split = new Map(
              demand.items.map((row) => [
                row.ingredientEntryId,
                {
                  carryOverQuantity: round3(row.carryOverQuantity),
                  sampleCompensationQuantity: round3(
                    row.sampleCompensationQuantity ?? 0,
                  ),
                },
              ]),
            );
        }
        const result = await orderRepository.createDraft(tx, {
          schoolId,
          supplierId: body.supplierId,
          createdByUserId: actor.id,
          requestNo: body.requestNo,
          deliveryDate: body.deliveryDate,
          orderType: body.orderType,
          batchNo: body.batchNo,
          note: body.note,
          items: body.items.map((item) => ({
            ...item,
            ...split.get(item.ingredientEntryId),
            unit: entries.find((entry) => entry.id === item.ingredientEntryId)!
              .Ingredient.defaultUnit,
          })),
        });
        return {
          id: result.id,
          status: result.status,
          requestNo: result.requestNo,
          orderType: result.orderType ?? body.orderType,
          batchNo: (result.batchNo ?? null) as 1 | 2 | null,
        };
      },
      "supply_request.create",
    );
  }

  async function sendOrder(
    principal: AuthPrincipal,
    params: OrderSendParamsRequestDTO,
    input: OrderSendRequestDTO,
  ): Promise<OrderSendResponseDTO> {
    const { id } = params;
    const { contractId } = input;
    const schoolId = schoolScope(principal, "supply_request.create");
    const owner = await databaseOperation(() =>
      orderRepository.findOwner(id, schoolId),
    );
    if (!owner)
      throw new HttpError(404, "Không tìm thấy đơn đặt hàng của trường.");
    return writeOrder(
      principal,
      owner.supplierId,
      async (tx, actor) => {
        const order = await orderRepository.findOrderForSend(tx, id, schoolId);
        if (!order || order.supplierId !== owner.supplierId)
          throw new HttpError(404, "Không tìm thấy đơn đặt hàng của trường.");
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
        await guard.assertAccess(tx, actor, {
          operation: "SCHOOL_SEND_ORDER",
          orderId: id,
        });
        const contract = await orderRepository.findEligibleContract(
          tx,
          contractId,
          schoolId,
          order.supplierId,
        );
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
        const result = await orderRepository.markSent(tx, id, contractId, {
          contractId,
          contract: contract.snapshot,
          deliveryDate: dayString(order.requestedDeliveryDate),
        });
        return {
          id: result.id,
          status: result.status,
          contractId: result.contractId,
        };
      },
      "supply_request.create",
    );
  }

  return { createOrderDraft, sendOrder };
}

export const { createOrderDraft, sendOrder } = createOrderIntakeService();

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

export function createIngredientHandlingService(
  dependencies: {
    repository?: typeof ingredientHandlingRepository;
    write?: typeof write;
  } = {},
) {
  const repository = dependencies.repository ?? ingredientHandlingRepository;
  const writeHandling = dependencies.write ?? write;

  async function updateIngredientHandling(
    principal: AuthPrincipal,
    params: IngredientHandlingParamsRequestDTO,
    body: IngredientHandlingRequestDTO,
  ): Promise<IngredientHandlingResponseDTO> {
    assertContractManager(principal);
    return writeHandling(
      principal,
      params.supplierId,
      async (tx, actor, schoolId) => {
        const scope = await repository.activeContractItems(
          tx,
          schoolId,
          params.supplierId,
        );
        const names = new Map(
          scope.map((row) => [row.ingredientId, row.ingredient.name]),
        );
        if (body.items.some((item) => !names.has(item.ingredientId)))
          throw new HttpError(
            409,
            "Có nguyên liệu không thuộc hợp đồng đang hiệu lực của trường với nhà cung cấp này.",
          );
        const entries = await repository.findEntries(
          tx,
          schoolId,
          body.items.map((item) => item.ingredientId),
        );
        const current = new Map(
          entries.map((entry) => [entry.ingredientId, entry.handlingType]),
        );
        const changed = body.items.filter(
          (item) => current.get(item.ingredientId) !== item.handlingType,
        );
        if (!changed.length) return { changes: [] };
        const blocked = await repository.pendingDeliveries(
          tx,
          schoolId,
          changed.map((item) => item.ingredientId),
        );
        if (blocked.length)
          throw new HttpError(
            409,
            `Không thể đổi loại khi còn xe đã đến hoặc đang chờ duyệt có nguyên liệu này: ${blocked
              .map((delivery) => delivery.deliveryNo)
              .join(", ")}.`,
          );
        const changes = await syncIngredientEntries(
          tx,
          schoolId,
          actor.id,
          changed,
          repository,
        );
        const relationshipId = scope.find((row) => row.contract.relationshipId)
          ?.contract.relationshipId;
        if (!relationshipId)
          throw new HttpError(409, "Không tìm thấy liên kết của hợp đồng.");
        const result = changes.map((change) => ({
          ...change,
          name: names.get(change.ingredientId)!,
        }));
        await repository.createEvent(tx, {
          relationshipId,
          actorId: actor.id,
          actorName: actor.fullName,
          action: "INGREDIENT_HANDLING_CHANGED",
          reason: result
            .map(
              (change) =>
                `${change.name}: ${change.from ? HANDLING_LABELS[change.from] : "Chưa có"} → ${HANDLING_LABELS[change.to]}`,
            )
            .join("; "),
        });
        return { changes: result };
      },
    );
  }

  return { updateIngredientHandling };
}

export const { updateIngredientHandling } = createIngredientHandlingService();
