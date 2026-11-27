import { createOnboardingController } from "../src/modules/auth/onboarding.controller";
import { RequestValidationError } from "../src/utils/request-validation";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import {
  validateOnboarding,
  readProfileBody,
} from "../src/modules/auth/onboarding.validation";
import {
  documentFormat,
  readDocuments,
  validateProfileFiles,
  MAX_DOCUMENT_BYTES,
  MAX_PROFILE_DOCUMENTS,
  documentStorage,
} from "../src/utils/onboarding-documents";
import { HttpError } from "../src/utils/http-error";
import { onboardingUpload } from "../src/middlewares/onboarding-upload.middleware";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createCsrfProtection } from "../src/middlewares/csrf.middleware";
import { startHttp } from "./helpers/http";
import "./helpers/authorization";

const invalid = (error: unknown) =>
  error instanceof HttpError && error.statusCode === 400;
const certification = {
  certificationType: "ATTP",
  certificateNo: "ATTP-001",
  issuedDate: "2024-02-29",
  expiryDate: "2026-12-31",
};
void test("Cloudinary download signatures are authenticated and expire; missing configuration fails closed without a network call", async (context) => {
  const names = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  context.after(() =>
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }),
  );
  const userId = randomUUID(),
    id = randomUUID();
  const document = {
    id,
    field: "legalDocument",
    publicId: `foodprint/onboarding/${userId}/${id}.pdf`,
    format: "pdf" as const,
    fileName: "a.pdf",
    bytes: 12,
  };
  for (const name of names) delete process.env[name];
  await assert.rejects(
    () => documentStorage.upload(userId, file("legalDocument")),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  assert.throws(
    () => documentStorage.download(document),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  process.env.CLOUDINARY_CLOUD_NAME = "foodprint-unit-test";
  process.env.CLOUDINARY_API_KEY = "unit-test-api-key";
  process.env.CLOUDINARY_API_SECRET = "unit-test-api-secret";
  const url = new URL(documentStorage.download(document));
  assert.equal(url.protocol, "https:");
  assert.match(url.pathname, /\/raw\/download$/);
  assert.equal(url.searchParams.get("type"), "authenticated");
  assert.equal(url.searchParams.get("public_id"), document.publicId);
  assert.equal(url.searchParams.get("attachment"), "false");
  const ttl =
    Number(url.searchParams.get("expires_at")) - Math.floor(Date.now() / 1000);
  assert(ttl > 0 && ttl <= 60);
  assert(url.searchParams.get("signature"));
  assert(!url.toString().includes("unit-test-api-secret"));
});
function file(
  fieldname: string,
  mimetype = "application/pdf",
  contents = "%PDF-1.7\nlocal test",
): Express.Multer.File {
  const buffer = Buffer.from(contents);
  return {
    fieldname,
    originalname: "certificate.pdf",
    encoding: "7bit",
    mimetype,
    buffer,
    size: buffer.length,
    stream: Readable.from(buffer),
    destination: "",
    filename: "",
    path: "",
  };
}

void test("school onboarding requires only name and rejects fields absent from the final Figma", () => {
  assert.deepEqual(validateOnboarding({ name: " Trường A " }, "SCHOOL"), {
    requestType: "SCHOOL",
    profileData: {
      name: "Trường A",
      email: null,
      phone: null,
      address: null,
      locationId: null,
      code: null,
    },
  });
  const full = validateOnboarding(
    {
      name: "A",
      code: "S01",
      email: " CONTACT@EXAMPLE.TEST ",
      phone: "0123",
      address: "Địa chỉ",
    },
    "SCHOOL",
  );
  assert.equal(full.profileData.email, "contact@example.test");
  for (const body of [
    {},
    { name: " " },
    { name: "A", websiteUrl: "https://example.test" },
    { name: "A", schoolId: randomUUID() },
    { name: "A", status: "ACTIVE" },
    { name: "A", supportingDocuments: ["https://attacker.test/file"] },
    { name: "A", email: "invalid" },
  ])
    assert.throws(() => validateOnboarding(body, "SCHOOL"), invalid);
});

void test("supplier supports multiple optional certificates with unique numbers, required type/number and real calendar dates", () => {
  const minimal = validateOnboarding({ name: "Supplier" }, "SUPPLIER");
  assert.deepEqual(
    "certifications" in minimal.profileData &&
      minimal.profileData.certifications,
    [],
  );
  const full = validateOnboarding(
    {
      name: "Supplier",
      certifications: [
        certification,
        {
          ...certification,
          certificateNo: "ATTP-002",
          issuedDate: null,
          expiryDate: null,
        },
      ],
    },
    "SUPPLIER",
  );
  assert.equal(
    "certifications" in full.profileData &&
      full.profileData.certifications.length,
    2,
  );
  for (const certificates of [
    [{ certificateNo: "A" }],
    [{ certificationType: "ATTP" }],
    [certification, certification],
    [{ ...certification, issuedDate: "2025-02-29" }],
    [{ ...certification, issuedDate: "2026-12-32" }],
    [{ ...certification, issuedDate: "0000-01-01" }],
    [{ ...certification, expiryDate: "2023-01-01" }],
    [{ ...certification, documentUrl: "https://attacker.test" }],
    Array.from({ length: 21 }, (_, i) => ({
      ...certification,
      certificateNo: String(i),
    })),
  ])
    assert.throws(
      () =>
        validateOnboarding(
          { name: "A", certifications: certificates },
          "SUPPLIER",
        ),
      invalid,
    );
  assert.doesNotThrow(() =>
    validateOnboarding(
      {
        name: "A",
        certifications: [
          { ...certification, expiryDate: certification.issuedDate },
        ],
      },
      "SUPPLIER",
    ),
  );
});

