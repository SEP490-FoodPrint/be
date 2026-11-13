import {
  createBarrier,
  disposableLifecycleTarget,
} from "./helpers/account-lifecycle-database";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import {
  createIntakeAccessService,
  type IntakeOperation,
} from "../src/modules/account-lifecycle/intake-access.service";
import {
  createIntakeAccessRepository,
  type IntakeAccessRepository,
  type ParentLocks,
} from "../src/modules/account-lifecycle/intake-access.repository";
import { testStaff, testAdmin } from "./helpers/authorization";
import type { AuthPrincipal } from "../src/types/auth";

const tx = {} as Prisma.TransactionClient;
const schoolId = "00000000-0000-4000-8000-000000000004";
const supplierId = "00000000-0000-4000-8000-000000000005";
const orderId = "00000000-0000-4000-8000-000000000006";
const schoolActor: AuthPrincipal = {
  ...testStaff,
  permissions: ["supply_request.create"],
};
const supplierActor: AuthPrincipal = {
  ...testStaff,
  role: "INGREDIENT_SUPPLIER_STAFF",
  orgType: "SUPPLIER",
  schoolId: null,
  supplierId,
  permissions: ["supply_request.accept"],
};

void test("forwarding binds a live eligible officer and rejects ownership or mapping changes after locking", async () => {
  const actor = {
    ...schoolActor,
    permissions: ["food_safety_incident.forward"],
  };
  const base = fixture(actor);
  let unit = "unit-1";
  let locked = false;
  let changeUnit = false;
  let incidentSchool = schoolId;
  let officerStatus: "ACTIVE" | "DEACTIVATED" = "ACTIVE";
  const guard = createIntakeAccessService(
    {
      ...base.repo,
      lockParents: (actual) => {
        assert.equal(actual, tx);
        locked = true;
        return Promise.resolve();
      },
      readIncident: () =>
        Promise.resolve({ id: "incident-1", schoolId: incidentSchool }),
      readOfficer: (actual) => {
        assert.equal(actual, tx);
        if (locked && changeUnit) unit = "unit-2";
        return Promise.resolve({
          id: "officer-1",
          status: officerStatus,
          roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
          communeFoodSafetyUnitId: unit,
          intakeState: "ACTIVE",
          Role: { type: "AUTHORITY" },
        });
      },
    },
    () => Promise.resolve(actor),
  );
  assert.deepEqual(
    await guard.assertOfficerForwarding(tx, actor, "incident-1", "officer-1"),
    {
      actor,
      recipientUserId: "officer-1",
      recipientCommuneFoodSafetyUnitId: "unit-1",
    },
  );
  incidentSchool = "another-school";
  await assert.rejects(
    () => guard.assertOfficerForwarding(tx, actor, "incident-1", "officer-1"),
    /Không tìm thấy sự cố/,
  );
  incidentSchool = schoolId;
  officerStatus = "DEACTIVATED";
  await assert.rejects(
    () => guard.assertOfficerForwarding(tx, actor, "incident-1", "officer-1"),
    /không hoạt động/,
  );
  officerStatus = "ACTIVE";
  locked = false;
  changeUnit = true;
  await assert.rejects(
    () => guard.assertOfficerForwarding(tx, actor, "incident-1", "officer-1"),
    /đã thay đổi/,
  );
});

void test("officer reassignment requires no remaining reports and rechecks the actor permission under lock", async () => {
  const base = fixture(testAdmin);
  let locked = false;
  let revoke = false;
  const repo: IntakeAccessRepository = {
    ...base.repo,
    lockParents: () => {
      locked = true;
      return Promise.resolve();
    },
    readOfficer: () =>
      Promise.resolve({
        id: "officer",
        status: "ACTIVE",
        roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
        communeFoodSafetyUnitId: "unit",
        intakeState: "ACTIVE",
        Role: { type: "AUTHORITY" },
      }),
    hasOpenReports: (actual, officerId, unitId) => {
      assert.equal(actual, tx);
      assert.equal(officerId, "officer");
      assert.equal(unitId, "unit");
      return Promise.resolve(false);
    },
  };
  const guard = createIntakeAccessService(repo, () =>
    Promise.resolve(
      locked && revoke ? { ...testAdmin, permissions: [] } : testAdmin,
    ),
  );
  assert.equal(
    await guard.assertOfficerReassignment(tx, testAdmin, "officer"),
    testAdmin,
  );
  locked = false;
  revoke = true;
  await assert.rejects(
    () => guard.assertOfficerReassignment(tx, testAdmin, "officer"),
    /quyền/,
  );
});

