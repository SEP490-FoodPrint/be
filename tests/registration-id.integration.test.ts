import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Client } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { HttpError } from "../src/utils/http-error";
import { assertLocalMigrationTarget } from "../src/utils/migration-target";
import { getPrisma } from "../src/utils/database";
import { bootstrapAuthorization } from "../src/utils/authorization-bootstrap";
import { loadPrincipal } from "../src/utils/authorization";
import { loadSessionUser } from "../src/utils/session-identity";
import { createOnboardingService } from "../src/modules/auth/onboarding.service";
import { validateSubmission } from "../src/modules/auth/onboarding.validation";
import { createRegistrationService } from "../src/modules/registration/registration.service";
import { createSessionService } from "../src/modules/auth/session.service";
import { createProfileService } from "../src/modules/auth/profile.service";
import { createAuthSessions } from "../src/utils/auth-sessions";
import { memorySessions } from "./helpers/auth-sessions";
import type { DocumentStorage } from "../src/utils/onboarding-documents";

const execute = promisify(execFile);
void test("registration numbers are unique across concurrent real submissions and remain stable through review", async (context) => {
  const base = process.env.MIGRATION_TEST_DATABASE_URL;
  assert(
    base,
    "Set MIGRATION_TEST_DATABASE_URL to the explicitly selected disposable local instance",
  );
  const target = assertLocalMigrationTarget(base);
  assert.match(target.pathname, /^\/foodprint_migration_test(?:_[a-z0-9_]+)?$/);
  const owner = new Client({ connectionString: base });
  await owner.connect();
  const name =
    "foodprint_migration_test_registration_" + randomUUID().replaceAll("-", "");
  await owner.query(`CREATE DATABASE "${name}"`);
  await owner.end();
  target.pathname = "/" + name;
  process.env.DATABASE_URL = target.toString();
  const sql = new Client({ connectionString: target.toString() });
  await sql.connect();
  context.after(() => sql.end());
  await execute(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { env: { ...process.env }, timeout: 90000 },
  );
  const db = await getPrisma();
  context.after(() => db.$disconnect());
  await bootstrapAuthorization(db);
  const schoolRole = await db.role.findUniqueOrThrow({
    where: { code: "SCHOOL_ADMINISTRATION" },
  });
  const supplierRole = await db.role.findUniqueOrThrow({
    where: { code: "INGREDIENT_SUPPLIER_ADMIN" },
  });
  const users = await Promise.all(
    Array.from({ length: 104 }, (_, index) => {
      const role = index % 2 === 0 ? schoolRole : supplierRole;
      return db.user.create({
        data: {
          roleId: role.id,
          roleCode: role.code,
          username: `number_applicant_${index}`,
          email: `number_applicant_${index}@example.test`,
          fullName: `Applicant ${index}`,
          passwordHash: "integration-not-used-for-login",
          status: "UNVERIFIED",
          emailVerifiedAt: new Date(),
        },
      });
    }),
  );
  const storage: DocumentStorage = {
    upload() {
      throw new Error("No cloud upload expected");
    },
    remove() {
      return Promise.resolve();
    },
    download() {
      return "https://example.test/private-download";
    },
  };
  const service = createOnboardingService(() => Promise.resolve(db), storage);
  const principals = await Promise.all(
    users.map((user) => loadSessionUser(user.id, db)),
  );
  await context.test(
    "100 independent applicants use the same sequence under simultaneous submission",
    async () => {
      let retries = 0;
      const settled = await Promise.allSettled(
        principals.slice(0, 100).map(async (user, index) => {
          const input = validateSubmission(
            { name: user.fullName },
            user.orgType === "SCHOOL" ? "SCHOOL" : "SUPPLIER",
          );
          for (let attempt = 0; ; attempt++) {
            try {
              return await service.submit(user, input);
            } catch (error) {
              // Existing Serializable retries are bounded. Model a caller retrying the
              // documented 503, without changing runtime isolation or retry policy.
              if (
                !(error instanceof HttpError) ||
                error.statusCode !== 503 ||
                attempt >= 5
              )
                throw error;
              retries++;
              await delay(25 * (attempt + 1) + (index % 17));
            }
          }
        }),
      );
      const results = settled.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      context.diagnostic(
        `100 concurrent logical submissions; ${retries} client retries of existing transient 503 responses`,
      );
      assert.equal(results.length, 100);
      assert.equal(new Set(results.map((row) => row.registrationID)).size, 100);
      for (const row of results) {
        assert.match(row.registrationID, /^FP-REG-[0-9]{5,}$/);
        assert(!JSON.stringify(row).includes("registrationNumber"));
      }
      assert.equal(await db.registrationRequest.count(), 100);
    },
  );
  await context.test(
    "a rolled back insert consumes its number and never leaves a successful incomplete application",
    async () => {
      const user = users[100];
      let consumed = 0n;
      const marker = new Error("rollback test only");
      await assert.rejects(
        db.$transaction(async (tx) => {
          const row = await tx.registrationRequest.create({
            data: {
              applicantUserId: user.id,
              requestType: "SCHOOL",
              profileData: { name: "Rollback" },
            },
          });
          consumed = row.registrationNumber;
          throw marker;
        }),
        (error: unknown) => error === marker,
      );
      assert.equal(
        await db.registrationRequest.count({
          where: { applicantUserId: user.id },
        }),
        0,
      );
      const result = await service.submit(
        principals[100],
        validateSubmission({ name: "After rollback" }, "SCHOOL"),
      );
      const stored = await db.registrationRequest.findUniqueOrThrow({
        where: { id: result.id },
      });
      assert(stored.registrationNumber > consumed);
    },
  );
  await context.test(
    "numbers expand at 100000 and an old writer omitting the new field still gets a code",
    async () => {
      await sql.query(
        "SELECT setval('foodprint.registration_requests_registration_number_seq',99999,true)",
      );
      const row = await db.registrationRequest.create({
        data: {
          applicantUserId: users[101].id,
          requestType: "SUPPLIER",
          profileData: { name: "Legacy writer" },
        },
      });
      assert.equal(row.registrationNumber, 100000n);
      assert.equal(
        (await service.own(principals[101]))?.registrationID,
        "FP-REG-100000",
      );
      const after = await service.submit(
        principals[102],
        validateSubmission({ name: "After boundary" }, "SCHOOL"),
      );
      assert.equal(after.registrationID, "FP-REG-100001");
    },
  );
  await context.test(
    "UUID, number, outbox and all public summaries remain consistent over edit/reject/resubmit/approve",
    async () => {
      const applicant = principals[103];
      const submitted = await service.submit(
        applicant,
        validateSubmission({ name: "Lifecycle" }, "SUPPLIER"),
      );
      const adminRole = await db.role.findUniqueOrThrow({
        where: { code: "SYSTEM_ADMIN" },
      });
      const admin = await db.user.create({
        data: {
          roleId: adminRole.id,
          roleCode: adminRole.code,
          username: "number_reviewer",
          email: "number_reviewer@example.test",
          fullName: "Reviewer",
          passwordHash: "not-used",
          status: "ACTIVE",
        },
      });
      const actor = await loadPrincipal(admin.id, db);
      const detail = () => service.detail(actor, { id: submitted.id });
      assert.equal((await detail()).registrationID, submitted.registrationID);
      const deniedView = { ...actor, permissions: [] };
      await db.permission.updateMany({
        where: { code: "registration.view" },
        data: { isActive: false },
      });
      await assert.rejects(
        service.detail(deniedView, { id: submitted.id }),
        (error: unknown) =>
          error instanceof Error &&
          "statusCode" in error &&
          error.statusCode === 403,
      );
      await db.permission.updateMany({
        where: { code: "registration.view" },
        data: { isActive: true },
      });
      const sequenceBefore = (
        await sql.query<{ last_value: string }>(
          "SELECT last_value FROM foodprint.registration_requests_registration_number_seq",
        )
      ).rows[0].last_value;
      const edited = await service.submit(
        applicant,
        validateSubmission(
          {
            name: "Edited",
            expectedUpdatedAt: submitted.updatedAt,
          },
          "SUPPLIER",
        ),
      );
      assert.equal(edited.registrationID, submitted.registrationID);
      const rejected = await service.reject(actor, {
        id: submitted.id,
        expectedReviewVersion: (await detail()).reviewVersion,
        rejectionReason: "Bổ sung thông tin",
      });
      assert.equal(rejected.registrationID, submitted.registrationID);
      const resubmitted = await service.submit(
        applicant,
        validateSubmission({ name: "Resubmitted" }, "SUPPLIER"),
      );
      assert.equal(resubmitted.registrationID, submitted.registrationID);
      const approved = await service.approve(actor, {
        id: submitted.id,
        expectedReviewVersion: (await detail()).reviewVersion,
      });
      assert.equal(approved.registrationID, submitted.registrationID);
      assert.equal(approved.id, submitted.id);
      assert.equal(
        await db.emailOutbox.count({ where: { registrationId: submitted.id } }),
        4,
      );
      const { store } = memorySessions();
      const sessions = createSessionService(
        () => Promise.resolve(db),
        createAuthSessions(store),
      );
      const current = await sessions.currentUser(applicant.id);
      assert.equal(
        sessions.getProfile(current).registrationRequest?.registrationID,
        submitted.registrationID,
      );
      const updatedProfile = await createProfileService(() =>
        Promise.resolve(db),
      ).update(current, { phone: "0901234567" });
      assert.equal(
        updatedProfile.registrationRequest?.registrationID,
        submitted.registrationID,
      );
      assert.equal(
        (await service.own(current))?.registrationID,
        submitted.registrationID,
      );
      const list = await createRegistrationService().getAll(
        { page: 1, limit: 100 },
        actor,
      );
      for (const row of list.items)
        assert.equal(
          (await service.detail(actor, { id: row.id })).registrationID,
          row.registrationID,
        );
      assert.equal(
        (
          await sql.query<{ last_value: string }>(
            "SELECT last_value FROM foodprint.registration_requests_registration_number_seq",
          )
        ).rows[0].last_value,
        sequenceBefore,
      );
    },
  );
});
