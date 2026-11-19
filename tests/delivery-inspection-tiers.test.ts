import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { INSPECTION_TIER_LABELS } from "../src/constants/delivery-inspection";
import { ROLES, ROLE_LABELS } from "../src/constants/roles";
import { createOrganizationService } from "../src/modules/organization/organization.service";
import type { OrganizationRepository } from "../src/modules/organization/organization.repository";
import {
  validateDeliveryInspectionRoles,
  OrganizationValidationError,
} from "../src/modules/organization/organization.validation";
import { createDeliveryInspectionService } from "../src/modules/delivery/delivery.service";

const isHttp = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

const approveDecision = { decision: "APPROVE" as const, reason: null };

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const schoolId = uid(1);
const schoolIdB = uid(2);

const bghPrincipal: AuthPrincipal = {
  id: uid(10),
  username: "bgh_user",
  fullName: "Ban Giám Hiệu",
  roleId: uid(11),
  role: ROLES.SCHOOL_MANAGEMENT_BOARD,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["school_delivery_inspection.manage"],
};

const kitchenPrincipal: AuthPrincipal = {
  id: uid(20),
  username: "kitchen_user",
  fullName: "Nhân viên Bếp",
  roleId: uid(21),
  role: ROLES.SCHOOL_KITCHEN_STAFF,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["delivery.view", "delivery.inspect"],
};

const warehousePrincipal: AuthPrincipal = {
  id: uid(30),
  username: "warehouse_user",
  fullName: "Quản lý Kho",
  roleId: uid(31),
  role: ROLES.INGREDIENT_MANAGEMENT,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["delivery.view", "delivery.inspect"],
};

const nutritionPrincipal: AuthPrincipal = {
  id: uid(40),
  username: "nutrition_user",
  fullName: "Nhân viên Dinh dưỡng",
  roleId: uid(41),
  role: ROLES.SCHOOL_NUTRITION_OFFICER,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["delivery.view", "delivery.inspect"],
};

const parentsPrincipal: AuthPrincipal = {
  id: uid(50),
  username: "parents_user",
  fullName: "Ban Phụ huynh",
  roleId: uid(51),
  role: ROLES.PARENTS_COMMITTEE,
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["delivery.view", "delivery.inspect"],
};

// ==========================================
// T1: Trường chưa cấu hình, GET config
// ==========================================
void test("T1: Trường chưa cấu hình, GET config trả mặc định configured=false, Bếp=PRIMARY, Kho/DD=REQUIRED, PH=OPTIONAL", async () => {
  const mockRepo = {
    findDeliveryInspectionRoles: (sId: string) => {
      assert.equal(sId, schoolId);
      return Promise.resolve([]);
    },
  } as unknown as OrganizationRepository;

  const service = createOrganizationService(mockRepo);
  const result = await service.getDeliveryInspectionRoles(bghPrincipal);

  assert.equal(result.configured, false);
  assert.equal(result.updatedAt, null);
  assert.equal(result.roles.length, 4);

  const [kitchen, warehouse, nutrition, parents] = result.roles;
  assert.deepEqual(kitchen, {
    roleCode: ROLES.SCHOOL_KITCHEN_STAFF,
    roleName: ROLE_LABELS[ROLES.SCHOOL_KITCHEN_STAFF],
    tier: "PRIMARY",
    tierLabel: INSPECTION_TIER_LABELS.PRIMARY,
    editable: true,
  });
  assert.deepEqual(warehouse, {
    roleCode: ROLES.INGREDIENT_MANAGEMENT,
    roleName: ROLE_LABELS[ROLES.INGREDIENT_MANAGEMENT],
    tier: "REQUIRED",
    tierLabel: INSPECTION_TIER_LABELS.REQUIRED,
    editable: true,
  });
  assert.deepEqual(nutrition, {
    roleCode: ROLES.SCHOOL_NUTRITION_OFFICER,
    roleName: ROLE_LABELS[ROLES.SCHOOL_NUTRITION_OFFICER],
    tier: "REQUIRED",
    tierLabel: INSPECTION_TIER_LABELS.REQUIRED,
    editable: true,
  });
  assert.deepEqual(parents, {
    roleCode: ROLES.PARENTS_COMMITTEE,
    roleName: ROLE_LABELS[ROLES.PARENTS_COMMITTEE],
    tier: "OPTIONAL",
    tierLabel: INSPECTION_TIER_LABELS.OPTIONAL,
    editable: false,
  });
});