function fixture(actor: AuthPrincipal = schoolActor) {
  const calls: string[] = [];
  let order: NonNullable<
    Awaited<ReturnType<IntakeAccessRepository["readOrder"]>>
  > = { id: orderId, schoolId, supplierId, status: "SENT" };
  let adminStatus: "ACTIVE" | "DEACTIVATED" = "ACTIVE";
  let schoolState: "ACTIVE" | "PAUSED" = "ACTIVE";
  const repo = {
    lockParents(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      calls.push("parents");
      return Promise.resolve();
    },
    lockOrder(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      calls.push("order");
      return Promise.resolve();
    },
    lockForwarding(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      calls.push("report");
      return Promise.resolve();
    },
    lockIncident(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve();
    },
    readOrder(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve(order);
    },
    readSchool(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve({
        status: "ACTIVE" as const,
        intakeState: schoolState,
      });
    },
    readSupplier(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve({
        status: "ACTIVE" as const,
        intakeState: "ACTIVE" as const,
      });
    },
    readSchoolAdmin(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve({ status: adminStatus });
    },
    readSupplierAdmin(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve({ status: "ACTIVE" as const });
    },
    readOfficer(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve(null);
    },
    readIncident(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve(null);
    },
    readMember(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve(null);
    },
    readForwarding(actual: Prisma.TransactionClient) {
      assert.equal(actual, tx);
      return Promise.resolve(null);
    },
    hasOngoingOrders() {
      return Promise.resolve(false);
    },
    hasOpenReports() {
      return Promise.resolve(false);
    },
  } satisfies IntakeAccessRepository;
  const service = createIntakeAccessService(repo, (id, actual) => {
    assert.equal(id, actor.id);
    assert.equal(actual, tx);
    calls.push("identity");
    return Promise.resolve(actor);
  });
  return {
    service,
    calls,
    repo,
    setOrderStatus(status: "SENT" | "ACCEPTED" | "IN_PROGRESS") {
      order = { ...order, status };
    },
    deactivateSchoolAdmin() {
      adminStatus = "DEACTIVATED";
    },
    pauseSchool() {
      schoolState = "PAUSED";
    },
    changeOrder() {
      order = { ...order, schoolId: "another-school" };
    },
  };
}

void test("school order creation uses trusted identity and the same transaction", async () => {
  const f = fixture();
  await f.service.assertAccess(tx, schoolActor, {
    operation: "SCHOOL_CREATE_ORDER",
    supplierId,
  });
  assert.deepEqual(f.calls, ["identity", "parents", "identity"]);
});

void test("paused school is rejected without bypassing live authorization", async () => {
  const f = fixture();
  f.pauseSchool();
  await assert.rejects(
    f.service.assertAccess(tx, schoolActor, {
      operation: "SCHOOL_CREATE_ORDER",
      supplierId,
    }),
    /tạm dừng/i,
  );
});

void test("supplier accepting an order locks parents before the order", async () => {
  const f = fixture(supplierActor);
  await f.service.assertAccess(tx, supplierActor, {
    operation: "SUPPLIER_ACCEPT_ORDER",
    orderId,
  });
  assert.deepEqual(f.calls, ["identity", "parents", "order", "identity"]);
});

void test("order outside the trusted school scope is rejected", async () => {
  const f = fixture();
  f.changeOrder();
  await assert.rejects(
    f.service.assertAccess(tx, schoolActor, {
      operation: "SCHOOL_SEND_ORDER",
      orderId,
    }),
    /không tìm thấy/i,
  );
});

void test("unknown and future operations fail closed", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.assertAccess(tx, schoolActor, {
      operation: "START_ORDER_PROCESSING",
      orderId,
    }),
    /chưa hỗ trợ/i,
  );
  await assert.rejects(
    f.service.assertAccess(tx, schoolActor, {
      operation: "UNKNOWN",
    } as unknown as IntakeOperation),
    /chưa hỗ trợ/i,
  );
});

void test("repository locks school, supplier, then sorted unique users", async () => {
  const values: string[] = [];
  const client = {
    $queryRaw: (_strings: TemplateStringsArray, value: string) => {
      values.push(value);
      return Promise.resolve([]);
    },
  } as unknown as Prisma.TransactionClient;
  await createIntakeAccessRepository().lockParents(client, {
    schoolId,
    supplierId,
    userIds: ["user-b", "user-a", "user-b"],
  });
  assert.deepEqual(values, [schoolId, supplierId, "user-a", "user-b"]);
});