void test("profile files are bounded and bound to one actual certificate; stored metadata cannot point at another account", () => {
  const profile = validateOnboarding(
    { name: "A", certifications: [certification] },
    "SUPPLIER",
  );
  assert.doesNotThrow(() =>
    validateProfileFiles([file("certificate_0")], profile),
  );
  assert.doesNotThrow(() =>
    validateProfileFiles(
      [file("certificate_0"), file("certificate_0")],
      profile,
    ),
  );
  assert.doesNotThrow(() =>
    validateProfileFiles(
      [file("legalDocument"), file("legalDocument")],
      validateOnboarding({ name: "School" }, "SCHOOL"),
    ),
  );
  for (const files of [
    [file("legalDocument")],
    [file("certificate_1")],
    Array.from({ length: MAX_PROFILE_DOCUMENTS + 1 }, () =>
      file("certificate_0"),
    ),
    [file("certificate_0", "application/pdf", "<html>fake PDF</html>")],
  ])
    assert.throws(() => validateProfileFiles(files, profile), invalid);
  assert.throws(
    () =>
      documentFormat({
        ...file("legalDocument"),
        size: MAX_DOCUMENT_BYTES + 1,
      }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 413,
  );
  const userId = randomUUID(),
    id = randomUUID();
  const metadata = {
    id,
    field: "legalDocument",
    publicId: `foodprint/onboarding/${userId}/${id}.pdf`,
    format: "pdf",
    fileName: "a.pdf",
    bytes: 12,
  };
  assert.deepEqual(readDocuments([metadata], userId), [metadata]);
  assert.throws(
    () => readDocuments([metadata], randomUUID()),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
});

void test("multipart receives per-certificate files, enforces CSRF and rejects bad JSON, wrong MIME and oversized files", async (context) => {
  const app = express();
  app.use(createCsrfProtection("http://localhost:3001"));
  app.post("/submit", onboardingUpload, (req, res, next) => {
    try {
      const profile = validateOnboarding(
        readProfileBody(req.body as unknown, true),
        "SUPPLIER",
      );
      const files = Array.isArray(req.files) ? req.files : [];
      validateProfileFiles(files, profile);
      res.json({
        count: files.length,
        fields: files.map((item) => item.fieldname),
      });
    } catch (error) {
      next(error);
    }
  });
  app.use(globalErrorHandler);
  context.mock.method(console, "error", () => undefined);
  const http = await startHttp(app);
  context.after(() => http.close());
  function body(
    content = JSON.stringify({
      name: "A",
      certifications: [
        certification,
        { ...certification, certificateNo: "ATTP-002" },
      ],
    }),
  ) {
    const form = new FormData();
    form.set("profile", content);
    return form;
  }
  const form = body();
  form.set(
    "certificate_0",
    new Blob(["%PDF-1.7\nfirst"], { type: "application/pdf" }),
    "first.pdf",
  );
  form.set(
    "certificate_1",
    new Blob(["%PDF-1.7\nsecond"], { type: "application/pdf" }),
    "second.pdf",
  );
  form.append(
    "certificate_0",
    new Blob(["%PDF-1.7\nextra"], { type: "application/pdf" }),
    "extra.pdf",
  );
  const response = await http.request("/submit", {
    method: "POST",
    headers: { "X-CSRF-Protection": "1" },
    body: form,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    count: 3,
    fields: ["certificate_0", "certificate_1", "certificate_0"],
  });
  for (const count of [MAX_PROFILE_DOCUMENTS, MAX_PROFILE_DOCUMENTS + 1]) {
    const many = body();
    for (let index = 0; index < count; index++)
      many.append(
        "certificate_0",
        new Blob(["%PDF-1.7\nmulti-file boundary"], {
          type: "application/pdf",
        }),
        `${index}.pdf`,
      );
    const result = await http.request("/submit", {
      method: "POST",
      headers: { "X-CSRF-Protection": "1" },
      body: many,
    });
    assert.equal(result.status, count === MAX_PROFILE_DOCUMENTS ? 200 : 400);
  }
  assert.equal(
    (await http.request("/submit", { method: "POST", body: body() })).status,
    403,
  );
  assert.equal(
    (
      await http.request("/submit", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
        body: body("{"),
      })
    ).status,
    400,
  );
  const wrong = body();
  wrong.set(
    "certificate_0",
    new Blob(["<script>bad</script>"], { type: "text/html" }),
    "bad.html",
  );
  assert.equal(
    (
      await http.request("/submit", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
        body: wrong,
      })
    ).status,
    400,
  );
  const large = body();
  large.set(
    "certificate_0",
    new Blob([Buffer.alloc(MAX_DOCUMENT_BYTES + 1)], {
      type: "application/pdf",
    }),
    "large.pdf",
  );
  assert.equal(
    (
      await http.request("/submit", {
        method: "POST",
        headers: { "X-CSRF-Protection": "1" },
        body: large,
      })
    ).status,
    413,
  );
});