// ==========================================
// T2: PUT payload validation
// ==========================================
void test("T2: PUT validation chặn 2 PRIMARY, 0 PRIMARY, trùng role, thiếu role, gửi PARENTS_COMMITTEE, field lạ", () => {
  // Hợp lệ
  const validPayload = {
    roles: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "OPTIONAL" },
    ],
  };
  assert.deepEqual(validateDeliveryInspectionRoles(validPayload), validPayload);

  // 0 PRIMARY
  assert.throws(
    () =>
      validateDeliveryInspectionRoles({
        roles: [
          { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "REQUIRED" },
          { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
          { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "OPTIONAL" },
        ],
      }),
    (err: unknown) => {
      assert(err instanceof OrganizationValidationError);
      assert.equal(
        err.fields[0].message,
        "Phải chọn đúng một người duyệt chính",
      );
      return true;
    },
  );

  // 2 PRIMARY
  assert.throws(
    () =>
      validateDeliveryInspectionRoles({
        roles: [
          { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
          { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "PRIMARY" },
          { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
        ],
      }),
    (err: unknown) => {
      assert(err instanceof OrganizationValidationError);
      assert.equal(
        err.fields[0].message,
        "Phải chọn đúng một người duyệt chính",
      );
      return true;
    },
  );

  // Trùng role
  assert.throws(
    () =>
      validateDeliveryInspectionRoles({
        roles: [
          { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
          { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "REQUIRED" },
          { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "OPTIONAL" },
        ],
      }),
    (err: unknown) => {
      assert(err instanceof OrganizationValidationError);
      assert(
        err.fields.some(
          (f) => f.message === "Mỗi bộ phận chỉ được khai báo một lần",
        ),
      );
      return true;
    },
  );

  // Thiếu role (<3)
  assert.throws(
    () =>
      validateDeliveryInspectionRoles({
        roles: [
          { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
          { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
        ],
      }),
    OrganizationValidationError,
  );

  // Gửi PARENTS_COMMITTEE
  assert.throws(
    () =>
      validateDeliveryInspectionRoles({
        roles: [
          { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
          { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
          { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
        ],
      }),
    OrganizationValidationError,
  );

  // Field lạ
  assert.throws(
    () =>
      validateDeliveryInspectionRoles({
        ...validPayload,
        extraField: true,
      }),
    OrganizationValidationError,
  );
});

// ==========================================
// T3: PUT authorization check
// ==========================================
void test("T3: PUT bởi role khác BGH hoặc thiếu permission bị từ chối 403", async () => {
  const service = createOrganizationService();
  const payload = {
    roles: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" as const },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" as const },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" as const },
    ],
  };

  // Thiếu permission
  await assert.rejects(
    service.updateDeliveryInspectionRoles(payload, {
      ...bghPrincipal,
      permissions: [],
    }),
    isHttp(403),
  );

  // Role khác BGH
  await assert.rejects(
    service.updateDeliveryInspectionRoles(payload, kitchenPrincipal),
    isHttp(403),
  );

  // Không phải SCHOOL
  await assert.rejects(
    service.updateDeliveryInspectionRoles(payload, {
      ...bghPrincipal,
      orgType: "SYSTEM",
      schoolId: null,
    }),
    isHttp(403),
  );
});

// ==========================================
// Helper dựng mock delivery inspection
// ==========================================
function createInspectionFixture(options?: {
  schoolTiers?: Array<{
    tier: "PRIMARY" | "REQUIRED" | "OPTIONAL";
    roleCode: string;
  }>;
  deliverySnapshotTiers?: Array<{
    tier: "PRIMARY" | "REQUIRED" | "OPTIONAL";
    roleCode: string;
  }>;
  status?: string;
  approvals?: Array<{ roleCode: string; decision: "APPROVE" | "REJECT" }>;
}) {
  const deliveryId = uid(100);
  const now = new Date("2026-11-19T06:00:00Z");

  const defaultSchoolTiers = options?.schoolTiers ?? [
    { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
    { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
    { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
  ];

  let currentStatus = options?.status ?? "IN_TRANSIT";
  let arrivedAt: Date | null = currentStatus === "IN_TRANSIT" ? null : now;
  const approvals = [...(options?.approvals ?? [])];
  const snapshotTiers = options?.deliverySnapshotTiers
    ? [...options.deliverySnapshotTiers]
    : [];

  const roles = [
    { id: uid(21), code: ROLES.SCHOOL_KITCHEN_STAFF },
    { id: uid(31), code: ROLES.INGREDIENT_MANAGEMENT },
    { id: uid(41), code: ROLES.SCHOOL_NUTRITION_OFFICER },
    { id: uid(51), code: ROLES.PARENTS_COMMITTEE },
  ];

  const txMock = {
    schoolDeliveryInspectionRole: {
      findMany: () =>
        Promise.resolve(
          defaultSchoolTiers.map((r) => ({
            tier: r.tier,
            updatedAt: now,
            Role: { code: r.roleCode },
          })),
        ),
    },
    deliveryInspectionRole: {
      createMany: ({
        data,
      }: {
        data: { roleId: string; tier: "PRIMARY" | "REQUIRED" | "OPTIONAL" }[];
      }) => {
        for (const item of data) {
          const r = roles.find((role) => role.id === item.roleId);
          snapshotTiers.push({ roleCode: r?.code ?? "", tier: item.tier });
        }
        return Promise.resolve({ count: data.length });
      },
      findMany: () => Promise.resolve([]),
    },
    role: {
      findMany: ({ where }: { where: { code: { in: string[] } } }) =>
        Promise.resolve(roles.filter((r) => where.code.in.includes(r.code))),
    },
    user: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const u = [
          bghPrincipal,
          kitchenPrincipal,
          warehousePrincipal,
          nutritionPrincipal,
          parentsPrincipal,
        ].find((p) => p.id === where.id);
        return Promise.resolve(
          u
            ? {
                ...u,
                status: "ACTIVE",
                Role: {
                  code: u.role,
                  type: u.orgType,
                  rolePermissions: u.permissions.map((p) => ({
                    permission: { code: p, isActive: true },
                  })),
                },
                permissionDenials: [],
              }
            : null,
        );
      },
    },
    school: { findUnique: () => Promise.resolve({ status: "ACTIVE" }) },
    $queryRaw: () => Promise.resolve([]),
    ingredientEntry: { findMany: () => Promise.resolve([]) },
    delivery: {
      updateMany: ({
        data,
      }: {
        data: { status?: string; arrivedAt?: Date };
      }) => {
        if (data.status) currentStatus = data.status;
        if (data.arrivedAt) arrivedAt = data.arrivedAt;
        return Promise.resolve({ count: 1 });
      },
      update: ({ data }: { data: { status?: string } }) => {
        if (data.status) currentStatus = data.status;
        return Promise.resolve({});
      },
      findFirst: () => {
        const itemLots = [
          {
            id: uid(300),
            lotCode: "LOT1",
            qrToken: "QR1",
            receivedQuantity: new Prisma.Decimal("10"),
            availableQuantity: new Prisma.Decimal("0"),
            unit: "kg",
            status: "BLOCKED",
            manufactureDate: null,
            expiryDate: new Date("2027-01-01"),
            sourceFacilityId: uid(88),
            SourceFacility: { name: "Cơ sở A", supplierId: uid(90) },
          },
        ];
        return Promise.resolve({
          id: deliveryId,
          deliveryNo: "DEL-001",
          schoolId,
          supplierId: uid(90),
          supplyRequestId: uid(91),
          creationMode: "REQUEST",
          traceabilityVersion: 1,
          status: currentStatus,
          expectedArrivalAt: now,
          arrivedAt,
          receivedAt: currentStatus === "RECEIVED" ? now : null,
          vehiclePlate: "29A-12345",
          note: null,
          Supplier: { name: "Supplier A" },
          SupplyRequest: {
            requestNo: "SR-001",
            schoolId,
            supplierId: uid(90),
            status: "IN_PROGRESS",
            _count: {
              deliveries: approvals.filter((a) => a.decision === "REJECT")
                .length,
            },
          },
          inspectionRoles: snapshotTiers.map((s) => ({
            tier: s.tier,
            Role: { code: s.roleCode },
          })),
          deliveryApprovals: approvals.map((a, idx) => ({
            id: uid(200 + idx),
            roleId: roles.find((r) => r.code === a.roleCode)!.id,
            userId: uid(500 + idx),
            decision: a.decision,
            reason: a.decision === "REJECT" ? "Hỏng" : null,
            photoPublicId: null,
            photoHash: null,
            decidedAt: now,
            Role: {
              code: a.roleCode,
              name:
                ROLE_LABELS[a.roleCode as keyof typeof ROLE_LABELS] ??
                a.roleCode,
            },
            User: { fullName: a.roleCode },
          })),
          deliveryItems: [
            {
              id: uid(400),
              ingredientId: uid(401),
              ingredientEntryId: uid(402),
              supplyRequestItemId: uid(403),
              sourceFacilityId: uid(88),
              actualQuantity: new Prisma.Decimal("10"),
              unit: "kg",
              Ingredient: {
                name: "Thịt lợn",
                supplierId: uid(90),
                ingredientCategory: null,
              },
              IngredientEntry: {
                id: uid(402),
                schoolId,
                ingredientId: uid(401),
                status: "ACTIVE",
                handlingType: "DIRECT_USE",
              },
              SupplyRequestItem: {
                id: uid(403),
                supplyRequestId: uid(91),
                ingredientEntryId: uid(402),
                requestedQuantity: new Prisma.Decimal("10"),
                unit: "kg",
                IngredientEntry: {
                  id: uid(402),
                  schoolId,
                  ingredientId: uid(401),
                  status: "ACTIVE",
                  handlingType: "DIRECT_USE",
                  Ingredient: {
                    name: "Thịt lợn",
                    supplierId: uid(90),
                    ingredientCategory: null,
                  },
                },
              },
              ingredientLots: itemLots,
            },
          ],
        });
      },
      count: () => Promise.resolve(currentStatus === "REJECTED" ? 1 : 0),
    },
    deliveryApproval: {
      create: ({
        data,
      }: {
        data: { roleId: string; decision: "APPROVE" | "REJECT" };
      }) => {
        const r = roles.find((role) => role.id === data.roleId);
        approvals.push({ roleCode: r?.code ?? "", decision: data.decision });
        return Promise.resolve({});
      },
    },
    ingredientLot: {
      updateMany: () => Promise.resolve({ count: 1 }),
      count: () => Promise.resolve(0),
    },
    inventoryTransaction: {
      create: () => Promise.resolve({}),
      count: () => Promise.resolve(0),
    },
    supplyRequest: {
      update: () => Promise.resolve({}),
    },
    deliveryItem: {
      findMany: () => Promise.resolve([]),
      update: () => Promise.resolve({}),
    },
    supplyRequestItem: {
      findMany: () =>
        Promise.resolve([
          {
            id: uid(403),
            supplyRequestId: uid(91),
            ingredientEntryId: uid(402),
            requestedQuantity: new Prisma.Decimal("10"),
            unit: "kg",
            IngredientEntry: {
              id: uid(402),
              ingredientId: uid(401),
              schoolId,
              status: "ACTIVE",
              Ingredient: { supplierId: uid(90) },
            },
          },
        ]),
    },
    blockchainProof: {
      count: () => Promise.resolve(0),
      findFirst: () => Promise.resolve(null),
      create: () => Promise.resolve({ id: uid(99) }),
    },
  };

  const clientMock = {
    ...txMock,
    $transaction: (fn: (tx: unknown) => unknown) => fn(txMock),
  };

  const mockProofs = {
    prepareDeliveryInspected: () => Promise.resolve(null),
    scheduleAnchor: () => {},
  };

  const service = createDeliveryInspectionService(
    () => Promise.resolve(clientMock as never),
    () => now,
    mockProofs,
  );

  return {
    deliveryId,
    service,
    getStatus: () => currentStatus,
    getSnapshotTiers: () => snapshotTiers,
  };
}

// ==========================================
// T4: Arrival bởi role REQUIRED/OPTIONAL -> 403
// ==========================================
void test("T4: Arrival bởi role REQUIRED/OPTIONAL bị từ chối 403", async () => {
  const f = createInspectionFixture();

  // Kho là REQUIRED -> bị chặn
  await assert.rejects(
    f.service.arrive(f.deliveryId, {}, {}, warehousePrincipal),
    (err: unknown) => {
      assert(err instanceof HttpError);
      assert.equal(err.statusCode, 403);
      assert.match(
        err.message,
        /Chỉ người duyệt chính.*được xác nhận xe đã đến/,
      );
      return true;
    },
  );

  // Phụ huynh là OPTIONAL -> bị chặn
  await assert.rejects(
    f.service.arrive(f.deliveryId, {}, {}, parentsPrincipal),
    isHttp(403),
  );
});

// ==========================================
// T5: Arrival bởi PRIMARY -> ARRIVED + 4 snapshot
// ==========================================
void test("T5: Arrival bởi PRIMARY -> ARRIVED và tạo 4 dòng snapshot", async () => {
  const f = createInspectionFixture();

  // Bếp là PRIMARY -> thành công
  const result = await f.service.arrive(f.deliveryId, {}, {}, kitchenPrincipal);

  assert.equal(result.status, "ARRIVED");
  assert.equal(f.getStatus(), "ARRIVED");
  assert.equal(f.getSnapshotTiers().length, 4);

  const snapshotTiers = f.getSnapshotTiers();
  assert(
    snapshotTiers.some(
      (s) => s.roleCode === ROLES.SCHOOL_KITCHEN_STAFF && s.tier === "PRIMARY",
    ),
  );
  assert(
    snapshotTiers.some(
      (s) =>
        s.roleCode === ROLES.INGREDIENT_MANAGEMENT && s.tier === "REQUIRED",
    ),
  );
  assert(
    snapshotTiers.some(
      (s) =>
        s.roleCode === ROLES.SCHOOL_NUTRITION_OFFICER && s.tier === "REQUIRED",
    ),
  );
  assert(
    snapshotTiers.some(
      (s) => s.roleCode === ROLES.PARENTS_COMMITTEE && s.tier === "OPTIONAL",
    ),
  );
});

// ==========================================
// T6: Duyệt trước khi xe đến -> 409
// ==========================================
void test("T6: Duyệt trước khi xe đến bị từ chối 409", async () => {
  const f = createInspectionFixture({ status: "IN_TRANSIT" });

  await assert.rejects(
    f.service.decide(f.deliveryId, approveDecision, kitchenPrincipal),
    isHttp(409),
  );
});

// ==========================================
// T7: PRIMARY + mọi REQUIRED APPROVE -> RECEIVED (PH chưa ký)
// ==========================================
void test("T7: PRIMARY + mọi REQUIRED APPROVE -> RECEIVED dù Phụ huynh chưa ký", async () => {
  const f = createInspectionFixture({
    status: "ARRIVED",
    deliverySnapshotTiers: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
      { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
    ],
  });

  // Bếp APPROVE -> PENDING_APPROVAL
  const r1 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    kitchenPrincipal,
  );
  assert.equal(r1.status, "PENDING_APPROVAL");

  // Kho APPROVE -> PENDING_APPROVAL
  const r2 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    warehousePrincipal,
  );
  assert.equal(r2.status, "PENDING_APPROVAL");

  // Dinh dưỡng APPROVE -> Hoàn thành! (Phụ huynh chưa ký)
  const r3 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    nutritionPrincipal,
  );
  assert.equal(r3.status, "RECEIVED");
  assert.equal(f.getStatus(), "RECEIVED");
});

// ==========================================
// T8: Nhóm 2 rỗng: chỉ PRIMARY APPROVE -> RECEIVED
// ==========================================
void test("T8: Nhóm 2 rỗng, chỉ PRIMARY APPROVE là chuyển RECEIVED ngay", async () => {
  const f = createInspectionFixture({
    status: "ARRIVED",
    deliverySnapshotTiers: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "OPTIONAL" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "OPTIONAL" },
      { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
    ],
  });

  // Chỉ Bếp duyệt APPROVE -> Đủ điều kiện RECEIVED ngay lập tức!
  const res = await f.service.decide(
    f.deliveryId,
    approveDecision,
    kitchenPrincipal,
  );
  assert.equal(res.status, "RECEIVED");
  assert.equal(f.getStatus(), "RECEIVED");
});

// ==========================================
// T9: PH REJECT khi đang PENDING_APPROVAL -> giữ nguyên status, không tăng cap3
// ==========================================
void test("T9: Phụ huynh REJECT khi PENDING_APPROVAL không làm hỏng đợt giao", async () => {
  const f = createInspectionFixture({
    status: "PENDING_APPROVAL",
    deliverySnapshotTiers: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
      { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
    ],
    approvals: [{ roleCode: ROLES.SCHOOL_KITCHEN_STAFF, decision: "APPROVE" }],
  });

  // Phụ huynh REJECT
  const res = await f.service.decide(
    f.deliveryId,
    { decision: "REJECT", reason: "Phụ huynh thấy rau héo" },
    parentsPrincipal,
  );

  // Status vẫn giữ PENDING_APPROVAL, không bị đổi thành REJECTED
  assert.equal(res.status, "PENDING_APPROVAL");
  assert.equal(f.getStatus(), "PENDING_APPROVAL");

  // Các bộ phận khác (Kho, Dinh dưỡng) vẫn tiếp tục duyệt được
  const resKho = await f.service.decide(
    f.deliveryId,
    approveDecision,
    warehousePrincipal,
  );
  assert.equal(resKho.status, "PENDING_APPROVAL");

  const resDD = await f.service.decide(
    f.deliveryId,
    approveDecision,
    nutritionPrincipal,
  );
  assert.equal(resDD.status, "RECEIVED");
});

// ==========================================
// T10: REQUIRED REJECT -> REJECTED
// ==========================================
void test("T10: Role REQUIRED REJECT chuyển status thành REJECTED", async () => {
  const f = createInspectionFixture({
    status: "PENDING_APPROVAL",
    deliverySnapshotTiers: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
      { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
    ],
    approvals: [{ roleCode: ROLES.SCHOOL_KITCHEN_STAFF, decision: "APPROVE" }],
  });

  // Kho (REQUIRED) REJECT -> đợt giao bị REJECTED
  const res = await f.service.decide(
    f.deliveryId,
    { decision: "REJECT", reason: "Thịt ôi thiu" },
    warehousePrincipal,
  );

  assert.equal(res.status, "REJECTED");
  assert.equal(f.getStatus(), "REJECTED");
});

// ==========================================
// T11: PH ký sau khi RECEIVED -> 409
// ==========================================
void test("T11: Phụ huynh ký sau khi đợt giao đã RECEIVED bị từ chối 409", async () => {
  const f = createInspectionFixture({
    status: "RECEIVED",
    deliverySnapshotTiers: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
      { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
    ],
    approvals: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, decision: "APPROVE" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, decision: "APPROVE" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, decision: "APPROVE" },
    ],
  });

  await assert.rejects(
    f.service.decide(f.deliveryId, approveDecision, parentsPrincipal),
    isHttp(409),
  );
});