void test("permission revoked after locking fails closed", async () => {
  const f = fixture();
  let calls = 0;
  const service = createIntakeAccessService(f.repo, (_id, actual) => {
    assert.equal(actual, tx);
    calls += 1;
    return Promise.resolve(
      calls === 1 ? schoolActor : { ...schoolActor, permissions: [] },
    );
  });
  await assert.rejects(
    service.assertAccess(tx, schoolActor, {
      operation: "SCHOOL_CREATE_ORDER",
      supplierId,
    }),
    /không có quyền/i,
  );
});

void test("supplier paused for inspection cannot accept a new order", async () => {
  const f = fixture(supplierActor);
  const repo: IntakeAccessRepository = {
    ...f.repo,
    readSupplier: () =>
      Promise.resolve({
        status: "ACTIVE",
        intakeState: "PAUSED_FOR_FOOD_SAFETY_INSPECTION",
      }),
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(supplierActor),
  );
  await assert.rejects(
    service.assertAccess(tx, supplierActor, {
      operation: "SUPPLIER_ACCEPT_ORDER",
      orderId,
    }),
    /tạm dừng/i,
  );
});

void test("paused officer cannot receive a new report but can re-read its receipt", async () => {
  const officer: AuthPrincipal = {
    ...testStaff,
    role: "COMMUNE_FOOD_SAFETY_OFFICER",
    orgType: "AUTHORITY",
    schoolId: null,
    communeFoodSafetyUnitId: "unit-1",
    permissions: ["food_safety_report.receive"],
  };
  const f = fixture(officer);
  let receivedAt: Date | null = null;
  const repo: IntakeAccessRepository = {
    ...f.repo,
    readOfficer: () =>
      Promise.resolve({
        id: officer.id,
        status: "ACTIVE",
        intakeState: "PAUSED",
        roleCode: officer.role,
        communeFoodSafetyUnitId: "unit-1",
        Role: { type: "AUTHORITY" },
      }),
    readForwarding: () =>
      Promise.resolve({
        id: "report-1",
        incidentId: "incident-1",
        recipientUserId: officer.id,
        recipientCommuneFoodSafetyUnitId: "unit-1",
        receivedAt,
        FoodSafetyIncident: { status: "OPEN" },
      }),
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(officer),
  );
  const command = {
    operation: "OFFICER_RECEIVE_REQUEST" as const,
    forwardingId: "report-1",
  };
  await assert.rejects(service.assertAccess(tx, officer, command), /tạm dừng/i);
  receivedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(
    (await service.assertAccess(tx, officer, command)).id,
    officer.id,
  );
});

void test("disposable database helper rejects unsafe targets before connecting", () => {
  assert.throws(() =>
    disposableLifecycleTarget(
      "postgresql://x@server.postgres.database.azure.com/foodprint_migration_test",
    ),
  );
  assert.throws(() =>
    disposableLifecycleTarget("postgresql://x@localhost/foodprint"),
  );
  assert.throws(() =>
    disposableLifecycleTarget(
      "postgresql://x@localhost/foodprint_migration_test?host=remote",
    ),
  );
  assert.equal(
    disposableLifecycleTarget(
      "postgresql://x@localhost/foodprint_migration_test_case",
    ).hostname,
    "localhost",
  );
});

void test("barrier releases participants only after both arrive", async () => {
  const barrier = createBarrier(2);
  let released = false;
  const first = barrier.wait().then(() => {
    released = true;
  });
  await Promise.resolve();
  assert.equal(released, false);
  await Promise.all([first, barrier.wait()]);
  assert.equal(released, true);
  await assert.rejects(barrier.wait(), /đã được sử dụng hết/);
});

void test("accepted work can continue while the school is paused with its own permission", async () => {
  const f = fixture();
  f.setOrderStatus("ACCEPTED");
  f.pauseSchool();
  await f.service.assertAccess(tx, schoolActor, {
    operation: "START_ORDER_PROCESSING",
    orderId,
    requiredPermission: "supply_request.create",
  });
  await f.service.assertAccess(tx, schoolActor, {
    operation: "CONTINUE_ACCEPTED_WORK",
    orderId,
    requiredPermission: "supply_request.create",
  });
});

