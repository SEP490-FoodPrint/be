import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { createSupplierRepository } from "../src/modules/supplier/supplier.repository";
import { createSupplierService } from "../src/modules/supplier/supplier.service";
import { validateSupplierListQuery } from "../src/modules/supplier/supplier.validation";
import { validateOrganizationListQuery } from "../src/modules/organization/organization.validation";
import { testAdmin } from "./helpers/authorization";

void test("directory validation trims before length and rejects tenant overrides", () => {
  for (const validate of [
    validateSupplierListQuery,
    validateOrganizationListQuery,
  ]) {
    assert.equal(validate({ search: "   Hoa   " }).search, "Hoa");
    assert.equal(validate({ search: "   " }).search, undefined);
    assert.equal(
      validate({ search: `  ${"x".repeat(255)}  ` }).search?.length,
      255,
    );
    for (const value of [
      { schoolId: testAdmin.id },
      { status: "active" },
      { search: ["Hoa"] },
      { sortBy: "name" },
      { limit: "101" },
    ])
      assert.throws(() => validate(value));
  }
});

void test("supplier count and page use the identical scope/filter predicate and literal wildcard escaping", async () => {
  let countWhere: unknown;
  let findArgs: unknown;
  const tx = {
    supplier: {
      count: (args: Prisma.SupplierCountArgs) => {
        countWhere = args.where;
        return Promise.resolve(12);
      },
      findMany: (args: Prisma.SupplierFindManyArgs) => {
        findArgs = args;
        assert.deepEqual(args.where, countWhere);
        return Promise.resolve([]);
      },
    },
  } as unknown as Prisma.TransactionClient;
  const result = await createSupplierRepository().list(
    tx,
    { id: testAdmin.id },
    { page: 2, limit: 5, search: "a%_\\", status: "ACTIVE" },
  );
  assert.equal(result.total, 12);
  const args = findArgs as Prisma.SupplierFindManyArgs;
  assert.equal(args.skip, 5);
  assert.equal(args.take, 5);
  assert.deepEqual(args.where, {
    AND: [
      { id: testAdmin.id },
      { status: "ACTIVE" },
      {
        OR: [
          { name: { contains: "a\\%\\_\\\\", mode: "insensitive" } },
          { taxCode: { contains: "a\\%\\_\\\\", mode: "insensitive" } },
        ],
      },
    ],
  });
});

void test("supplier list maps safe DTO, retains nulls and derives total without exposing database fields", async () => {
  const now = new Date("2026-11-07T00:00:00Z");
  const tx = {
    supplier: {
      count: () => Promise.resolve(12),
      findMany: () =>
        Promise.resolve([
          {
            id: testAdmin.id,
            name: "A",
            taxCode: null,
            email: null,
            phone: null,
            address: null,
            status: "ACTIVE",
            createdAt: now,
            updatedAt: now,
            passwordHash: "secret",
          },
        ]),
    },
  } as unknown as Prisma.TransactionClient;
  const client = {
    $transaction: async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
      options: unknown,
    ) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead" });
      return callback(tx);
    },
  } as unknown as PrismaClient;
  const service = createSupplierService(undefined, () =>
    Promise.resolve(client),
  );
  const result = await service.getAll(
    { page: 1, limit: 5 },
    { ...testAdmin, permissions: ["supplier.view"] },
  );
  assert.equal(result.pagination.total, 12);
  assert.equal(result.pagination.hasNext, true);
  assert.equal(result.items[0]?.email, null);
  assert.equal(result.items[0]?.createdAt, now.toISOString());
  assert.ok(!Object.hasOwn(result.items[0], "passwordHash"));
  await assert.rejects(
    service.getAll({ page: 1, limit: 5 }, { ...testAdmin, permissions: [] }),
    { statusCode: 403 },
  );
  await assert.rejects(
    service.getSummary(
      {},
      {
        ...testAdmin,
        orgType: "SUPPLIER",
        role: "INGREDIENT_SUPPLIER_ADMIN",
        supplierId: testAdmin.id,
        permissions: ["supplier.view"],
      },
    ),
    { statusCode: 403 },
  );
});