// ==========================================
// T12: BGH đổi cấu hình sau khi xe đến -> đợt cũ giữ snapshot
// ==========================================
void test("T12: BGH đổi cấu hình sau khi xe đến, đợt đang kiểm giữ snapshot", async () => {
  // Đợt xe đến có snapshot: Bếp là PRIMARY, Kho là REQUIRED
  const f = createInspectionFixture({
    status: "ARRIVED",
    schoolTiers: [
      // Giả lập cấu hình trường mới được đổi: Kho thành PRIMARY, Bếp thành REQUIRED
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "PRIMARY" },
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
    ],
    deliverySnapshotTiers: [
      // Snapshot của đợt này lúc xe đến: Bếp là PRIMARY, Kho là REQUIRED
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
      { roleCode: ROLES.PARENTS_COMMITTEE, tier: "OPTIONAL" },
    ],
  });

  const detail = await f.service.detail(f.deliveryId, kitchenPrincipal);
  // Bếp vẫn là PRIMARY của đợt này theo snapshot
  assert.equal(detail.currentTier, "PRIMARY");
  const kitchenRole = detail.requiredRoles.find(
    (r) => r.code === ROLES.SCHOOL_KITCHEN_STAFF,
  );
  assert.equal(kitchenRole?.tier, "PRIMARY");
});