void test("starting accepted work fails when an admin is deactivated or the required permission is absent", async () => {
  const f = fixture();
  f.setOrderStatus("ACCEPTED");
  f.deactivateSchoolAdmin();
  await assert.rejects(
    f.service.assertAccess(tx, schoolActor, {
      operation: "START_ORDER_PROCESSING",
      orderId,
      requiredPermission: "supply_request.create",
    }),
    /vô hiệu hóa/i,
  );
  const other = fixture();
  other.setOrderStatus("ACCEPTED");
  await assert.rejects(
    other.service.assertAccess(tx, schoolActor, {
      operation: "CONTINUE_ACCEPTED_WORK",
      orderId,
      requiredPermission: "delivery.receive",
    }),
    /quyền/i,
  );
});

void test("membership guard rejects adding an active member under a deactivated admin", async () => {
  const manager: AuthPrincipal = {
    ...schoolActor,
    role: "SCHOOL_ADMINISTRATION",
    permissions: ["school_user.manage"],
  };
  const f = fixture(manager);
  f.deactivateSchoolAdmin();
  await assert.rejects(
    f.service.assertMembershipEligibility(
      tx,
      manager,
      { kind: "SCHOOL", id: schoolId },
      "ACTIVE",
    ),
    /vô hiệu hóa/i,
  );
});

void test("membership guard cannot authorize another organization's manager", async () => {
  const manager: AuthPrincipal = {
    ...schoolActor,
    role: "SCHOOL_ADMINISTRATION",
    permissions: ["school_user.manage"],
  };
  const f = fixture(manager);
  await assert.rejects(
    f.service.assertMembershipEligibility(
      tx,
      manager,
      { kind: "SCHOOL", id: "different-school" },
      "ACTIVE",
    ),
    /phạm vi/i,
  );
});

void test("membership transfer locks both old and new organizations before rechecking", async () => {
  const manager = testAdmin;
  const f = fixture(manager);
  let locked: ParentLocks | undefined;
  const member = {
    id: "member-1",
    roleCode: "SCHOOL_KITCHEN_STAFF",
    status: "ACTIVE" as const,
    schoolId: "old-school",
    supplierId: null,
    communeFoodSafetyUnitId: null,
  };
  const repo: IntakeAccessRepository = {
    ...f.repo,
    readMember: () => Promise.resolve(member),
    lockParents: (actual, scope) => {
      assert.equal(actual, tx);
      locked = scope;
      return Promise.resolve();
    },
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(manager),
  );
  await service.assertMembershipEligibility(
    tx,
    manager,
    { kind: "SCHOOL", id: schoolId },
    "ACTIVE",
    member.id,
  );
  assert.deepEqual(locked?.schoolIds, [schoolId, "old-school"]);
  assert.deepEqual(locked?.userIds, [manager.id, member.id]);
});

void test("organization manager cannot move a member from another organization", async () => {
  const manager: AuthPrincipal = {
    ...schoolActor,
    role: "SCHOOL_ADMINISTRATION",
    permissions: ["school_user.manage"],
  };
  const f = fixture(manager);
  const repo: IntakeAccessRepository = {
    ...f.repo,
    readMember: () =>
      Promise.resolve({
        id: "member-1",
        roleCode: "SCHOOL_KITCHEN_STAFF",
        status: "ACTIVE",
        schoolId: "other-school",
        supplierId: null,
        communeFoodSafetyUnitId: null,
      }),
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(manager),
  );
  await assert.rejects(
    service.assertMembershipEligibility(
      tx,
      manager,
      { kind: "SCHOOL", id: schoolId },
      "ACTIVE",
      "member-1",
    ),
    /phạm vi/i,
  );
});

void test("membership guard rejects a member whose organization changes while locking", async () => {
  const manager: AuthPrincipal = {
    ...schoolActor,
    role: "SCHOOL_ADMINISTRATION",
    permissions: ["school_user.manage"],
  };
  const f = fixture(manager);
  let reads = 0;
  const repo: IntakeAccessRepository = {
    ...f.repo,
    readMember: () =>
      Promise.resolve({
        id: "member-1",
        roleCode: "SCHOOL_KITCHEN_STAFF",
        status: "ACTIVE",
        schoolId: ++reads === 1 ? schoolId : "different-school",
        supplierId: null,
        communeFoodSafetyUnitId: null,
      }),
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(manager),
  );
  await assert.rejects(
    service.assertMembershipEligibility(
      tx,
      manager,
      { kind: "SCHOOL", id: schoolId },
      "ACTIVE",
      "member-1",
    ),
    /đã thay đổi/i,
  );
});

