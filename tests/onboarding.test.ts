import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import express from "express";
import { randomUUID } from "node:crypto";
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

function editFixture(status: "PENDING" | "REJECTED" | "APPROVED" = "PENDING") {
  const userId = randomUUID(),
    requestId = randomUUID(),
    documentId = randomUUID();
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
    applicantUserId: userId,
    requestType: "SUPPLIER",
    status,
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
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    user: {
      findUnique: () =>
        Promise.resolve({
          ...user,
          Role: { code: user.role, type: user.orgType },
          RegistrationRequestAsApplicantUser: null,
        }),
    },
    registrationRequest: {
      findUnique: () => Promise.resolve(structuredClone(row)),
      update({ data }: { data: Record<string, unknown> }) {
        writes++;
        return Promise.resolve({ ...row, ...data, updatedAt: new Date() });
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
    removed,
    uploaded,
    storage,
    writes: () => writes,
    service: createOnboardingService(() => Promise.resolve(db), storage),
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
  assert.equal(result.status, "PENDING");
  assert.equal(result.profileData.name, "Updated supplier");
  assert.deepEqual(
    result.documents.map(({ id, field }) => ({ id, field })),
    [{ id: fixture.document.id, field: "certificate_0" }],
  );
  assert.equal(fixture.writes(), 1);
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual(fixture.uploaded, []);
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
