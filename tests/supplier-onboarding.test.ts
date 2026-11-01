import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contractIssues,
  intervalsOverlap,
  schoolToday,
  validateDocument,
} from "../src/modules/supplier-onboarding/supplier-onboarding.rules";
import {
  activationPayload,
  contractPayload,
  listQuery,
  orderPayload,
} from "../src/modules/supplier-onboarding/supplier-onboarding.validation";
import { assertContractManager } from "../src/modules/supplier-onboarding/supplier-onboarding.service";
import { testStaff } from "./helpers/authorization";

const id = "00000000-0000-4000-8000-000000000001";
const today = schoolToday();
const tomorrow = new Date(today.getTime() + 86400000);
const yesterday = new Date(today.getTime() - 86400000);
const complete = () => ({
  number: "HD-01",
  signedOn: yesterday,
  startsOn: yesterday,
  endsOn: tomorrow,
  exemptionNote: null,
  items: [{ id }],
  documents: [{ kind: "SIGNED_CONTRACT" }, { kind: "COMPLIANCE" }],
  certification: {
    status: "ACTIVE",
    issuedDate: yesterday,
    expiryDate: tomorrow,
  },
});

void test("contract eligibility requires signed and compliance evidence, dates, scope and a valid basis", () => {
  assert.deepEqual(contractIssues(complete(), today), []);
  assert.ok(
    contractIssues({ ...complete(), documents: [] }, today).length >= 2,
  );
  assert.ok(contractIssues({ ...complete(), items: [] }, today).length);
  assert.ok(
    contractIssues({ ...complete(), startsOn: tomorrow }, today).length,
  );
  assert.ok(contractIssues({ ...complete(), endsOn: yesterday }, today).length);
  assert.ok(
    contractIssues({ ...complete(), signedOn: tomorrow }, today).length,
  );
  assert.ok(
    contractIssues(
      {
        ...complete(),
        certification: {
          status: "ACTIVE",
          issuedDate: yesterday,
          expiryDate: yesterday,
        },
      },
      today,
    ).length,
  );
  assert.ok(
    contractIssues({ ...complete(), certification: null }, today).length,
  );
  assert.deepEqual(
    contractIssues(
      {
        ...complete(),
        certification: null,
        exemptionNote: "Hồ sơ áp dụng được kiểm tra",
      },
      today,
    ),
    [],
  );
  assert.deepEqual(contractIssues({ ...complete(), endsOn: today }, today), []);
});

void test("file verification uses content, restricts size, removes path/control characters and computes immutable hash", () => {
  const content = Buffer.from("%PDF-1.4\n[TEST] agreement\n%%EOF");
  const doc = validateDocument(content, "../../contract\n.pdf");
  assert.equal(doc.fileName, "contract.pdf");
  assert.equal(doc.mimeType, "application/pdf");
  assert.equal(doc.size, content.length);
  assert.match(doc.sha256, /^[a-f0-9]{64}$/);
  assert.equal(doc.sha256, validateDocument(content, "other.pdf").sha256);
  assert.throws(() =>
    validateDocument(Buffer.from("<script>alert(1)</script>"), "contract.pdf"),
  );
  assert.throws(() =>
    validateDocument(Buffer.alloc(10 * 1024 * 1024 + 1), "large.pdf"),
  );
  assert.throws(() => validateDocument(Buffer.alloc(0), "empty.pdf"));
});

void test("supplier onboarding validation rejects mass assignment, invalid dates, unverified activation and bad order quantities", () => {
  assert.throws(() =>
    contractPayload({ supplierId: id, schoolId: id, ingredientIds: [] }, true),
  );
  assert.throws(() =>
    contractPayload(
      { supplierId: id, ingredientIds: [], signedOn: "2026-02-30" },
      true,
    ),
  );
  assert.throws(() =>
    contractPayload(
      {
        supplierId: id,
        ingredientIds: [],
        startsOn: "2026-12-01",
        endsOn: "2026-01-01",
      },
      true,
    ),
  );
  assert.throws(() =>
    contractPayload(
      {
        supplierId: id,
        ingredientIds: [],
        certificationId: id,
        exemptionNote: "Other",
      },
      true,
    ),
  );
  assert.throws(() => activationPayload({ revision: 1, verified: false }));
  assert.throws(() =>
    activationPayload({ revision: 1, verified: true, schoolId: id }),
  );
  assert.throws(() => listQuery({ page: "1", wardId: "fake" }));
  assert.throws(() => listQuery({ schoolId: id }));
  assert.throws(() =>
    orderPayload({
      supplierId: id,
      requestNo: "PO-1",
      requestedDeliveryDate: "2026-10-30",
      items: [{ ingredientEntryId: id, quantity: -1 }],
    }),
  );
  assert.throws(() =>
    orderPayload({
      supplierId: id,
      requestNo: "PO-1",
      requestedDeliveryDate: "2026-10-30",
      items: [{ ingredientEntryId: id, quantity: 1.0001 }],
    }),
  );
});

void test("relationship management requires both a permitted role and the current organization grant", () => {
  assert.throws(
    () =>
      assertContractManager({
        ...testStaff,
        permissions: ["supplier_relationship.manage"],
      }),
    { statusCode: 403 },
  );
  assert.throws(
    () =>
      assertContractManager({ ...testStaff, role: "SCHOOL_MANAGEMENT_BOARD" }),
    { statusCode: 403 },
  );
  assert.equal(
    assertContractManager({
      ...testStaff,
      role: "SCHOOL_MANAGEMENT_BOARD",
      permissions: ["supplier_relationship.manage"],
    }),
    testStaff.schoolId,
  );
  assert.equal(intervalsOverlap(today, tomorrow, tomorrow, tomorrow), true);
  assert.equal(intervalsOverlap(yesterday, yesterday, today, tomorrow), false);
});