void test("an officer with unclosed reports cannot be reassigned", async () => {
  const f = fixture(testAdmin);
  const officerId = "officer-1";
  const repo = {
    ...f.repo,
    readOfficer: () =>
      Promise.resolve({
        id: officerId,
        roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
        status: "ACTIVE" as const,
        intakeState: "ACTIVE" as const,
        communeFoodSafetyUnitId: "unit-1",
        Role: { type: "AUTHORITY" as const },
      }),
    hasOpenReports: () => Promise.resolve(true),
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(testAdmin),
  );
  await assert.rejects(
    service.assertOfficerReassignment(tx, testAdmin, officerId),
    /chưa CLOSED/i,
  );
});

void test("a school cannot forward a new request to a paused officer", async () => {
  const forwarder: AuthPrincipal = {
    ...schoolActor,
    permissions: ["food_safety_incident.forward"],
  };
  const f = fixture(forwarder);
  const repo = {
    ...f.repo,
    readIncident: () => Promise.resolve({ id: "incident-1", schoolId }),
    lockIncident: () => Promise.resolve(),
    readOfficer: () =>
      Promise.resolve({
        id: "officer-1",
        roleCode: "COMMUNE_FOOD_SAFETY_OFFICER",
        status: "ACTIVE" as const,
        intakeState: "PAUSED" as const,
        communeFoodSafetyUnitId: "unit-1",
        Role: { type: "AUTHORITY" as const },
      }),
  };
  const service = createIntakeAccessService(repo, () =>
    Promise.resolve(forwarder),
  );
  await assert.rejects(
    service.assertOfficerForwarding(tx, forwarder, "incident-1", "officer-1"),
    /tạm dừng/i,
  );
});

void test("order blockers select only IN_PROGRESS in the trusted organization across partners", async () => {
  const repository = createIntakeAccessRepository();
  for (const kind of ["schoolId", "supplierId"] as const) {
    for (const status of [
      "DRAFT",
      "SENT",
      "ACCEPTED",
      "IN_PROGRESS",
      "COMPLETED",
      "CANCELLED",
    ]) {
      let queries = 0;
      const client = {
        supplyRequest: {
          findFirst: (query: {
            where: { status: string; schoolId?: string; supplierId?: string };
            select: unknown;
          }) => {
            queries++;
            assert.deepEqual(query, {
              where: { [kind]: "target", status: "IN_PROGRESS" },
              select: { id: true },
            });
            const orders = [
              { id: "outside", owner: "other", status: "IN_PROGRESS" },
              { id: "first-partner", owner: "target", status },
              { id: "second-partner", owner: "target", status },
            ];
            return Promise.resolve(
              orders.find(
                (row) =>
                  row.owner === query.where[kind] &&
                  row.status === query.where.status,
              ) ?? null,
            );
          },
        },
      } as unknown as Prisma.TransactionClient;
      assert.equal(
        await repository.hasOngoingOrders(client, { [kind]: "target" } as
          { schoolId: string } | { supplierId: string }),
        status === "IN_PROGRESS",
      );
      assert.equal(
        queries,
        1,
        "one existence query regardless of partner count and delivery state",
      );
    }
  }
  const failed = {
    supplyRequest: {
      findFirst: () => Promise.reject(new Error("query failed")),
    },
  } as unknown as Prisma.TransactionClient;
  await assert.rejects(
    () => repository.hasOngoingOrders(failed, { schoolId }),
    /query failed/,
  );
});

void test("officer blockers include legacy requests and every unclosed incident without filtering notification or receipt", async () => {
  const repository = createIntakeAccessRepository();
  const client = {
    foodSafetyReportForwarding: {
      findFirst: (query: unknown) => {
        assert.deepEqual(query, {
          where: {
            OR: [
              { recipientUserId: "officer" },
              {
                recipientUserId: null,
                recipientCommuneFoodSafetyUnitId: "unit",
              },
            ],
            FoodSafetyIncident: { status: { not: "CLOSED" } },
          },
          select: { id: true },
        });
        return Promise.resolve({ id: "unclosed-request" });
      },
    },
  } as unknown as Prisma.TransactionClient;
  assert.equal(
    await repository.hasOpenReports(client, "officer", "unit"),
    true,
  );
});
