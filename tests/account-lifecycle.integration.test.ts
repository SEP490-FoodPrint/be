import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import express from "express";
import { test } from "node:test";
import { createLifecycleTestDatabase } from "./helpers/account-lifecycle-database";
import { getPrisma } from "../src/utils/database";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import {
  authorizationTransaction,
  loadPrincipal,
} from "../src/utils/authorization";
import { createAccountLifecycleService } from "../src/modules/account-lifecycle/account-lifecycle.service";
import { createAccountLifecycleRepository } from "../src/modules/account-lifecycle/account-lifecycle.repository";
import { createIntakeAccessService } from "../src/modules/account-lifecycle/intake-access.service";
import { createIntakeAccessRepository } from "../src/modules/account-lifecycle/intake-access.repository";
import { createSupplyOrderService } from "../src/modules/supply-order/supply-order.service";
import { createReportingService } from "../src/modules/reporting/reporting.service";
import { HttpError } from "../src/utils/http-error";
import { createSessionService } from "../src/modules/auth/session.service";
import { createPermissionService } from "../src/modules/permission/permission.service";
import { createAuthSessions } from "../src/utils/auth-sessions";
import { memorySessions } from "./helpers/auth-sessions";
import {
  createAuthenticate,
  createSessionAuthenticate,
} from "../src/middlewares/auth.middleware";
import { loadSessionUser } from "../src/utils/session-identity";
import { ACCESS_COOKIE } from "../src/utils/auth-cookies";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { startHttp } from "./helpers/http";

function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Hold the first transaction under its business locks until the second starts. */
async function overlap(
  first: (hold: () => Promise<void>) => Promise<unknown>,
  second: (started: () => void) => Promise<unknown>,
) {
  const held = latch();
  const release = latch();
  const started = latch();
  const settle = (
    promise: Promise<unknown>,
  ): Promise<PromiseSettledResult<unknown>> =>
    promise.then(
      (value) => ({ status: "fulfilled", value }),
      (reason: unknown) => ({ status: "rejected", reason }),
    );
  const firstOutcome = settle(
    first(async () => {
      held.resolve();
      await release.promise;
    }),
  );
  const endedBeforeBarrier = (result: PromiseSettledResult<unknown>) => {
    if (result.status === "rejected") throw result.reason as unknown;
    throw new Error("Giao dịch kết thúc trước barrier kiểm thử");
  };
  await Promise.race([held.promise, firstOutcome.then(endedBeforeBarrier)]);
  const secondOutcome = settle(second(started.resolve));
  let failure: unknown;
  try {
    await Promise.race([
      started.promise,
      secondOutcome.then(endedBeforeBarrier),
    ]);
  } catch (error) {
    failure = error;
  } finally {
    release.resolve();
  }
  const outcomes = await Promise.all([firstOutcome, secondOutcome]);
  if (failure instanceof Error) throw failure;
  if (failure) throw new Error("Barrier kiểm thử không hoàn tất");
  return outcomes;
}

function assertBlocked(result: PromiseSettledResult<unknown>) {
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    const error: unknown = result.reason;
    assert(error instanceof HttpError && [403, 409].includes(error.statusCode));
  }
}

