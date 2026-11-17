import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import {
  buildRegistrationApprovedPayload,
  buildRegistrationSubmittedPayload,
  hashPayload,
} from "../src/modules/blockchain-proof/blockchain-proof.payload";
import {
  createBlockchainProofService,
  proofRecordId,
  withDocuments,
  type ProofChain,
} from "../src/modules/blockchain-proof/blockchain-proof.service";
import type { VersionRow } from "../src/modules/blockchain-proof/blockchain-proof.repository";
import { testAdmin, testStaff } from "./helpers/authorization";

const APPLICANT = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const SUPPLIER = "44444444-4444-4444-8444-444444444444";
const DOC_A = "55555555-5555-4555-8555-555555555555";
const DOC_B = "66666666-6666-4666-8666-666666666666";
const at = new Date("2026-11-17T01:02:03.000Z");
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

const license = Buffer.from("%PDF-1.7 business license");
const safety = Buffer.from("%PDF-1.7 food safety certificate");
const doc = (id: string, field: string, data: Buffer | null) => ({
  id,
  field,
  publicId: `foodprint/onboarding/${APPLICANT}/${id}.pdf`,
  format: "pdf",
  fileName: `${field}.pdf`,
  bytes: data?.length ?? 10,
  ...(data ? { sha256: sha(data) } : {}),
});

const admin = {
  ...testAdmin,
  id: ADMIN,
  permissions: ["registration.view", "registration.approve"],
};

type Stored = VersionRow & { snapshot: Prisma.JsonValue };