// These service tests inject a transaction/database and storage adapter; no real database or uploads.
import { createOnboardingService } from "../src/modules/auth/onboarding.service";
import { readSubmission } from "../src/modules/auth/onboarding-submission";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { SessionUser } from "../src/types/session-user";
import type {
  OnboardingDocument,
  DocumentStorage,
} from "../src/utils/onboarding-documents";

function editFixture(
  status: "PENDING" | "REJECTED" | "APPROVED" | null = "PENDING",
) {
  const userId = randomUUID(),
    requestId = randomUUID(),
    documentId = randomUUID(),
    wardId = randomUUID(),
    inactiveWardId = randomUUID();
  const wards = new Map([
    [
      wardId,
      { id: wardId, code: "W-01", name: "Phường 1", level: 2, isActive: true },
    ],
    [
      inactiveWardId,
      {
        id: inactiveWardId,
        code: "W-02",
        name: "Phường 2",
        level: 2,
        isActive: false,
      },
    ],
  ]);
  const version = new Date("2026-10-31T08:00:00.000Z");
  const document: OnboardingDocument = {
    id: documentId,
    field: "certificate_1",
    publicId: `foodprint/onboarding/${userId}/${documentId}.pdf`,
    format: "pdf",
    fileName: "old.pdf",
    bytes: 12,
  };
  const row = {
    id: requestId,
    code: "FP-REG-00001",
    applicantUserId: userId,
    requestType: "SUPPLIER",
    status: status ?? "PENDING",
    profileData: {
      name: "Supplier",
      certifications: [{ certificationType: "ISO", certificateNo: "ISO-2" }],
    },
    supportingDocuments: [document],
    submittedAt: version,
    updatedAt: version,
    reviewedAt: null,
    rejectionReason: status === "REJECTED" ? "Bổ sung thông tin" : null,
  };
  const user: SessionUser = {
    id: userId,
    username: "applicant",
    fullName: "Applicant",
    email: "applicant@example.test",
    phone: null,
    roleId: randomUUID(),
    role: "INGREDIENT_SUPPLIER_ADMIN",
    orgType: "SUPPLIER",
    status: "UNVERIFIED",
    onboardingRequired: true,
    schoolId: null,
    supplierId: null,
    communeFoodSafetyUnitId: null,
    registrationRequest: null,
    emailVerifiedAt: version,
  };
  const removed: string[] = [],
    uploaded: string[] = [];
  let writes = 0;
  let emailFailure = false;
  const notifications: {
    registrationId: string;
    recipientEmail: string;
    text: string;
  }[] = [];
  // Records proof hooks so these tests never depend on BLOCKCHAIN_ENABLED in .env.
  const proofEvents: { event: string; supportingDocuments?: unknown }[] = [];
  let lastWrite: Record<string, unknown> | null = null;
  const proofs = {
    prepareRegistrationSubmitted: (_tx: unknown, id: string) => {
      proofEvents.push({
        event: `submitted:${id}`,
        supportingDocuments: lastWrite?.supportingDocuments,
      });
      return Promise.resolve({ kind: "registrations" as const, id });
    },
    prepareRegistrationApproved: (_tx: unknown, id: string) => {
      proofEvents.push({ event: `approved:${id}` });
      return Promise.resolve({ kind: "registrations" as const, id });
    },
    scheduleAnchor: (ref: { id: string } | null) => {
      if (ref) proofEvents.push({ event: `scheduled:${ref.id}` });
    },
  };
  const storage: DocumentStorage = {
    upload(_id, file) {
      const id = randomUUID();
      uploaded.push(id);
      return Promise.resolve({
        ...document,
        id,
        field: file.fieldname,
        publicId: `foodprint/onboarding/${userId}/${id}.pdf`,
      });
    },
    remove(document) {
      removed.push(document.id);
      return Promise.resolve();
    },
    download() {
      return "https://example.test/download";
    },
  };
  let codeSequence = 0;
  const tx = {
    // Bộ đếm mã nghiệp vụ trả số thứ tự tăng dần; các truy vấn raw khác (khóa) trả rỗng.
    $queryRaw: (sql: TemplateStringsArray) =>
      Promise.resolve(
        sql.join("").includes("business_code_counters")
          ? [{ lastSequence: ++codeSequence }]
          : [],
      ),
    user: {
      findUnique: () =>
        Promise.resolve({
          ...user,
          Role: { code: user.role, type: user.orgType },
          RegistrationRequestAsApplicantUser: null,
        }),
    },
    location: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          wards.get(where.id as ReturnType<typeof randomUUID>) ?? null,
        ),
    },
    registrationRequest: {
      findUnique: () => Promise.resolve(status ? structuredClone(row) : null),
      findMany: () => Promise.resolve([]),
      create({ data }: { data: Record<string, unknown> }) {
        writes++;
        lastWrite = data;
        return Promise.resolve({ ...row, ...data, updatedAt: new Date() });
      },
      update({ data }: { data: Record<string, unknown> }) {
        assert(!("registrationNumber" in data));
        assert(!("registrationID" in data));
        assert(!("code" in data), "nộp lại/sửa hồ sơ không được đổi mã");
        writes++;
        lastWrite = data;
        return Promise.resolve({ ...row, ...data, updatedAt: new Date() });
      },
    },
    emailOutbox: {
      create({
        data,
      }: {
        data: { registrationId: string; recipientEmail: string; text: string };
      }) {
        if (emailFailure)
          return Promise.reject(new Error("Outbox unavailable"));
        notifications.push(data);
        return Promise.resolve({ id: randomUUID(), status: "PENDING" });
      },
    },
  };
  const db = {
    $transaction: (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
  } as unknown as PrismaClient;
  return {
    row,
    user,
    document,
    wardId,
    inactiveWardId,
    removed,
    uploaded,
    notifications,
    failEmail: () => {
      emailFailure = true;
    },
    storage,
    proofEvents,
    writes: () => writes,
    service: {
      ...createOnboardingService(() => Promise.resolve(db), storage, proofs),
      submit(
        actor: SessionUser,
        body: unknown,
        files: Express.Multer.File[] = [],
      ) {
        return createOnboardingService(
          () => Promise.resolve(db),
          storage,
          proofs,
        ).submit(
          actor,
          // Mặc định chọn phường/xã đang hoạt động; test có thể ghi đè `locationId`.
          readSubmission(
            { locationId: wardId, ...(body as Record<string, unknown>) },
            actor.orgType === "SCHOOL" ? "SCHOOL" : "SUPPLIER",
          ),
          files,
        );
      },
    },
  };
}
const retainedBody = (fixture: ReturnType<typeof editFixture>) => ({
  name: "Updated supplier",
  certifications: [{ certificationType: "ISO", certificateNo: "ISO-2" }],
  retainedDocuments: [{ id: fixture.document.id, field: "certificate_0" }],
  expectedUpdatedAt: fixture.row.updatedAt.toISOString(),
});