void test("account lifecycle respects scope and intake state on disposable PostgreSQL", async (context) => {
  const base = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    base,
    "Set MIGRATION_TEST_DATABASE_URL to a disposable local PostgreSQL instance",
  );
  const temporary = await createLifecycleTestDatabase(base);
  const previousUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.JWT_SECRET;
  process.env.DATABASE_URL = temporary.url;
  process.env.JWT_SECRET = "foodprint-integration-test-only-secret";
  const db = await getPrisma().catch(async () => {
    await temporary.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    throw new Error("Không thể khởi tạo client cho database kiểm thử tạm");
  });
  context.after(async () => {
    await db.$disconnect();
    await temporary.cleanup();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  await bootstrapAuthorization(db);
  const passwordHash = await bcrypt.hash("Lifecycle-test-password", 4);
  const role = async (code: string) => {
    const found = await db.role.findUnique({
      where: { code },
      select: { id: true },
    });
    assert(found);
    return found.id;
  };
  const account = async (
    roleCode: string,
    name: string,
    scope: {
      schoolId?: string;
      supplierId?: string;
      communeFoodSafetyUnitId?: string;
    } = {},
  ) =>
    db.user.create({
      data: {
        username: name,
        email: `${name}@example.test`,
        passwordHash,
        fullName: name,
        roleId: await role(roleCode),
        roleCode,
        status: "ACTIVE",
        ...scope,
      },
      select: { id: true },
    });
  const school = await db.school.create({
    data: { name: "Lifecycle school" },
    select: { id: true },
  });
  const supplier = await db.supplier.create({
    data: { name: "Lifecycle supplier" },
    select: { id: true },
  });
  const otherSchool = await db.school.create({
    data: { name: "Other school" },
    select: { id: true },
  });
  const system = await account("SYSTEM_ADMIN", "lifecycle-system");
  const schoolAdmin = await account(
    "SCHOOL_ADMINISTRATION",
    "lifecycle-school-admin",
    { schoolId: school.id },
  );
  const schoolStaff = await account(
    "INGREDIENT_MANAGEMENT_DEPARTMENT",
    "lifecycle-school-staff",
    { schoolId: school.id },
  );
  const supplierAdmin = await account(
    "INGREDIENT_SUPPLIER_ADMIN",
    "lifecycle-supplier-admin",
    {
      supplierId: supplier.id,
    },
  );
  const supplierStaff = await account(
    "INGREDIENT_SUPPLIER_STAFF",
    "lifecycle-supplier-staff",
    { supplierId: supplier.id },
  );
  const otherStaff = await account(
    "SCHOOL_KITCHEN_STAFF",
    "lifecycle-other-staff",
    { schoolId: otherSchool.id },
  );
  const principal = await loadPrincipal(system.id, db);
  const schoolActor = await loadPrincipal(schoolStaff.id, db);
  const supplierActor = await loadPrincipal(supplierStaff.id, db);
  const lifecycle = createAccountLifecycleService();
  const guard = createIntakeAccessService();
  const supply = createSupplyOrderService();

  const schoolFixture = async (label: string) => {
    const organization = await db.school.create({ data: { name: label } });
    const admin = await account("SCHOOL_ADMINISTRATION", `${label}-admin`, {
      schoolId: organization.id,
    });
    const staff = await account(
      "INGREDIENT_MANAGEMENT_DEPARTMENT",
      `${label}-staff`,
      { schoolId: organization.id },
    );
    return {
      school: organization,
      admin,
      staff,
      actor: await loadPrincipal(staff.id, db),
    };
  };
  const officerFixture = async (label: string) => {
    const unit = await db.communeFoodSafetyUnit.create({
      data: { name: label, code: label },
    });
    const user = await account("COMMUNE_FOOD_SAFETY_OFFICER", label, {
      communeFoodSafetyUnitId: unit.id,
    });
    return { unit, user, actor: await loadPrincipal(user.id, db) };
  };
  const businessConflict = (error: unknown) =>
    error instanceof HttpError && error.statusCode === 409;
  const guardBarrier = (started: () => void) => {
    const repository = createIntakeAccessRepository();
    return createIntakeAccessService({
      ...repository,
      async lockParents(tx, scope) {
        started();
        await repository.lockParents(tx, scope);
      },
    });
  };
  const lifecycleBarrier = (
    hold: () => Promise<void> = () => Promise.resolve(),
    started: () => void = () => undefined,
  ) => {
    const repository = createAccountLifecycleRepository();
    return createAccountLifecycleService(
      {
        ...repository,
        async lockParents(tx, scope) {
          started();
          await repository.lockParents(tx, scope);
          await hold();
        },
      },
      {
        transaction: async (fn) => {
          const began = performance.now();
          let attempts = 0;
          try {
            return await authorizationTransaction(db, (tx) => {
              attempts++;
              return fn(tx);
            });
          } finally {
            context.diagnostic(
              `Lifecycle transaction: ${attempts} attempt(s), ${Math.round(performance.now() - began)} ms including the test barrier`,
            );
          }
        },
        loadActor: loadPrincipal,
      },
    );
  };

  await context.test(
    "IN_PROGRESS and cascade races preserve both serial orders",
    async (testContext) => {
      const began = performance.now();
      for (const processingFirst of [true, false]) {
        const fixture = await schoolFixture(`progress-${processingFirst}`);
        const order = await db.supplyRequest.create({
          data: {
            requestNo: `PROGRESS-${processingFirst}`,
            schoolId: fixture.school.id,
            supplierId: supplier.id,
            createdByUserId: fixture.staff.id,
            status: "ACCEPTED",
          },
        });
        const process = (
          hold: () => Promise<void>,
          started: () => void = () => undefined,
        ) =>
          authorizationTransaction(db, async (tx) => {
            await guardBarrier(started).assertAccess(tx, fixture.actor, {
              operation: "START_ORDER_PROCESSING",
              orderId: order.id,
              requiredPermission: "supply_request.create",
            });
            await hold();
            await tx.supplyRequest.update({
              where: { id: order.id },
              data: { status: "IN_PROGRESS" },
            });
          });
        const results = processingFirst
          ? await overlap(
              (hold) => process(hold),
              (started) =>
                lifecycleBarrier(undefined, started).deactivate(
                  { userId: fixture.admin.id },
                  principal,
                ),
            )
          : await overlap(
              (hold) =>
                lifecycleBarrier(hold).deactivate(
                  { userId: fixture.admin.id },
                  principal,
                ),
              (started) => process(() => Promise.resolve(), started),
            );
        assert.equal(results[0].status, "fulfilled");
        assertBlocked(results[1]);
        assert.equal(
          (
            await db.supplyRequest.findUniqueOrThrow({
              where: { id: order.id },
            })
          ).status,
          processingFirst ? "IN_PROGRESS" : "ACCEPTED",
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: fixture.admin.id } }))
            .status,
          processingFirst ? "ACTIVE" : "DEACTIVATED",
        );
      }
      testContext.diagnostic(
        `Two progress/cascade overlaps: ${Math.round(performance.now() - began)} ms`,
      );
    },
  );

  await context.test(
    "blocker queries have supporting organization/status and recipient indexes",
    async () => {
      const rows = await db.$queryRaw<
        { tablename: string; indexdef: string }[]
      >`SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'foodprint' AND tablename IN ('supply_requests', 'food_safety_report_forwardings')`;
      for (const column of ["school_id", "supplier_id"])
        assert(
          rows.some(
            (row) =>
              row.tablename === "supply_requests" &&
              row.indexdef.includes(`(${column}, status)`),
          ),
        );
      assert(
        rows.some(
          (row) =>
            row.tablename === "food_safety_report_forwardings" &&
            row.indexdef.includes("(recipient_user_id, incident_id)"),
        ),
      );
    },
  );

  await context.test(
    "member insert and transfer races cannot leave active members after cascade",
    async () => {
      const kitchenRole = await role("SCHOOL_KITCHEN_STAFF");
      for (const transfer of [true, false]) {
        for (const memberFirst of [true, false]) {
          const label = `member-${transfer}-${memberFirst}`;
          const fixture = await schoolFixture(label);
          const moving = transfer
            ? await account("SCHOOL_KITCHEN_STAFF", `${label}-moving`, {
                schoolId: otherSchool.id,
              })
            : null;
          const addMember = (
            hold: () => Promise<void>,
            started: () => void = () => undefined,
          ) =>
            authorizationTransaction(db, async (tx) => {
              await guardBarrier(started).assertMembershipEligibility(
                tx,
                principal,
                { kind: "SCHOOL", id: fixture.school.id },
                "ACTIVE",
                moving?.id,
              );
              await hold();
              if (moving)
                await tx.user.update({
                  where: { id: moving.id },
                  data: { schoolId: fixture.school.id },
                });
              else
                await tx.user.create({
                  data: {
                    username: `${label}-new`,
                    email: `${label}@example.test`,
                    fullName: label,
                    passwordHash,
                    roleId: kitchenRole,
                    roleCode: "SCHOOL_KITCHEN_STAFF",
                    schoolId: fixture.school.id,
                    status: "ACTIVE",
                  },
                });
            });
          const results = memberFirst
            ? await overlap(
                (hold) => addMember(hold),
                (started) =>
                  lifecycleBarrier(undefined, started).deactivate(
                    { userId: fixture.admin.id },
                    principal,
                  ),
              )
            : await overlap(
                (hold) =>
                  lifecycleBarrier(hold).deactivate(
                    { userId: fixture.admin.id },
                    principal,
                  ),
                (started) => addMember(() => Promise.resolve(), started),
              );
          assert.equal(results[0].status, "fulfilled");
          if (memberFirst) assert.equal(results[1].status, "fulfilled");
          else assertBlocked(results[1]);
          assert.equal(
            await db.user.count({
              where: {
                schoolId: fixture.school.id,
                status: { not: "DEACTIVATED" },
              },
            }),
            0,
          );
          if (moving && !memberFirst)
            assert.equal(
              (await db.user.findUniqueOrThrow({ where: { id: moving.id } }))
                .schoolId,
              otherSchool.id,
            );
        }
      }
    },
  );

  await context.test(
    "pause and create/send/accept enforce both serial orders",
    async () => {
      for (const operation of [
        "SCHOOL_CREATE_ORDER",
        "SCHOOL_SEND_ORDER",
        "SUPPLIER_ACCEPT_ORDER",
      ] as const) {
        for (const workFirst of [true, false]) {
          const label = `pause-${operation}-${workFirst}`;
          const fixture = await schoolFixture(label);
          const accept = operation === "SUPPLIER_ACCEPT_ORDER";
          const order =
            operation === "SCHOOL_CREATE_ORDER"
              ? null
              : await db.supplyRequest.create({
                  data: {
                    requestNo: label,
                    schoolId: fixture.school.id,
                    supplierId: supplier.id,
                    createdByUserId: fixture.staff.id,
                    status: accept ? "SENT" : "DRAFT",
                  },
                });
          const target = accept ? supplierAdmin.id : fixture.admin.id;
          const pause = {
            state: accept
              ? ("PAUSED_FOR_FOOD_SAFETY_INSPECTION" as const)
              : ("PAUSED" as const),
          };
          const work = (
            hold: () => Promise<void>,
            started: () => void = () => undefined,
          ) => {
            if (accept)
              return createSupplyOrderService(undefined, {
                transaction: (fn) => authorizationTransaction(db, fn),
                guard: {
                  async assertAccess(tx, actor, command) {
                    const current = await guardBarrier(started).assertAccess(
                      tx,
                      actor,
                      command,
                    );
                    await hold();
                    return current;
                  },
                },
              }).accept({ id: order!.id }, supplierActor);
            return authorizationTransaction(db, async (tx) => {
              await guardBarrier(started).assertAccess(
                tx,
                fixture.actor,
                operation === "SCHOOL_CREATE_ORDER"
                  ? { operation, supplierId: supplier.id }
                  : { operation, orderId: order!.id },
              );
              await hold();
              if (order)
                await tx.supplyRequest.update({
                  where: { id: order.id },
                  data: { status: "SENT" },
                });
              else
                await tx.supplyRequest.create({
                  data: {
                    requestNo: label,
                    schoolId: fixture.school.id,
                    supplierId: supplier.id,
                    createdByUserId: fixture.staff.id,
                  },
                });
            });
          };
          const results = workFirst
            ? await overlap(
                (hold) => work(hold),
                (started) =>
                  lifecycleBarrier(undefined, started).setIntakeState(
                    { userId: target },
                    pause,
                    principal,
                  ),
              )
            : await overlap(
                (hold) =>
                  lifecycleBarrier(hold).setIntakeState(
                    { userId: target },
                    pause,
                    principal,
                  ),
                (started) => work(() => Promise.resolve(), started),
              );
          assert.equal(results[0].status, "fulfilled");
          if (workFirst) assert.equal(results[1].status, "fulfilled");
          else assertBlocked(results[1]);
          const stored = await db.supplyRequest.findUnique({
            where: { requestNo: label },
          });
          if (operation === "SCHOOL_CREATE_ORDER")
            assert.equal(Boolean(stored), workFirst);
          else
            assert.equal(
              stored?.status,
              workFirst
                ? accept
                  ? "ACCEPTED"
                  : "SENT"
                : accept
                  ? "SENT"
                  : "DRAFT",
            );
          if (accept && workFirst) {
            await authorizationTransaction(db, async (tx) => {
              await guard.assertAccess(tx, supplierActor, {
                operation: "START_ORDER_PROCESSING",
                orderId: order!.id,
                requiredPermission: "supply_request.accept",
              });
              await tx.supplyRequest.update({
                where: { id: order!.id },
                data: { status: "IN_PROGRESS" },
              });
            });
            await authorizationTransaction(db, async (tx) => {
              await guard.assertAccess(tx, supplierActor, {
                operation: "CONTINUE_ACCEPTED_WORK",
                orderId: order!.id,
                requiredPermission: "supply_request.accept",
              });
              await tx.supplyRequest.update({
                where: { id: order!.id },
                data: { status: "COMPLETED" },
              });
            });
          }
          await lifecycle.setIntakeState(
            { userId: target },
            { state: "ACTIVE" },
            principal,
          );
        }
      }
    },
  );

  await context.test(
    "officer pause/deactivation races with receive and forward keep receipts and recipients consistent",
    async () => {
      for (const kind of ["receive", "forward"] as const) {
        for (const effect of ["pause", "deactivate"] as const) {
          for (const workFirst of [true, false]) {
            const label = `officer-${kind}-${effect}-${workFirst}`;
            const selected = await officerFixture(label);
            const fixture = await schoolFixture(label);
            const forwarder = await account(
              "SCHOOL_MANAGEMENT_BOARD",
              `${label}-board`,
              { schoolId: fixture.school.id },
            );
            const forwardActor = await loadPrincipal(forwarder.id, db);
            const incident = await db.foodSafetyIncident.create({
              data: {
                schoolId: fixture.school.id,
                title: label,
                description: "Disposable race fixture",
              },
            });
            const report =
              kind === "receive"
                ? await db.foodSafetyReportForwarding.create({
                    data: {
                      incidentId: incident.id,
                      recipientOrganization: selected.unit.name,
                      recipientCommuneFoodSafetyUnitId: selected.unit.id,
                      recipientUserId: selected.user.id,
                    },
                  })
                : null;
            const work = (
              hold: () => Promise<void>,
              started: () => void = () => undefined,
            ) => {
              if (report)
                return createReportingService(undefined, {
                  transaction: (fn) => authorizationTransaction(db, fn),
                  guard: {
                    async assertAccess(tx, actor, command) {
                      const current = await guardBarrier(started).assertAccess(
                        tx,
                        actor,
                        command,
                      );
                      await hold();
                      return current;
                    },
                  },
                }).receive({ id: report.id }, selected.actor);
              return authorizationTransaction(db, async (tx) => {
                const recipient = await guardBarrier(
                  started,
                ).assertOfficerForwarding(
                  tx,
                  forwardActor,
                  incident.id,
                  selected.user.id,
                );
                await hold();
                await tx.foodSafetyReportForwarding.create({
                  data: {
                    incidentId: incident.id,
                    recipientOrganization: selected.unit.name,
                    recipientUserId: recipient.recipientUserId,
                    recipientCommuneFoodSafetyUnitId:
                      recipient.recipientCommuneFoodSafetyUnitId,
                  },
                });
              });
            };
            const change = (
              hold: () => Promise<void>,
              started: () => void = () => undefined,
            ) => {
              const service = lifecycleBarrier(hold, started);
              return effect === "pause"
                ? service.setIntakeState(
                    { userId: selected.user.id },
                    { state: "PAUSED" },
                    principal,
                  )
                : service.deactivate({ userId: selected.user.id }, principal);
            };
            const results = workFirst
              ? await overlap(
                  (hold) => work(hold),
                  (started) => change(() => Promise.resolve(), started),
                )
              : await overlap(
                  (hold) => change(hold),
                  (started) => work(() => Promise.resolve(), started),
                );
            if (workFirst) {
              assert.equal(results[0].status, "fulfilled");
              if (effect === "deactivate") assertBlocked(results[1]);
              else assert.equal(results[1].status, "fulfilled");
            } else if (effect === "deactivate" && report) {
              assertBlocked(results[0]);
              assert.equal(results[1].status, "fulfilled");
            } else {
              assert.equal(results[0].status, "fulfilled");
              assertBlocked(results[1]);
            }
            const stored = await db.foodSafetyReportForwarding.findMany({
              where: { incidentId: incident.id },
            });
            if (report) {
              assert.equal(stored.length, 1);
              assert.equal(
                Boolean(stored[0].receivedAt),
                workFirst || effect === "deactivate",
              );
              assert.equal(stored[0].status, "PENDING");
              assert.equal(stored[0].forwardedAt, null);
              if (stored[0].receivedAt) {
                const reporting = createReportingService();
                const before = await reporting.receive(
                  { id: report.id },
                  selected.actor,
                );
                await lifecycle.setIntakeState(
                  { userId: selected.user.id },
                  { state: "ACTIVE" },
                  principal,
                );
                assert.deepEqual(
                  await reporting.receive({ id: report.id }, selected.actor),
                  before,
                );
              }
            } else {
              assert.equal(stored.length, workFirst ? 1 : 0);
              if (stored.length)
                assert.equal(stored[0].recipientUserId, selected.user.id);
            }
          }
        }
      }
    },
  );

  await context.test(
    "forward and officer reassignment cannot orphan an unclosed request",
    async () => {
      for (const forwardFirst of [true, false]) {
        const label = `reassign-${forwardFirst}`;
        const selected = await officerFixture(label);
        const nextUnit = await db.communeFoodSafetyUnit.create({
          data: { code: `${label}-next`, name: `${label}-next` },
        });
        const fixture = await schoolFixture(label);
        const forwarder = await account(
          "SCHOOL_MANAGEMENT_BOARD",
          `${label}-board`,
          { schoolId: fixture.school.id },
        );
        const actor = await loadPrincipal(forwarder.id, db);
        const incident = await db.foodSafetyIncident.create({
          data: {
            schoolId: fixture.school.id,
            title: label,
            description: label,
          },
        });
        const forward = (
          hold: () => Promise<void>,
          started: () => void = () => undefined,
        ) =>
          authorizationTransaction(db, async (tx) => {
            const recipient = await guardBarrier(
              started,
            ).assertOfficerForwarding(tx, actor, incident.id, selected.user.id);
            await hold();
            await tx.foodSafetyReportForwarding.create({
              data: {
                incidentId: incident.id,
                recipientOrganization: label,
                recipientUserId: recipient.recipientUserId,
                recipientCommuneFoodSafetyUnitId:
                  recipient.recipientCommuneFoodSafetyUnitId,
              },
            });
          });
        const reassign = (
          hold: () => Promise<void>,
          started: () => void = () => undefined,
        ) =>
          authorizationTransaction(db, async (tx) => {
            await guardBarrier(started).assertOfficerReassignment(
              tx,
              principal,
              selected.user.id,
            );
            await hold();
            await tx.user.update({
              where: { id: selected.user.id },
              data: { communeFoodSafetyUnitId: nextUnit.id },
            });
          });
        const results = forwardFirst
          ? await overlap(
              (hold) => forward(hold),
              (started) => reassign(() => Promise.resolve(), started),
            )
          : await overlap(
              (hold) => reassign(hold),
              (started) => forward(() => Promise.resolve(), started),
            );
        assert.equal(results[0].status, "fulfilled");
        if (forwardFirst) assertBlocked(results[1]);
        else assert.equal(results[1].status, "fulfilled");
        const current = await db.user.findUniqueOrThrow({
          where: { id: selected.user.id },
        });
        const rows = await db.foodSafetyReportForwarding.findMany({
          where: { incidentId: incident.id },
        });
        assert.equal(rows.length, 1);
        assert.equal(
          rows[0].recipientCommuneFoodSafetyUnitId,
          current.communeFoodSafetyUnitId,
        );
        assert.equal(
          current.communeFoodSafetyUnitId,
          forwardFirst ? selected.unit.id : nextUnit.id,
        );
      }
    },
  );

  await context.test(
    "queued requests recheck revoked permission, status and membership before opening their transaction",
    async () => {
      const permission = await db.permission.findUniqueOrThrow({
        where: { code: "supply_request.accept" },
      });
      for (const mutation of ["permission", "status", "membership"] as const) {
        const label = `identity-${mutation}`;
        const organization = await db.supplier.create({
          data: { name: label },
        });
        await account("INGREDIENT_SUPPLIER_ADMIN", `${label}-admin`, {
          supplierId: organization.id,
        });
        const member = await account(
          "INGREDIENT_SUPPLIER_STAFF",
          `${label}-staff`,
          { supplierId: organization.id },
        );
        const actor = await loadPrincipal(member.id, db);
        const order = await db.supplyRequest.create({
          data: {
            requestNo: label,
            schoolId: school.id,
            supplierId: organization.id,
            createdByUserId: schoolStaff.id,
            status: "SENT",
          },
        });
        const queued = latch();
        const proceed = latch();
        const service = createSupplyOrderService(undefined, {
          transaction: async (fn) => {
            queued.resolve();
            await proceed.promise;
            return authorizationTransaction(db, fn);
          },
          guard,
        });
        const pending = service.accept({ id: order.id }, actor);
        const denied = assert.rejects(
          () => pending,
          (error: unknown) =>
            error instanceof HttpError && error.statusCode === 403,
        );
        await queued.promise;
        try {
          await authorizationTransaction(db, async (tx) => {
            if (mutation === "permission")
              await tx.userPermissionDenial.create({
                data: {
                  userId: member.id,
                  permissionId: permission.id,
                  disabledByUserId: system.id,
                  supplierId: organization.id,
                },
              });
            else if (mutation === "status")
              await tx.user.update({
                where: { id: member.id },
                data: { status: "INACTIVE" },
              });
            else
              await tx.user.update({
                where: { id: member.id },
                data: { supplierId: supplier.id },
              });
          });
        } finally {
          proceed.resolve();
        }
        await denied;
        assert.equal(
          (
            await db.supplyRequest.findUniqueOrThrow({
              where: { id: order.id },
            })
          ).status,
          "SENT",
        );
      }
    },
  );

  await context.test(
    "in-flight transactions recheck permission, status and membership changes under locks",
    async (testContext) => {
      const permission = await db.permission.findUniqueOrThrow({
        where: { code: "supply_request.accept" },
      });
      const permissions = createPermissionService(() => Promise.resolve(db));
      for (const mutation of [
        "denial",
        "role-grant",
        "status",
        "membership",
      ] as const) {
        await testContext.test(mutation, async () => {
          const label = `inflight-${mutation}`;
          const organization = await db.supplier.create({
            data: { name: label },
          });
          const manager = await account(
            "INGREDIENT_SUPPLIER_ADMIN",
            `${label}-admin`,
            { supplierId: organization.id },
          );
          const member = await account(
            "INGREDIENT_SUPPLIER_STAFF",
            `${label}-staff`,
            { supplierId: organization.id },
          );
          const actor = await loadPrincipal(member.id, db);
          const originalGrants = await db.rolePermission.findMany({
            where: { roleId: actor.roleId },
            select: { permissionId: true },
          });
          const order = await db.supplyRequest.create({
            data: {
              requestNo: label,
              schoolId: school.id,
              supplierId: organization.id,
              createdByUserId: schoolStaff.id,
              status: "SENT",
            },
          });
          const read = latch();
          const resume = latch();
          const repository = createIntakeAccessRepository();
          const blockedGuard = createIntakeAccessService({
            ...repository,
            async lockParents(tx, scope) {
              read.resolve();
              await resume.promise;
              await repository.lockParents(tx, scope);
            },
          });
          const service = createSupplyOrderService(undefined, {
            transaction: (fn) => authorizationTransaction(db, fn),
            guard: blockedGuard,
          });
          const pending = Promise.allSettled([
            service.accept({ id: order.id }, actor),
          ]);
          try {
            await read.promise;
            if (mutation === "denial")
              await permissions.toggle(
                manager.id,
                member.id,
                permission.id,
                true,
              );
            else if (mutation === "role-grant")
              await permissions.replaceRole(
                system.id,
                actor.roleId,
                originalGrants
                  .map((row) => row.permissionId)
                  .filter((id) => id !== permission.id),
              );
            else if (mutation === "status")
              await db.user.update({
                where: { id: member.id },
                data: { status: "INACTIVE" },
              });
            else
              await db.user.update({
                where: { id: member.id },
                data: { supplierId: supplier.id },
              });
            resume.resolve();
            const results = await pending;
            assertBlocked(results[0]);
            assert.equal(
              (
                await db.supplyRequest.findUniqueOrThrow({
                  where: { id: order.id },
                })
              ).status,
              "SENT",
            );
          } finally {
            resume.resolve();
            await pending;
            if (mutation === "role-grant")
              await permissions.replaceRole(
                system.id,
                actor.roleId,
                originalGrants.map((row) => row.permissionId),
              );
          }
        });
      }
    },
  );

  await context.test(
    "cascade covers every account status, retains partners and is idempotent",
    async () => {
      const fixture = await schoolFixture("cascade-matrix");
      for (const status of [
        "UNVERIFIED",
        "INACTIVE",
        "LOCKED",
        "DEACTIVATED",
      ] as const) {
        const member = await account(
          "SCHOOL_KITCHEN_STAFF",
          `cascade-${status.toLowerCase()}`,
          { schoolId: fixture.school.id },
        );
        await db.user.update({ where: { id: member.id }, data: { status } });
      }
      for (const status of [
        "DRAFT",
        "SENT",
        "ACCEPTED",
        "COMPLETED",
        "CANCELLED",
      ] as const) {
        await db.supplyRequest.create({
          data: {
            requestNo: `CASCADE-${status}`,
            schoolId: fixture.school.id,
            supplierId: supplier.id,
            createdByUserId: fixture.staff.id,
            status,
          },
        });
      }
      const result = await lifecycle.deactivate(
        { userId: fixture.admin.id },
        principal,
      );
      assert.equal(result.affectedAccountCount, 6);
      const first = await db.user.findMany({
        where: { schoolId: fixture.school.id },
        select: { id: true, status: true, updatedAt: true },
        orderBy: { id: "asc" },
      });
      assert(first.every((row) => row.status === "DEACTIVATED"));
      assert.deepEqual(
        await lifecycle.deactivate({ userId: fixture.admin.id }, principal),
        result,
      );
      assert.deepEqual(
        await db.user.findMany({
          where: { schoolId: fixture.school.id },
          select: { id: true, status: true, updatedAt: true },
          orderBy: { id: "asc" },
        }),
        first,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: supplierAdmin.id } }))
          .status,
        "ACTIVE",
      );
      const onlySchool = await db.school.create({
        data: { name: "Admin only" },
      });
      const onlyAdmin = await account(
        "SCHOOL_ADMINISTRATION",
        "cascade-only-admin",
        { schoolId: onlySchool.id },
      );
      assert.equal(
        (await lifecycle.deactivate({ userId: onlyAdmin.id }, principal))
          .affectedAccountCount,
        1,
      );
    },
  );

  await context.test(
    "officer blockers cover incident, notification and receipt matrices including legacy rows",
    async () => {
      const selected = await officerFixture("officer-matrix");
      const other = await officerFixture("officer-unrelated");
      await db.user.update({
        where: { id: selected.user.id },
        data: { status: "INACTIVE" },
      });
      await assert.rejects(() =>
        account("COMMUNE_FOOD_SAFETY_OFFICER", "officer-duplicate", {
          communeFoodSafetyUnitId: selected.unit.id,
        }),
      );
      assert.equal(
        await db.user.count({
          where: { communeFoodSafetyUnitId: selected.unit.id },
        }),
        1,
      );
      await db.user.update({
        where: { id: selected.user.id },
        data: { status: "ACTIVE" },
      });
      const incident = await db.foodSafetyIncident.create({
        data: {
          schoolId: school.id,
          title: "Blocker matrix",
          description: "Disposable fixture",
        },
      });
      const report = await db.foodSafetyReportForwarding.create({
        data: {
          incidentId: incident.id,
          recipientOrganization: selected.unit.name,
          recipientUserId: selected.user.id,
          recipientCommuneFoodSafetyUnitId: selected.unit.id,
        },
      });
      for (const status of ["OPEN", "INVESTIGATING", "RESOLVED"] as const) {
        await db.foodSafetyIncident.update({
          where: { id: incident.id },
          data: { status },
        });
        for (const notification of ["PENDING", "FAILED", "SENT"] as const) {
          for (const receivedAt of [null, new Date()]) {
            await db.foodSafetyReportForwarding.update({
              where: { id: report.id },
              data: {
                status: notification,
                receivedAt,
                forwardedAt: notification === "SENT" ? new Date() : null,
              },
            });
            await assert.rejects(
              () =>
                lifecycle.deactivate({ userId: selected.user.id }, principal),
              businessConflict,
            );
          }
        }
      }
      await db.foodSafetyReportForwarding.update({
        where: { id: report.id },
        data: { recipientUserId: null, receivedAt: null },
      });
      await assert.rejects(
        () => lifecycle.deactivate({ userId: selected.user.id }, principal),
        businessConflict,
      );
      await db.foodSafetyReportForwarding.create({
        data: {
          incidentId: incident.id,
          recipientOrganization: selected.unit.name,
          recipientUserId: selected.user.id,
          recipientCommuneFoodSafetyUnitId: selected.unit.id,
        },
      });
      const unrelatedIncident = await db.foodSafetyIncident.create({
        data: {
          schoolId: school.id,
          title: "Another officer request",
          description: "Not in selected recipient scope",
        },
      });
      await db.foodSafetyReportForwarding.create({
        data: {
          incidentId: unrelatedIncident.id,
          recipientOrganization: other.unit.name,
          recipientUserId: other.user.id,
          recipientCommuneFoodSafetyUnitId: other.unit.id,
          status: "FAILED",
        },
      });
      assert.equal(
        (await lifecycle.getLifecycle({ userId: other.user.id }, principal))
          .accountStatus,
        "ACTIVE",
      );
      await db.foodSafetyIncident.update({
        where: { id: incident.id },
        data: { status: "CLOSED" },
      });
      assert.equal(
        (await lifecycle.deactivate({ userId: selected.user.id }, principal))
          .affectedAccountCount,
        1,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: other.user.id } }))
          .status,
        "ACTIVE",
      );
      await assert.rejects(
        () => lifecycle.deactivate({ userId: other.user.id }, principal),
        businessConflict,
      );
    },
  );

  await context.test(
    "supplier cascade covers every status and leaves the school partner active",
    async () => {
      const organization = await db.supplier.create({
        data: { name: "Supplier cascade matrix" },
      });
      const admin = await account(
        "INGREDIENT_SUPPLIER_ADMIN",
        "supplier-cascade-admin",
        { supplierId: organization.id },
      );
      for (const status of [
        "UNVERIFIED",
        "ACTIVE",
        "INACTIVE",
        "LOCKED",
        "DEACTIVATED",
      ] as const) {
        const member = await account(
          "INGREDIENT_SUPPLIER_STAFF",
          `supplier-cascade-${status.toLowerCase()}`,
          { supplierId: organization.id },
        );
        await db.user.update({ where: { id: member.id }, data: { status } });
      }
      for (const status of [
        "DRAFT",
        "SENT",
        "ACCEPTED",
        "COMPLETED",
        "CANCELLED",
      ] as const)
        await db.supplyRequest.create({
          data: {
            requestNo: `SUPPLIER-CASCADE-${status}`,
            supplierId: organization.id,
            schoolId: school.id,
            createdByUserId: schoolStaff.id,
            status,
          },
        });
      const result = await lifecycle.deactivate(
        { userId: admin.id },
        principal,
      );
      assert.equal(result.affectedAccountCount, 6);
      assert.equal(
        await db.user.count({
          where: {
            supplierId: organization.id,
            status: { not: "DEACTIVATED" },
          },
        }),
        0,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: schoolStaff.id } }))
          .status,
        "ACTIVE",
      );
      assert.deepEqual(
        await lifecycle.deactivate({ userId: admin.id }, principal),
        result,
      );
    },
  );

  await context.test(
    "real identities reject login, refresh and existing HTTP sessions after deactivation",
    async (testContext) => {
      const fixture = await schoolFixture("session-matrix");
      const sessionSupplier = await db.supplier.create({
        data: { name: "Session supplier" },
      });
      const sessionSupplierAdmin = await account(
        "INGREDIENT_SUPPLIER_ADMIN",
        "session-supplier-admin",
        { supplierId: sessionSupplier.id },
      );
      await account("INGREDIENT_SUPPLIER_STAFF", "session-supplier-staff", {
        supplierId: sessionSupplier.id,
      });
      const sessionOfficer = await officerFixture("session-officer");
      const scenarios = [
        {
          username: "session-matrix-staff",
          target: fixture.admin.id,
          state: "PAUSED" as const,
        },
        {
          username: "session-supplier-staff",
          target: sessionSupplierAdmin.id,
          state: "PAUSED_FOR_FOOD_SAFETY_INSPECTION" as const,
        },
        {
          username: "session-officer",
          target: sessionOfficer.user.id,
          state: "PAUSED" as const,
        },
      ];
      const { store } = memorySessions();
      const sessions = createAuthSessions(store);
      const sessionService = createSessionService(
        () => Promise.resolve(db),
        sessions,
      );
      const check = (payload: Parameters<typeof sessions.assertAccess>[0]) =>
        sessions.assertAccess(payload);
      const app = express();
      app.get(
        "/me",
        createSessionAuthenticate((id) => loadSessionUser(id, db), check),
        (_req, res) => res.sendStatus(204),
      );
      app.get(
        "/business",
        createAuthenticate((id) => loadPrincipal(id, db), check),
        (_req, res) => res.sendStatus(204),
      );
      app.use(globalErrorHandler);
      const http = await startHttp(app);
      testContext.after(() => http.close());
      for (const scenario of scenarios) {
        const tokens = await sessionService.login({
          identifier: scenario.username,
          password: "Lifecycle-test-password",
        });
        const headers = { Cookie: `${ACCESS_COOKIE}=${tokens.accessToken}` };
        await lifecycle.setIntakeState(
          { userId: scenario.target },
          { state: scenario.state },
          principal,
        );
        assert.equal((await http.request("/me", { headers })).status, 204);
        assert.equal(
          (await http.request("/business", { headers })).status,
          204,
        );
        const secondLogin = await sessionService.login({
          identifier: scenario.username,
          password: "Lifecycle-test-password",
        });
        assert.equal(secondLogin.user.status, "ACTIVE");
        await lifecycle.deactivate({ userId: scenario.target }, principal);
        await lifecycle.setIntakeState(
          { userId: scenario.target },
          { state: "ACTIVE" },
          principal,
        );
        for (const path of ["/me", "/business"])
          assert.equal((await http.request(path, { headers })).status, 403);
        const denied = (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403;
        await assert.rejects(
          () => sessionService.refresh(tokens.refreshToken),
          denied,
        );
        await assert.rejects(
          () =>
            sessionService.login({
              identifier: scenario.username,
              password: "Lifecycle-test-password",
            }),
          denied,
        );
      }
    },
  );

  await context.test(
    "school pause blocks new orders without disabling its members",
    async () => {
      await lifecycle.setIntakeState(
        { userId: schoolAdmin.id },
        { state: "PAUSED" },
        principal,
      );
      await assert.rejects(
        () =>
          authorizationTransaction(db, (tx) =>
            guard.assertAccess(tx, schoolActor, {
              operation: "SCHOOL_CREATE_ORDER",
              supplierId: supplier.id,
            }),
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      assert.equal(
        (await loadPrincipal(schoolStaff.id, db)).id,
        schoolStaff.id,
      );
      await lifecycle.setIntakeState(
        { userId: schoolAdmin.id },
        { state: "ACTIVE" },
        principal,
      );
    },
  );

  await context.test(
    "concurrent order creation and pause share the school lock",
    async () => {
      const held = latch();
      const proceed = latch();
      const started = latch();
      const creating = authorizationTransaction(db, async (tx) => {
        await guard.assertAccess(tx, schoolActor, {
          operation: "SCHOOL_CREATE_ORDER",
          supplierId: supplier.id,
        });
        held.resolve();
        await proceed.promise;
        return tx.supplyRequest.create({
          data: {
            requestNo: "LIFECYCLE-RACE",
            schoolId: school.id,
            supplierId: supplier.id,
            createdByUserId: schoolStaff.id,
          },
          select: { id: true },
        });
      });
      await Promise.race([
        held.promise,
        creating.then(() => {
          throw new Error("Giao dịch tạo đơn kết thúc trước khi giữ khóa");
        }),
      ]);
      const pausingService = createAccountLifecycleService(undefined, {
        transaction: (fn) =>
          authorizationTransaction(db, async (tx) => {
            started.resolve();
            return fn(tx);
          }),
        loadActor: loadPrincipal,
      });
      const pausing = pausingService.setIntakeState(
        { userId: schoolAdmin.id },
        { state: "PAUSED" },
        principal,
      );
      try {
        await Promise.race([
          started.promise,
          pausing.then(() => {
            throw new Error("Giao dịch tạm dừng chưa bắt đầu");
          }),
        ]);
      } finally {
        proceed.resolve();
      }
      await Promise.all([creating, pausing]);
      assert.equal(
        (await db.school.findUniqueOrThrow({ where: { id: school.id } }))
          .intakeState,
        "PAUSED",
      );
      await assert.rejects(
        () =>
          authorizationTransaction(db, (tx) =>
            guard.assertAccess(tx, schoolActor, {
              operation: "SCHOOL_CREATE_ORDER",
              supplierId: supplier.id,
            }),
          ),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      await lifecycle.setIntakeState(
        { userId: schoolAdmin.id },
        { state: "ACTIVE" },
        principal,
      );
    },
  );

  await context.test("supplier accepts a sent order exactly once", async () => {
    const order = await db.supplyRequest.create({
      data: {
        requestNo: "LIFECYCLE-ACCEPT",
        schoolId: school.id,
        supplierId: supplier.id,
        createdByUserId: schoolStaff.id,
        status: "SENT",
      },
      select: { id: true },
    });
    await lifecycle.setIntakeState(
      { userId: supplierAdmin.id },
      { state: "PAUSED_FOR_FOOD_SAFETY_INSPECTION" },
      principal,
    );
    await assert.rejects(
      () => supply.accept({ id: order.id }, supplierActor),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 409,
    );
    await lifecycle.setIntakeState(
      { userId: supplierAdmin.id },
      { state: "ACTIVE" },
      principal,
    );
    const first = await supply.accept({ id: order.id }, supplierActor);
    assert.equal(first.status, "ACCEPTED");
    assert.equal(first.acceptedByUserId, supplierStaff.id);
    assert.deepEqual(
      await supply.accept({ id: order.id }, supplierActor),
      first,
    );
  });

  await context.test(
    "in-progress orders block deactivation and cascade is scoped",
    async () => {
      const repository = createAccountLifecycleRepository();
      const failing = createAccountLifecycleService({
        ...repository,
        async deactivateAccounts(tx, scope) {
          await repository.deactivateAccounts(tx, scope);
          throw new HttpError(409, "Lỗi kiểm thử sau khi cập nhật nhóm");
        },
      });
      await assert.rejects(
        () => failing.deactivate({ userId: schoolAdmin.id }, principal),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: schoolAdmin.id } }))
          .status,
        "ACTIVE",
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: schoolStaff.id } }))
          .status,
        "ACTIVE",
      );
      const order = await db.supplyRequest.create({
        data: {
          requestNo: "LIFECYCLE-INPROGRESS",
          schoolId: school.id,
          supplierId: supplier.id,
          createdByUserId: schoolStaff.id,
          status: "IN_PROGRESS",
        },
        select: { id: true },
      });
      await assert.rejects(
        () => lifecycle.deactivate({ userId: schoolAdmin.id }, principal),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: schoolStaff.id } }))
          .status,
        "ACTIVE",
      );
      await db.supplyRequest.update({
        where: { id: order.id },
        data: { status: "COMPLETED" },
      });
      const result = await lifecycle.deactivate(
        { userId: schoolAdmin.id },
        principal,
      );
      assert.equal(result.affectedAccountCount, 2);
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: schoolStaff.id } }))
          .status,
        "DEACTIVATED",
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: otherStaff.id } }))
          .status,
        "ACTIVE",
      );
      await assert.rejects(
        () => loadPrincipal(schoolStaff.id, db),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 403,
      );
    },
  );

  await context.test(
    "officer pause and unclosed requests are scoped to the recipient",
    async () => {
      const unit = await db.communeFoodSafetyUnit.create({
        data: { code: "LIFECYCLE-ATTP", name: "Lifecycle unit" },
        select: { id: true },
      });
      const officer = await account(
        "COMMUNE_FOOD_SAFETY_OFFICER",
        "lifecycle-officer",
        { communeFoodSafetyUnitId: unit.id },
      );
      const incident = await db.foodSafetyIncident.create({
        data: { schoolId: school.id, title: "Incident", description: "Test" },
        select: { id: true },
      });
      const report = await db.foodSafetyReportForwarding.create({
        data: {
          incidentId: incident.id,
          recipientCommuneFoodSafetyUnitId: unit.id,
          recipientUserId: officer.id,
          recipientOrganization: "Lifecycle unit",
        },
        select: { id: true },
      });
      const officerPrincipal = await loadPrincipal(officer.id, db);
      const reporting = createReportingService();
      await lifecycle.setIntakeState(
        { userId: officer.id },
        { state: "PAUSED" },
        principal,
      );
      await assert.rejects(
        () => reporting.receive({ id: report.id }, officerPrincipal),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      await assert.rejects(
        () => lifecycle.deactivate({ userId: officer.id }, principal),
        (error: unknown) =>
          error instanceof HttpError && error.statusCode === 409,
      );
      await lifecycle.setIntakeState(
        { userId: officer.id },
        { state: "ACTIVE" },
        principal,
      );
      const received = await reporting.receive(
        { id: report.id },
        officerPrincipal,
      );
      assert.equal(received.recipientUserId, officer.id);
      assert.deepEqual(
        await reporting.receive({ id: report.id }, officerPrincipal),
        received,
      );
      await db.foodSafetyIncident.update({
        where: { id: incident.id },
        data: { status: "CLOSED" },
      });
      assert.equal(
        (await lifecycle.deactivate({ userId: officer.id }, principal))
          .affectedAccountCount,
        1,
      );
    },
  );
});