// ==========================================
// T13: Đợt legacy không có snapshot -> cần đủ 4 role APPROVE
// ==========================================
void test("T13: Đợt legacy không snapshot cần đủ cả 4 role APPROVE mới hoàn tất", async () => {
  const f = createInspectionFixture({
    status: "ARRIVED",
    deliverySnapshotTiers: [], // Rỗng, không có snapshot
  });

  // Bếp APPROVE -> PENDING_APPROVAL
  const r1 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    kitchenPrincipal,
  );
  assert.equal(r1.status, "PENDING_APPROVAL");

  // Kho APPROVE -> PENDING_APPROVAL
  const r2 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    warehousePrincipal,
  );
  assert.equal(r2.status, "PENDING_APPROVAL");

  // Dinh dưỡng APPROVE -> Vẫn PENDING_APPROVAL (vì theo luật legacy cần đủ cả Phụ huynh)
  const r3 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    nutritionPrincipal,
  );
  assert.equal(r3.status, "PENDING_APPROVAL");

  // Phụ huynh APPROVE -> lúc này mới RECEIVED!
  const r4 = await f.service.decide(
    f.deliveryId,
    approveDecision,
    parentsPrincipal,
  );
  assert.equal(r4.status, "RECEIVED");
});

// ==========================================
// T14: Cô lập trường (Tenant isolation)
// ==========================================
void test("T14: Cô lập trường: BGH trường A không thao tác cấu hình trường B", async () => {
  let accessedSchoolId = "";
  const mockRepo = {
    findDeliveryInspectionRoles: (sId: string) => {
      accessedSchoolId = sId;
      return Promise.resolve([]);
    },
  } as unknown as OrganizationRepository;

  const service = createOrganizationService(mockRepo);
  await service.getDeliveryInspectionRoles(bghPrincipal);

  // Chỉ lấy schoolId từ AuthPrincipal của BGH trường A
  assert.equal(accessedSchoolId, schoolId);
  assert.notEqual(accessedSchoolId, schoolIdB);
});