void test("pending edits keep the same application and remap retained certificate documents without reuploading", async () => {
  const fixture = editFixture();
  const result = await fixture.service.submit(
    fixture.user,
    retainedBody(fixture),
  );
  assert.equal(result.id, fixture.row.id);
  assert.equal(result.registrationID, "FP-REG-00001");
  assert.equal(result.status, "PENDING");
  assert.equal(result.profileData.name, "Updated supplier");
  assert.deepEqual(
    result.documents.map(({ id, field }) => ({ id, field })),
    [{ id: fixture.document.id, field: "certificate_0" }],
  );
  assert.equal(fixture.writes(), 1);
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual(fixture.uploaded, []);
  assert.equal(fixture.notifications.length, 0);
});

void test("rejected edits still clear review outcomes and preserve selected stored files", async () => {
  const fixture = editFixture("REJECTED");
  const result = await fixture.service.submit(
    fixture.user,
    retainedBody(fixture),
  );
  assert.equal(result.status, "PENDING");
  assert.equal(result.rejectionReason, null);
  assert.equal(result.reviewedAt, null);
  assert.deepEqual(fixture.removed, []);
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0]?.registrationId, fixture.row.id);
});

void test("first submission queues one email to the freshly loaded account rather than the form or stale session", async () => {
  const fixture = editFixture(null);
  const result = await fixture.service.submit(
    { ...fixture.user, email: "old-session@example.test" },
    {
      name: "Supplier",
      email: "organization@example.test",
      certifications: [],
    },
  );
  assert.equal(result.status, "PENDING");
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0]?.recipientEmail, fixture.user.email);
  assert.match(result.registrationID, /^FP-RG-[0-9]{5}$/);
  assert.notEqual(result.registrationID, "FP-RG-00001");
  assert.match(
    fixture.notifications[0]?.text ?? "",
    new RegExp(result.registrationID),
  );
});