function harness(options: { enabled?: boolean } = {}) {
  const versions: Stored[] = [];
  const onChain = new Map<string, string>();
  const files = new Map<string, Buffer>([
    [DOC_A, license],
    [DOC_B, safety],
  ]);
  const registration = {
    id: REQUEST,
    requestType: "SUPPLIER",
    status: "PENDING",
    applicantUserId: APPLICANT,
    profileData: {
      name: "NCC Rau Sạch",
      taxCode: "0101234567",
      certifications: [
        { certificationType: "Giấy phép kinh doanh", certificateNo: "GP-1" },
        { certificationType: "Chứng nhận ATTP", certificateNo: "ATTP-9" },
      ],
    } as Prisma.JsonValue,
    supportingDocuments: [
      doc(DOC_B, "certificate_1", safety),
      doc(DOC_A, "certificate_0", license),
    ] as Prisma.JsonValue,
    submittedAt: at,
    reviewedAt: null as Date | null,
    reviewedByUserId: null as string | null,
    applicantUser: {
      schoolId: null as string | null,
      supplierId: null as string | null,
    },
  };
  let nextId = 0;
  const find = (id: string) => versions.find((v) => v.id === id) ?? null;
  const latest = () =>
    versions.length
      ? {
          ...versions[versions.length - 1],
          eventType:
            versions[versions.length - 1].eventType === "REGISTRATION_SUBMITTED"
              ? ("SUBMITTED" as const)
              : ("APPROVED" as const),
        }
      : null;
  const repository = {
    readRegistration: () => Promise.resolve(registration),
    latestRegistrationVersion: () => Promise.resolve(latest()),
    createVersion: (
      _db: unknown,
      subject: { registrationRequestId: string },
      data: Omit<Stored, "eventType"> & { eventType: "SUBMITTED" | "APPROVED" },
    ) => {
      const recordId = subject.registrationRequestId;
      const eventType = data.eventType;
      const id =
        data.id ??
        `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
      versions.push({
        ...data,
        id,
        kind: "registrations",
        recordId,
        eventType: `REGISTRATION_${eventType}`,
        transactionHash: null,
        blockNumber: null,
        transactionStatus: "PREPARED",
        attemptCount: 0,
        lastError: null,
        recordedAt: null,
        verificationStatus: "NOT_VERIFIED",
        verificationResult: null,
        verifiedAt: null,
        createdAt: at,
      });
      return Promise.resolve(id);
    },
    findVersion: (_db: unknown, _kind: string, id: string) =>
      Promise.resolve(find(id)),
    listVersions: () => Promise.resolve([...versions]),
    markSubmitted: (_d: unknown, _k: string, id: string, data: object) => {
      Object.assign(find(id)!, data, { transactionStatus: "SUBMITTED" });
      return Promise.resolve(true);
    },
    markConfirmed: (_d: unknown, _k: string, id: string, data: object) => {
      Object.assign(find(id)!, data, { transactionStatus: "CONFIRMED" });
      return Promise.resolve(true);
    },
    markFailed: (_d: unknown, _k: string, id: string, lastError: string) => {
      Object.assign(find(id)!, { transactionStatus: "FAILED", lastError });
      return Promise.resolve(true);
    },
    setVerification: (_d: unknown, _k: string, id: string, data: object) => {
      Object.assign(find(id)!, data);
      return Promise.resolve();
    },
  };
  let sent = 0;
  const chain: ProofChain = {
    contractAddress: () => "0xRegistry",
    read: (recordId) =>
      Promise.resolve({
        onChainHash: onChain.get(recordId) ?? null,
        contractAddress: "0xRegistry",
      }),
    anchor: async (recordId, dataHash, onSubmitted) => {
      const txHash = `0x${String(++sent).repeat(64)}`;
      await onSubmitted(txHash, "0xRegistry");
      onChain.set(recordId, dataHash);
      return { txHash, blockNumber: 9, contractAddress: "0xRegistry" };
    },
    lookup: () => Promise.resolve({ state: "missing" }),
  };
  const service = createBlockchainProofService({
    connect: () => Promise.resolve({} as never),
    repository: repository as never,
    chain,
    enabled: () => options.enabled ?? true,
    network: () => "sepolia",
    now: () => at,
    warn: () => undefined,
    readDocument: (document) => Promise.resolve(files.get(document.id) ?? null),
  });
  const tx = {} as never;
  async function submit() {
    const ref = await service.prepareRegistrationSubmitted(
      tx,
      REQUEST,
      APPLICANT,
    );
    assert(ref);
    await service.anchorVersion(ref);
    return ref.id;
  }
  async function approve() {
    registration.status = "APPROVED";
    registration.reviewedAt = at;
    registration.reviewedByUserId = ADMIN;
    registration.applicantUser.supplierId = SUPPLIER;
    const ref = await service.prepareRegistrationApproved(tx, REQUEST, ADMIN);
    if (ref) await service.anchorVersion(ref);
    return ref?.id ?? null;
  }
  const verify = (versionId: string) =>
    service.verify({ kind: "registrations", versionId }, admin);
  return {
    service,
    versions,
    onChain,
    files,
    registration,
    submit,
    approve,
    verify,
    tx,
  };
}

void test("submitted payload lists every file by field with its content hash, never the storage path", () => {
  const payload = buildRegistrationSubmittedPayload({
    id: REQUEST,
    requestType: "SCHOOL",
    applicantUserId: APPLICANT,
    profileData: { name: "THCS A", code: "S01" },
    documents: [
      doc(DOC_B, "legalDocument", null),
      doc(DOC_A, "legalDocument", license),
    ],
    submittedAt: at,
    previousHash: null,
  });
  assert.deepEqual(payload.documents, [
    {
      id: DOC_A,
      field: "legalDocument",
      fileName: "legalDocument.pdf",
      format: "pdf",
      bytes: license.length,
      sha256: sha(license),
    },
    {
      id: DOC_B,
      field: "legalDocument",
      fileName: "legalDocument.pdf",
      format: "pdf",
      bytes: 10,
      sha256: null,
    },
  ]);
  assert.equal(payload.submittedAt, at.toISOString());
  assert(!JSON.stringify(payload).includes("foodprint/onboarding"));
  const approved = buildRegistrationApprovedPayload({
    id: REQUEST,
    requestType: "SCHOOL",
    status: "APPROVED",
    reviewedByUserId: ADMIN,
    reviewedAt: at,
    organizationId: SUPPLIER,
    submittedHash: hashPayload(payload),
  });
  assert.equal(approved.type, "REGISTRATION_APPROVED");
  assert.equal(approved.submittedHash, hashPayload(payload));
});

void test("each resubmission adds a linked version and approval closes the chain", async () => {
  const h = harness();
  const first = await h.submit();
  const second = await h.submit();
  const [v1, v2] = h.versions;
  assert.equal(v1?.id, first);
  assert.equal(v1?.version, 1);
  assert.equal(v1?.previousVersionId, null);
  assert.equal(v2?.id, second);
  assert.equal(v2?.version, 2);
  assert.equal(v2?.previousVersionId, first);
  assert.equal(v2?.changeReason, "Nộp lại hồ sơ");
  assert.equal(
    (v2?.snapshot as { previousHash: string }).previousHash,
    v1?.dataHash,
  );
  const approvedId = await h.approve();
  const v3 = h.versions[2];
  assert.equal(v3?.id, approvedId);
  assert.equal(v3?.eventType, "REGISTRATION_APPROVED");
  assert.equal(v3?.previousVersionId, second);
  assert.equal(
    (v3?.snapshot as { submittedHash: string }).submittedHash,
    v2?.dataHash,
  );
  assert.equal(
    (v3?.snapshot as { organizationId: string }).organizationId,
    SUPPLIER,
  );
  assert(h.versions.every((v) => v.transactionStatus === "CONFIRMED"));
  assert.equal(h.onChain.get(proofRecordId(first)), v1?.dataHash);
  // Nothing more is anchored once approved.
  assert.equal(
    await h.service.prepareRegistrationSubmitted(h.tx, REQUEST, APPLICANT),
    null,
  );
  assert.equal(
    await h.service.prepareRegistrationApproved(h.tx, REQUEST, ADMIN),
    null,
  );
});

void test("approval is not anchored for data that was never anchored at submission", async () => {
  const none = harness();
  assert.equal(await none.approve(), null);
  assert.equal(none.versions.length, 0);

  // Resubmitted while anchoring was off: the latest proof no longer matches the data.
  const stale = harness();
  await stale.submit();
  stale.registration.submittedAt = new Date("2026-11-18T00:00:00.000Z");
  assert.equal(await stale.approve(), null);
  assert.equal(stale.versions.length, 1);

  const disabled = harness({ enabled: false });
  assert.equal(
    await disabled.service.prepareRegistrationSubmitted(
      disabled.tx,
      REQUEST,
      APPLICANT,
    ),
    null,
  );
  assert.equal(disabled.versions.length, 0);
});

void test("verify re-hashes every stored file against the anchored submission", async () => {
  const h = harness();
  const id = await h.submit();
  const ok = await h.verify(id);
  assert.equal(ok.verificationStatus, "VERIFIED");
  assert.deepEqual(
    ok.documents?.map((d) => [d.field, d.status]),
    [
      ["certificate_0", "MATCH"],
      ["certificate_1", "MATCH"],
    ],
  );

  h.files.set(DOC_B, Buffer.from("%PDF-1.7 forged certificate"));
  h.files.delete(DOC_A);
  const tampered = await h.verify(id);
  assert.equal(tampered.verificationStatus, "MISMATCH");
  assert.deepEqual(
    tampered.documents?.map((d) => d.status),
    ["MISSING", "MISMATCH"],
  );
  assert.match(
    tampered.verificationResult ?? "",
    /certificate_0\.pdf \(không còn\), certificate_1\.pdf \(đã thay đổi\)/,
  );
  assert.equal(h.versions[0]?.verificationStatus, "MISMATCH");
});

void test("changed registration data is reported by field; approval checks the approved files", async () => {
  const h = harness();
  const submitted = await h.submit();
  const approved = await h.approve();
  assert(approved);
  const ok = await h.verify(approved);
  assert.equal(ok.verificationStatus, "VERIFIED");
  assert.equal(ok.documents?.length, 2);

  (h.registration.profileData as { taxCode: string }).taxCode = "0109999999";
  const changed = await h.verify(submitted);
  assert.equal(changed.verificationStatus, "MISMATCH");
  assert.match(changed.verificationResult ?? "", /profile/);

  h.registration.applicantUser.supplierId = null;
  const moved = await h.verify(approved);
  assert.equal(moved.verificationStatus, "MISMATCH");
  assert.match(moved.verificationResult ?? "", /organizationId/);
});

void test("a superseded submission is checked against its own stored copy, not current files", async () => {
  const h = harness();
  const first = await h.submit();
  await h.submit();
  (h.registration.profileData as { name: string }).name = "Đổi tên";
  const result = await h.verify(first);
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(result.documents, undefined);

  (h.versions[0].snapshot as { applicantUserId: string }).applicantUserId =
    ADMIN;
  const edited = await h.verify(first);
  assert.equal(edited.verificationStatus, "MISMATCH");
});

void test("registration proofs are System Admin only and never visible to school roles", async () => {
  const h = harness();
  const id = await h.submit();
  const school = {
    ...testStaff,
    permissions: ["traceability.view", "traceability.verify"],
  };
  for (const call of [
    () =>
      h.service.listVersions(
        { kind: "registrations", recordId: REQUEST },
        school,
      ),
    () => h.service.verify({ kind: "registrations", versionId: id }, school),
    () => h.service.anchor({ kind: "registrations", versionId: id }, school),
  ])
    await assert.rejects(call, { statusCode: 403 });
  await assert.rejects(
    () =>
      h.service.anchor(
        { kind: "registrations", versionId: id },
        { ...admin, permissions: ["registration.view"] },
      ),
    { statusCode: 403 },
  );
  const rows = await h.service.listVersions(
    { kind: "registrations", recordId: REQUEST },
    { ...admin, permissions: ["registration.view"] },
  );
  assert.deepEqual(
    rows.map((row) => [row.version, row.eventType]),
    [[1, "REGISTRATION_SUBMITTED"]],
  );
});

void test("files without a recorded hash are reported, not silently passed or failed", () => {
  const base = {
    verificationStatus: "VERIFIED" as const,
    verificationResult: "Dữ liệu khớp với bản ghi trên blockchain",
  };
  const result = withDocuments(base, [
    { id: DOC_A, field: "legalDocument", fileName: "a.pdf", status: "MATCH" },
    { id: DOC_B, field: "legalDocument", fileName: "b.pdf", status: "NO_HASH" },
  ]);
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.match(result.verificationResult, /1 tài liệu nộp trước khi có mã băm/);
  const failed = {
    verificationStatus: "FAILED" as const,
    verificationResult: "x",
  };
  assert.equal(withDocuments(failed, []), failed);
});