// ==========================================
// T15: Response DTO fields (canConfirmArrival, canInspect, currentTier, approvalSummary)
// ==========================================
void test("T15: Response DTO tính đúng canConfirmArrival, canInspect, currentTier và approvalSummary", async () => {
  const f = createInspectionFixture({
    status: "IN_TRANSIT",
    schoolTiers: [
      { roleCode: ROLES.SCHOOL_KITCHEN_STAFF, tier: "PRIMARY" },
      { roleCode: ROLES.INGREDIENT_MANAGEMENT, tier: "REQUIRED" },
      { roleCode: ROLES.SCHOOL_NUTRITION_OFFICER, tier: "REQUIRED" },
    ],
  });

  // Khi IN_TRANSIT:
  // Bếp (PRIMARY) -> canConfirmArrival = true, canInspect = false (chưa đến)
  const kitchenDetail = await f.service.detail(f.deliveryId, kitchenPrincipal);
  assert.equal(kitchenDetail.canConfirmArrival, true);
  assert.equal(kitchenDetail.canInspect, false);
  assert.equal(kitchenDetail.currentTier, "PRIMARY");

  // Kho (REQUIRED) -> canConfirmArrival = false
  const warehouseDetail = await f.service.detail(
    f.deliveryId,
    warehousePrincipal,
  );
  assert.equal(warehouseDetail.canConfirmArrival, false);
  assert.equal(warehouseDetail.canInspect, false);
  assert.equal(warehouseDetail.currentTier, "REQUIRED");

  // Kiểm tra approvalSummary
  assert.deepEqual(kitchenDetail.approvalSummary, {
    requiredApproved: 0,
    requiredTotal: 3, // Bếp (PRIMARY) + Kho (REQUIRED) + DD (REQUIRED)
    optionalApproved: 0,
    optionalTotal: 1, // Phụ huynh (OPTIONAL)
  });
});