void test("submission outbox failure rejects the transaction and cleans only newly uploaded files", async () => {
  const fixture = editFixture("REJECTED");
  fixture.failEmail();
  await assert.rejects(
    fixture.service.submit(fixture.user, retainedBody(fixture), [
      file("certificate_0"),
    ]),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  assert.deepEqual(fixture.removed, fixture.uploaded);
  assert.equal(fixture.notifications.length, 0);
  assert.ok(!fixture.removed.includes(fixture.document.id));
});

void test("school first submission also queues a pending confirmation without creating an organization", async () => {
  const fixture = editFixture(null);
  fixture.user.orgType = "SCHOOL";
  fixture.user.role = "SCHOOL_ADMINISTRATION";
  fixture.row.requestType = "SCHOOL";
  const result = await fixture.service.submit(fixture.user, { name: "School" });
  assert.equal(result.requestType, "SCHOOL");
  assert.equal(result.accountStatus, "UNVERIFIED");
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.notifications[0]?.recipientEmail, fixture.user.email);
});

void test("foreign document IDs and stale form versions fail before any upload or write", async () => {
  for (const mutation of [
    { retainedDocuments: [{ id: randomUUID(), field: "certificate_0" }] },
    { expectedUpdatedAt: "2026-10-30T08:00:00.000Z" },
    { expectedUpdatedAt: undefined },
  ]) {
    const fixture = editFixture();
    await assert.rejects(
      fixture.service.submit(fixture.user, {
        ...retainedBody(fixture),
        ...mutation,
      }),
      (error: unknown) =>
        error instanceof HttpError && [400, 409].includes(error.statusCode),
    );
    assert.equal(fixture.writes(), 0);
    assert.deepEqual(fixture.uploaded, []);
    assert.deepEqual(fixture.removed, []);
  }
});

