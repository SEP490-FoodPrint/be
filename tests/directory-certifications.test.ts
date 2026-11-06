import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import type { AuthPrincipal } from "../src/types/auth";
import {
  createSupplierCertificationService,
  resolveCertificationDocuments,
} from "../src/modules/supplier-certification/supplier-certification.service";
import type { CertificateApplication } from "../src/modules/supplier-certification/supplier-certification.repository";
import { HttpError } from "../src/utils/http-error";
const applicant = "11111111-1111-4111-8111-111111111111";
const appId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const sibling = "44444444-4444-4444-8444-444444444444";
const other = "55555555-5555-4555-8555-555555555555";
function file(id: string, field = "certificate_0") {
  return {
    id,
    field,
    publicId: `foodprint/onboarding/${applicant}/${id}.pdf`,
    format: "pdf",
    fileName: "Giấy chứng nhận.pdf",
    bytes: 100,
  };
}
const application: CertificateApplication = {
  id: appId,
  applicantUserId: applicant,
  profileData: { certifications: [{}, {}] },
  supportingDocuments: [
    file(fileId),
    file(sibling),
    file(other, "certificate_1"),
  ],
};
const url = `/api/registration-requests/${appId}/documents/${fileId}`;
const principal: AuthPrincipal = {
  id: applicant,
  username: "admin",
  fullName: "Admin",
  roleId: appId,
  role: "SYSTEM_ADMIN",
  orgType: "SYSTEM",
  schoolId: null,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["supplier_certification.view"],
};
void test("certificate anchor resolves siblings only, never another certificate group", () => {
  assert.deepEqual(
    resolveCertificationDocuments(url, application).map((d) => d.id),
    [fileId, sibling],
  );
});
void test("certificate metadata fails closed for missing or external anchor and invalid metadata", () => {
  for (const target of [
    null,
    "https://outside.example/file",
    url + "?x=1",
    url.replace(fileId, other + "x"),
  ])
    assert.deepEqual(resolveCertificationDocuments(target, application), []);
  assert.deepEqual(resolveCertificationDocuments(url, undefined), []);
  for (const documents of [
    [file(fileId), file(fileId)],
    [{ ...file(fileId), bytes: -1 }],
    [{ ...file(fileId), publicId: "other" }],
  ])
    assert.deepEqual(
      resolveCertificationDocuments(url, {
        ...application,
        supportingDocuments: documents,
      }),
      [],
    );
  assert.deepEqual(
    resolveCertificationDocuments(url, {
      ...application,
      profileData: { certifications: [] },
    }),
    [],
  );
});
void test("file access needs certificate permission before touching persistence", async () => {
  const service = createSupplierCertificationService();
  await assert.rejects(
    service.document(
      { id: appId, documentId: fileId },
      { ...principal, permissions: ["registration.view"] },
    ),
    (e: unknown) => e instanceof HttpError && e.statusCode === 403,
  );
});
void test("file access signs outside transaction and excludes wrong certificate sibling", async () => {
  let inTransaction = false;
  let calls = 0;
  const row = {
    id: appId,
    supplierId: applicant,
    certificationType: "ATTP",
    certificateNo: "001",
    issuedDate: null,
    expiryDate: null,
    status: "ACTIVE" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    documentUrl: url,
  };
  const repository = {
    legacy: () => Promise.resolve([]),
    parent: () => Promise.resolve({ id: applicant }),
    page: () => Promise.resolve({ items: [row], total: 1 }),
    find: () => Promise.resolve(row),
    applications: () => Promise.resolve([application]),
  };
  const storage = {
    upload: () => Promise.reject(new Error("unused")),
    remove: () => Promise.resolve(),
    download: () => {
      assert.equal(inTransaction, false);
      calls++;
      return "https://signed.example/temporary";
    },
  };
  const run = async <T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => {
    inTransaction = true;
    try {
      return await operation({} as Prisma.TransactionClient);
    } finally {
      inTransaction = false;
    }
  };
  const service = createSupplierCertificationService(
    undefined,
    repository,
    undefined,
    storage,
    run,
  );
  assert.deepEqual(
    await service.document({ id: appId, documentId: sibling }, principal),
    { url: "https://signed.example/temporary", expiresIn: 60 },
  );
  await assert.rejects(
    service.document({ id: appId, documentId: other }, principal),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
  assert.equal(calls, 1);
  const page = await service.getBySupplier(
    { supplierId: applicant },
    { page: 1, limit: 5 },
    principal,
  );
  assert.equal(page.items[0]?.documents.length, 2);
  assert.equal(JSON.stringify(page).includes("publicId"), false);
  assert.equal(JSON.stringify(page).includes("documentUrl"), false);
});
