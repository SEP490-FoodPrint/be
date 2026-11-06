import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import { HttpError } from "../src/utils/http-error";
import { withReadTransaction } from "../src/utils/read-transaction";
import { createClassService } from "../src/modules/class/class.service";
import { createClassRepository } from "../src/modules/class/class.repository";
import { createSchoolSupplierService } from "../src/modules/school-supplier/school-supplier.service";
import { createSchoolSupplierRepository } from "../src/modules/school-supplier/school-supplier.repository";
import { createUserService } from "../src/modules/user/user.service";
import { createUserRepository } from "../src/modules/user/user.repository";
import {
  validateClassListQuery,
  validateClassSchoolParams,
} from "../src/modules/class/class.validation";
const schoolId = "11111111-1111-4111-8111-111111111111";
const supplierId = "22222222-2222-4222-8222-222222222222";
const principal: AuthPrincipal = {
  id: "actor",
  username: "actor",
  fullName: "Actor",
  roleId: "role",
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: [],
};
const input = { params: { schoolId }, query: { page: 1, limit: 5 } };
const now = new Date("2026-11-07T00:00:00.000Z");
function runner(tx: unknown): typeof withReadTransaction {
  return (operation) => operation(tx as Prisma.TransactionClient);
}
void test("school child validation rejects unsupported filters and invalid params", () => {
  assert.deepEqual(validateClassListQuery({}), { page: 1, limit: 20 });
  for (const value of [
    { schoolId },
    { status: "ACTIVE" },
    { limit: ["5"] },
    { limit: "101" },
  ])
    assert.throws(() => validateClassListQuery(value));
  assert.throws(() => validateClassSchoolParams({ schoolId: "invalid" }));
});
void test("class permission is independent from school.manage, maps only allowed fields and nulls", async () => {
  const tx = {
    school: {
      findFirst: (args: unknown) => {
        assert.deepEqual(args, {
          where: { AND: [{ id: schoolId }, {}] },
          select: { id: true },
        });
        return Promise.resolve({ id: schoolId });
      },
    },
    class: {
      count: (args: unknown) => {
        assert.deepEqual(args, { where: { AND: [{}, { schoolId }] } });
        return Promise.resolve(6);
      },
      findMany: () =>
        Promise.resolve([
          {
            id: "class",
            schoolId,
            name: "Lớp",
            academicYear: null,
            registeredMealPortions: 12,
            status: "INACTIVE",
            createdAt: now,
            updatedAt: now,
            secret: "hidden",
          },
        ]),
    },
  };
  const service = createClassService(
    undefined,
    createClassRepository(),
    runner(tx),
  );
  const result = await service.getBySchool(input, {
    ...principal,
    permissions: ["class.view"],
  });
  assert.deepEqual(result.pagination, {
    page: 1,
    limit: 5,
    total: 6,
    hasNext: true,
  });
  assert.equal(result.items[0].createdAt, now.toISOString());
  assert.equal(result.items[0].academicYear, null);
  assert.equal(result.items[0].registeredMealPortions, 12);
  assert(!("secret" in result.items[0]));
});
void test("missing class permission rejects before I/O; scoped missing parent returns 404", async () => {
  let io = 0;
  const service = createClassService(
    undefined,
    createClassRepository(),
    runner({
      school: {
        findFirst: () => {
          io++;
          return Promise.resolve(null);
        },
      },
    }),
  );
  await assert.rejects(
    () => service.getBySchool(input, principal),
    (e: unknown) => e instanceof HttpError && e.statusCode === 403,
  );
  assert.equal(io, 0);
  await assert.rejects(
    () =>
      service.getBySchool(input, {
        ...principal,
        orgType: "SCHOOL",
        schoolId: supplierId,
        permissions: ["class.view"],
      }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
  assert.equal(io, 1);
});
void test("supplier school relationships constrain parent and rows to own supplier, preserve UNLINKED", async () => {
  const scope = { supplierId };
  const tx = {
    school: {
      findFirst: (args: unknown) => {
        assert.deepEqual(args, {
          where: {
            AND: [
              { id: schoolId },
              { schoolSupplierRelationships: { some: { supplierId } } },
            ],
          },
          select: { id: true },
        });
        return Promise.resolve({ id: schoolId });
      },
    },
    schoolSupplierRelationship: {
      count: (args: unknown) => {
        assert.deepEqual(args, { where: { AND: [scope, { schoolId }] } });
        return Promise.resolve(1);
      },
      findMany: () =>
        Promise.resolve([
          {
            id: "link",
            schoolId,
            supplierId,
            status: "UNLINKED",
            linkedAt: now,
            unlinkedAt: now,
            suspendedAt: null,
            createdAt: now,
            updatedAt: now,
            Supplier: { name: "Supplier", status: "INACTIVE" },
          },
        ]),
    },
  };
  const service = createSchoolSupplierService(
    undefined,
    createSchoolSupplierRepository(),
    runner(tx),
  );
  const result = await service.getBySchool(input, {
    ...principal,
    orgType: "SUPPLIER",
    supplierId,
    permissions: ["supplier_relationship.view"],
  });
  assert.equal(result.items[0].status, "UNLINKED");
  assert.equal(result.items[0].supplierStatus, "INACTIVE");
  assert.equal(result.items[0].supplierName, "Supplier");
  assert.equal(result.pagination.total, 1);
});
void test("school account output includes role/email but excludes credentials; supplier account scope denied", async () => {
  const tx = {
    school: { findFirst: () => Promise.resolve({ id: schoolId }) },
    user: {
      count: () => Promise.resolve(1),
      findMany: () =>
        Promise.resolve([
          {
            id: "user",
            schoolId,
            fullName: "Name",
            email: "a@example.com",
            status: "LOCKED",
            Role: { code: "HOMEROOM_TEACHER", name: "Giáo viên" },
            passwordHash: "secret",
            createdAt: now,
            updatedAt: now,
          },
        ]),
    },
  };
  const service = createUserService(
    undefined,
    createUserRepository(),
    runner(tx),
  );
  const result = await service.getBySchool(input, {
    ...principal,
    permissions: ["user.manage"],
  });
  assert.deepEqual(result.items, [
    {
      id: "user",
      schoolId,
      fullName: "Name",
      email: "a@example.com",
      roleCode: "HOMEROOM_TEACHER",
      roleName: "Giáo viên",
      status: "LOCKED",
    },
  ]);
  await assert.rejects(
    () =>
      service.getBySchool(input, {
        ...principal,
        orgType: "SUPPLIER",
        supplierId,
        role: "INGREDIENT_SUPPLIER_ADMIN",
        permissions: ["supplier_staff.manage"],
      }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 403,
  );
});
void test("authorized empty school group returns total zero without treating it as missing parent", async () => {
  const tx = {
    school: { findFirst: () => Promise.resolve({ id: schoolId }) },
    class: {
      count: () => Promise.resolve(0),
      findMany: () => Promise.resolve([]),
    },
  };
  const result = await createClassService(
    undefined,
    createClassRepository(),
    runner(tx),
  ).getBySchool(input, { ...principal, permissions: ["class.view"] });
  assert.deepEqual(result, {
    items: [],
    pagination: { page: 1, limit: 5, total: 0, hasNext: false },
  });
});

void test("school staff cannot list school accounts even when granted management permission", async () => {
  let called = false;
  const service = createUserService(
    undefined,
    createUserRepository(),
    runner({
      school: {
        findFirst: () => {
          called = true;
          return Promise.resolve({ id: schoolId });
        },
      },
    }),
  );
  await assert.rejects(
    () =>
      service.getBySchool(input, {
        ...principal,
        orgType: "SCHOOL",
        schoolId,
        role: "HOMEROOM_TEACHER",
        permissions: ["school_user.manage"],
      }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  );
  assert.equal(called, false);
});

void test("school class selector cannot override trusted parent or child ownership scope", async () => {
  const ownSchoolId = supplierId;
  const tx = {
    school: {
      findFirst: (args: unknown) => {
        assert.deepEqual(args, {
          where: { AND: [{ id: schoolId }, { id: ownSchoolId }] },
          select: { id: true },
        });
        return Promise.resolve(null);
      },
    },
    class: {
      count: () => {
        throw new Error("must not read child count when parent outside scope");
      },
    },
  };
  const service = createClassService(
    undefined,
    createClassRepository(),
    runner(tx),
  );
  await assert.rejects(
    () =>
      service.getBySchool(input, {
        ...principal,
        orgType: "SCHOOL",
        schoolId: ownSchoolId,
        permissions: ["class.view"],
      }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
});