void test("approved applications remain immutable and pending edits append multiple files alongside retained files", async () => {
  const fixture = editFixture("APPROVED");
  await assert.rejects(
    fixture.service.submit(fixture.user, retainedBody(fixture)),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(fixture.writes(), 0);
  const pending = editFixture();
  const result = await pending.service.submit(
    pending.user,
    retainedBody(pending),
    [file("certificate_0"), file("certificate_0")],
  );
  assert.equal(result.documents.length, 3);
  assert(
    result.documents.some((document) => document.id === pending.document.id),
  );
  assert.equal(pending.writes(), 1);
  assert.equal(pending.uploaded.length, 2);
  assert.deepEqual(pending.removed, []);
});

void test("submissions store each new file's SHA-256 and anchor the proof only after commit", async () => {
  const pending = editFixture();
  const upload = file("certificate_0");
  await pending.service.submit(pending.user, retainedBody(pending), [upload]);
  const [prepared, scheduled] = pending.proofEvents;
  assert.equal(prepared?.event, `submitted:${pending.row.id}`);
  assert.equal(scheduled?.event, `scheduled:${pending.row.id}`);
  const stored = prepared?.supportingDocuments as OnboardingDocument[];
  assert.equal(
    stored.find((document) => document.id !== pending.document.id)?.sha256,
    createHash("sha256").update(upload.buffer).digest("hex"),
  );
  // Documents uploaded before proofs existed keep no hash rather than a guessed one.
  assert.equal(
    stored.find((document) => document.id === pending.document.id)?.sha256,
    undefined,
  );

  const failing = editFixture("REJECTED");
  failing.failEmail();
  await assert.rejects(() =>
    failing.service.submit(failing.user, retainedBody(failing)),
  );
  assert.deepEqual(failing.proofEvents, []);
});

void test("retained plus new document limits are checked before uploads or writes", async () => {
  const fixture = editFixture();
  await assert.rejects(
    () =>
      fixture.service.submit(
        fixture.user,
        retainedBody(fixture),
        Array.from({ length: MAX_PROFILE_DOCUMENTS }, () =>
          file("certificate_0"),
        ),
      ),
    invalid,
  );
  assert.deepEqual(fixture.uploaded, []);
  assert.equal(fixture.writes(), 0);
  assert.deepEqual(fixture.removed, []);
});

void test("several distinct retained files can share a certificate field", () => {
  const ids = [randomUUID(), randomUUID()];
  const result = readSubmission(
    {
      name: "Supplier",
      locationId: randomUUID(),
      certifications: [{ certificationType: "ISO", certificateNo: "ISO" }],
      retainedDocuments: ids.map((id) => ({ id, field: "certificate_0" })),
    },
    "SUPPLIER",
  );
  assert.equal(result.retained.length, 2);
});

void test("explicitly removed documents are cleaned after the replacement commits", async () => {
  const fixture = editFixture();
  const result = await fixture.service.submit(fixture.user, {
    name: "Updated",
    certifications: [],
    retainedDocuments: [],
    expectedUpdatedAt: fixture.row.updatedAt.toISOString(),
  });
  assert.deepEqual(result.documents, []);
  assert.deepEqual(fixture.removed, [fixture.document.id]);
  assert.equal(fixture.writes(), 1);
});

void test("a concurrent update during upload rejects the edit and cleans only its newly uploaded asset", async () => {
  const fixture = editFixture();
  const upload = fixture.storage.upload.bind(fixture.storage);
  fixture.storage.upload = async (...args) => {
    const result = await upload(...args);
    fixture.row.updatedAt = new Date(fixture.row.updatedAt.getTime() + 1);
    return result;
  };
  await assert.rejects(
    fixture.service.submit(
      fixture.user,
      { ...retainedBody(fixture), retainedDocuments: [] },
      [file("certificate_0")],
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 409,
  );
  assert.equal(fixture.writes(), 0);
  assert.deepEqual(fixture.removed, fixture.uploaded);
  assert(!fixture.removed.includes(fixture.document.id));
});

void test("edit metadata cannot inject storage URLs, duplicate IDs/fields, wrong certificate indexes or invalid versions", () => {
  const id = randomUUID();
  for (const retainedDocuments of [
    [{ id, field: "certificate_1" }],
    [{ id, field: "certificate_0", publicId: "attacker" }],
    [
      { id, field: "certificate_0" },
      { id, field: "certificate_0" },
    ],
  ])
    assert.throws(
      () =>
        readSubmission(
          {
            name: "Supplier",
            certifications: [
              { certificationType: "ISO", certificateNo: "ISO" },
            ],
            retainedDocuments,
          },
          "SUPPLIER",
        ),
      invalid,
    );
  assert.throws(
    () =>
      readSubmission(
        { name: "School", expectedUpdatedAt: "invalid" },
        "SCHOOL",
      ),
    invalid,
  );
  assert.throws(
    () => readSubmission({ name: "School", status: "APPROVED" }, "SCHOOL"),
    invalid,
  );
});

void test("registration codes cannot be assigned at any strict input depth and errors never reflect values", () => {
  for (const key of ["registrationID", "registrationNumber"]) {
    for (const [body, expectedPath] of [
      [{ name: "Supplier", [key]: "private-marker" }, key],
      [
        {
          name: "Supplier",
          certifications: [
            {
              certificationType: "ISO",
              certificateNo: "ISO",
              [key]: "private-marker",
            },
          ],
        },
        "certifications.0." + key,
      ],
      [
        {
          name: "Supplier",
          certifications: [{ certificationType: "ISO", certificateNo: "ISO" }],
          retainedDocuments: [
            {
              id: randomUUID(),
              field: "certificate_0",
              [key]: "private-marker",
            },
          ],
        },
        "retainedDocuments.0." + key,
      ],
    ] as const) {
      assert.throws(
        () => readSubmission(body, "SUPPLIER"),
        (error: unknown) => {
          assert(error instanceof RequestValidationError);
          assert(error.fields.some((issue) => issue.field === expectedPath));
          assert(!JSON.stringify(error.fields).includes("private-marker"));
          return true;
        },
      );
    }
    assert.throws(
      () =>
        readProfileBody(
          {
            profile: JSON.stringify({ name: "Supplier" }),
            [key]: "private-marker",
          },
          true,
        ),
      invalid,
    );
    assert.throws(
      () =>
        readSubmission(
          readProfileBody(
            {
              profile: JSON.stringify({
                name: "Supplier",
                [key]: "private-marker",
              }),
            },
            true,
          ),
          "SUPPLIER",
        ),
      invalid,
    );
  }
  assert.throws(
    () =>
      readSubmission(
        {
          name: "",
          certifications: [
            {
              certificationType: "",
              certificateNo: "",
              registrationID: "private-marker",
            },
          ],
        },
        "SUPPLIER",
      ),
    (error: unknown) => {
      assert(error instanceof RequestValidationError);
      assert(error.fields.length >= 4);
      assert(!JSON.stringify(error.fields).includes("private-marker"));
      return true;
    },
  );
  assert.doesNotThrow(() =>
    readSubmission(
      { name: "registrationID is ordinary text", locationId: randomUUID() },
      "SUPPLIER",
    ),
  );
});

void test("HTTP rejects code assignment in JSON and multipart before any database access or cloud upload", async (context) => {
  context.mock.method(console, "error", () => undefined);
  const fixture = editFixture();
  let reads = 0;
  const service = createOnboardingService(() => {
    reads++;
    return Promise.reject(new Error("must not access database"));
  }, fixture.storage);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.sessionUser = fixture.user;
    next();
  });
  app.post("/", onboardingUpload, createOnboardingController(service).submit);
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  context.after(() => http.close());
  const json = await http.request("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Supplier",
      registrationID: "private-marker",
    }),
  });
  assert.equal(json.status, 400);
  assert(!JSON.stringify(json.body).includes("private-marker"));
  for (const outer of [true, false]) {
    const form = new FormData();
    form.append(
      "profile",
      JSON.stringify({
        name: "Supplier",
        certifications: [{ certificationType: "ISO", certificateNo: "ISO" }],
        ...(outer ? {} : { registrationID: "private-marker" }),
      }),
    );
    if (outer) form.append("registrationID", "private-marker");
    form.append(
      "certificate_0",
      new Blob(["%PDF-1.7 local"], { type: "application/pdf" }),
      "test.pdf",
    );
    const response = await http.request("/", { method: "POST", body: form });
    assert.equal(response.status, 400);
    assert(!JSON.stringify(response.body).includes("private-marker"));
  }
  assert.equal(reads, 0);
  assert.deepEqual(fixture.uploaded, []);
  assert.equal(fixture.writes(), 0);
});

void test("submission requires an active ward, stores it in the profile and returns the ward", async () => {
  const fixture = editFixture(null);
  const body = {
    name: "Supplier",
    certifications: [],
  };
  // Thiếu phường/xã bị chặn ở bước kiểm tra đầu vào (đồng bộ), trước mọi truy cập DB.
  assert.throws(
    () => fixture.service.submit(fixture.user, { ...body, locationId: null }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((issue) => issue.field === "locationId"),
  );
  await assert.rejects(
    fixture.service.submit(fixture.user, {
      ...body,
      locationId: fixture.inactiveWardId,
    }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((issue) => issue.field === "locationId"),
  );
  await assert.rejects(
    fixture.service.submit(fixture.user, {
      ...body,
      locationId: randomUUID(),
    }),
    (error: unknown) =>
      error instanceof RequestValidationError &&
      error.fields.some((issue) => issue.field === "locationId"),
  );
  assert.equal(fixture.writes(), 0);
  const result = await fixture.service.submit(fixture.user, body);
  assert.equal(result.profileData.locationId, fixture.wardId);
  assert.deepEqual(result.location, {
    id: fixture.wardId,
    code: "W-01",
    name: "Phường 1",
  });
});

// ---------------------------------------------------------------------------
// Unit test cho OnboardingService.submit theo ma trận UTCID (Condition/Confirm/Result).
// Precondition chung: tài khoản UNVERIFIED chưa thuộc tổ chức, phường/xã đang hoạt động
// được chọn mặc định; `editFixture(null)` = chưa có hồ sơ (nộp lần đầu).
// ---------------------------------------------------------------------------
const supplierBody = (extra: Record<string, unknown> = {}) => ({
  name: "Công ty Thực phẩm ABC",
  email: "lienhe@abc.vn",
  certifications: [],
  ...extra,
});
const certificate = (no: string) => ({
  certificationType: "VSATTP",
  certificateNo: no,
  issuedDate: "2026-01-01",
  expiryDate: "2027-01-01",
});
const validationError = (field: string, message?: string) => (error: unknown) =>
  error instanceof RequestValidationError &&
  error.fields.some(
    (issue) =>
      issue.field === field &&
      (message === undefined || issue.message === message),
  );
const httpError = (statusCode: number, message: string) => (error: unknown) =>
  error instanceof HttpError &&
  error.statusCode === statusCode &&
  error.message === message;

void test("UTCID01 [N] submit: nhà cung cấp nộp lần đầu hợp lệ → PENDING, cấp mã FP-RG, gửi 1 email", async () => {
  const fixture = editFixture(null);
  const result = await fixture.service.submit(fixture.user, supplierBody());
  assert.equal(result.requestType, "SUPPLIER");
  assert.equal(result.status, "PENDING");
  assert.equal(result.accountStatus, "UNVERIFIED");
  assert.match(result.registrationID, /^FP-RG-[0-9]{5}$/);
  assert.equal(result.profileData.email, "lienhe@abc.vn");
  assert.equal(fixture.notifications.length, 1);
  assert.equal(fixture.writes(), 1);
});

void test("UTCID02 [N] submit: trường học nộp lần đầu hợp lệ → PENDING, requestType SCHOOL", async () => {
  const fixture = editFixture(null);
  fixture.user.orgType = "SCHOOL";
  fixture.user.role = "SCHOOL_ADMINISTRATION";
  fixture.row.requestType = "SCHOOL";
  const result = await fixture.service.submit(fixture.user, {
    name: "Trường Tiểu học A",
    code: "TH-A",
  });
  assert.equal(result.requestType, "SCHOOL");
  assert.equal(result.status, "PENDING");
  assert.equal(fixture.notifications.length, 1);
});

void test("UTCID03 [N] submit: nhà cung cấp kèm 1 chứng nhận hợp lệ → lưu chứng nhận", async () => {
  const fixture = editFixture(null);
  const result = await fixture.service.submit(
    fixture.user,
    supplierBody({ certifications: [certificate("VS-001")] }),
  );
  assert.equal(result.status, "PENDING");
  assert.deepEqual(
    (result.profileData as { certifications: unknown[] }).certifications,
    [certificate("VS-001")],
  );
});

void test("UTCID04 [B] submit: tên dài đúng 255 ký tự → hợp lệ", async () => {
  const fixture = editFixture(null);
  const name = "A".repeat(255);
  const result = await fixture.service.submit(
    fixture.user,
    supplierBody({ name }),
  );
  assert.equal(result.profileData.name, name);
});

void test("UTCID05 [B] submit: tên dài 256 ký tự → lỗi 'Trường chỉ nhận tối đa 255 ký tự'", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(
        fixture.user,
        supplierBody({ name: "A".repeat(256) }),
      ),
    validationError("name", "Trường chỉ nhận tối đa 255 ký tự"),
  );
  assert.equal(fixture.writes(), 0);
});

void test("UTCID06 [A] submit: tên chỉ có khoảng trắng → lỗi 'Trường không được để trống'", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(fixture.user, supplierBody({ name: "   " })),
    validationError("name", "Trường không được để trống"),
  );
  assert.equal(fixture.writes(), 0);
});

void test("UTCID07 [A] submit: không chọn phường/xã → lỗi 'Vui lòng chọn phường/xã'", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(fixture.user, supplierBody({ locationId: null })),
    validationError("locationId", "Vui lòng chọn phường/xã"),
  );
  assert.equal(fixture.writes(), 0);
});

void test("UTCID08 [A] submit: phường/xã đã ngừng hoạt động → lỗi 'Địa bàn phải là phường/xã đang hoạt động'", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(
        fixture.user,
        supplierBody({ locationId: fixture.inactiveWardId }),
      ),
    validationError("locationId", "Địa bàn phải là phường/xã đang hoạt động"),
  );
  assert.equal(fixture.writes(), 0);
});

void test("UTCID09 [A] submit: email sai định dạng → lỗi 'Email liên hệ không hợp lệ'", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(fixture.user, supplierBody({ email: "abc" })),
    validationError("email", "Email liên hệ không hợp lệ"),
  );
});

void test("UTCID10 [A] submit: trùng số chứng nhận → lỗi 'Số chứng nhận không được trùng trong hồ sơ'", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(
        fixture.user,
        supplierBody({
          certifications: [certificate("VS-001"), certificate("VS-001")],
        }),
      ),
    validationError(
      "certifications.1.certificateNo",
      "Số chứng nhận không được trùng trong hồ sơ",
    ),
  );
});

void test("UTCID11 [B] submit: đúng 20 chứng nhận (tối đa) → hợp lệ", async () => {
  const fixture = editFixture(null);
  const certifications = Array.from({ length: 20 }, (_, index) =>
    certificate(`VS-${index}`),
  );
  const result = await fixture.service.submit(
    fixture.user,
    supplierBody({ certifications }),
  );
  assert.equal(
    (result.profileData as { certifications: unknown[] }).certifications.length,
    20,
  );
});

void test("UTCID12 [B] submit: 21 chứng nhận → lỗi 'Chứng nhận chỉ nhận tối đa 20 mục'", async () => {
  const fixture = editFixture(null);
  const certifications = Array.from({ length: 21 }, (_, index) =>
    certificate(`VS-${index}`),
  );
  await assert.rejects(
    async () =>
      fixture.service.submit(fixture.user, supplierBody({ certifications })),
    validationError("certifications", "Chứng nhận chỉ nhận tối đa 20 mục"),
  );
});

void test("UTCID13 [A] submit: tài khoản đã ACTIVE (không phải UNVERIFIED) → 403", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(
        // Ép kiểu có chủ đích: mô phỏng tài khoản đã kích hoạt gọi nhầm luồng nộp hồ sơ.
        { ...fixture.user, status: "ACTIVE" } as unknown as SessionUser,
        supplierBody(),
      ),
    httpError(403, "Chỉ tài khoản chưa xác minh được nộp hồ sơ."),
  );
  assert.equal(fixture.writes(), 0);
});

void test("UTCID14 [A] submit: tài khoản đã thuộc một tổ chức → 409", async () => {
  const fixture = editFixture(null);
  await assert.rejects(
    async () =>
      fixture.service.submit(
        { ...fixture.user, supplierId: randomUUID() },
        supplierBody(),
      ),
    httpError(409, "Tài khoản đã thuộc một tổ chức."),
  );
  assert.equal(fixture.writes(), 0);
});

void test("UTCID15 [A] submit: đã có hồ sơ PENDING nhưng không gửi expectedUpdatedAt → 409", async () => {
  const fixture = editFixture("PENDING");
  await assert.rejects(
    async () => fixture.service.submit(fixture.user, supplierBody()),
    httpError(409, "Hồ sơ đã thay đổi; tải lại trước khi chỉnh sửa"),
  );
  assert.equal(fixture.writes(), 0);
  assert.equal(fixture.notifications.length, 0);
});

void test("UTCID16 [A] submit: hồ sơ đã APPROVED → 409 không được chỉnh sửa", async () => {
  const fixture = editFixture("APPROVED");
  await assert.rejects(
    async () =>
      fixture.service.submit(fixture.user, {
        ...supplierBody(),
        expectedUpdatedAt: fixture.row.updatedAt.toISOString(),
      }),
    httpError(409, "Hồ sơ đã được duyệt và không còn được chỉnh sửa"),
  );
  assert.equal(fixture.writes(), 0);
});
