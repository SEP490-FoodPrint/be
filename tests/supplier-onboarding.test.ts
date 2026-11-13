import { RequestValidationError } from "../src/utils/request-validation";
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
import {
  assertContractManager,
  createOrderIntakeService,
} from "../src/modules/supplier-onboarding/supplier-onboarding.service";
import { supplierOrderRepository } from "../src/modules/supplier-onboarding/supplier-onboarding.repository";
import type { Prisma } from "../src/generated/prisma/client";
import { HttpError } from "../src/utils/http-error";
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

void test("school pause blocks draft creation and sending while SENT retries remain read-only", async () => {
  const schoolActor = { ...testStaff, permissions: ["supply_request.create"] };
  const tx = {} as Prisma.TransactionClient;
  let writes = 0;
  let checks = 0;
  let reads = 0;
  let status: "DRAFT" | "SENT" = "DRAFT";
  const service = createOrderIntakeService({
    write: (_principal, _supplierId, operation) =>
      operation(tx, schoolActor, schoolActor.schoolId!),
    guard: {
      assertAccess: (actual, actor, command) => {
        assert.equal(actual, tx);
        assert.equal(actor, schoolActor);
        assert(
          ["SCHOOL_CREATE_ORDER", "SCHOOL_SEND_ORDER"].includes(
            command.operation,
          ),
        );
        checks++;
        return Promise.reject(
          new HttpError(409, "Trường đang tạm dừng tạo đơn"),
        );
      },
    },
    repository: {
      ...supplierOrderRepository,
      findOwner: () => Promise.resolve({ supplierId: id }),
      findEntries: () => {
        reads++;
        return Promise.resolve([]);
      },
      createDraft: () => {
        writes++;
        throw new Error("Must not create a paused draft");
      },
      markSent: () => {
        writes++;
        throw new Error("Must not send a paused draft");
      },
      findOrderForSend: (actual) => {
        assert.equal(actual, tx);
        return Promise.resolve({
          id,
          supplierId: id,
          status,
          contractId: id,
          requestedDeliveryDate: tomorrow,
          supplyRequestItems: [{ id }],
        } as unknown as NonNullable<
          Awaited<ReturnType<typeof supplierOrderRepository.findOrderForSend>>
        >);
      },
    },
  });
  const body = orderPayload({
    supplierId: id,
    requestNo: "PAUSED-DRAFT",
    requestedDeliveryDate: tomorrow.toISOString().slice(0, 10),
    items: [{ ingredientEntryId: id, quantity: 1 }],
  });
  await assert.rejects(
    () => service.createOrderDraft(schoolActor, body),
    /tạm dừng/i,
  );
  await assert.rejects(
    () => service.sendOrder(schoolActor, { id }, { contractId: id }),
    /tạm dừng/i,
  );
  assert.equal(checks, 2);
  assert.equal(writes, 0);
  assert.equal(reads, 0);
  status = "SENT";
  assert.deepEqual(
    await service.sendOrder(schoolActor, { id }, { contractId: id }),
    { id, status: "SENT", contractId: id },
  );
  assert.equal(checks, 2, "retry must not be treated as new work");
  assert.equal(writes, 0);
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

void test("order validation reports nested field errors without exposing raw values", () => {
  assert.throws(
    () =>
      orderPayload({
        supplierId: id,
        requestNo: " ",
        requestedDeliveryDate: "2026-11-14",
        items: [{ ingredientEntryId: id, quantity: -1, injected: "sensitive" }],
      }),
    (error: unknown) => {
      if (!(error instanceof RequestValidationError)) return false;
      assert(error.fields.some((item) => item.field === "requestNo"));
      assert(error.fields.some((item) => item.field === "items.0.quantity"));
      assert(error.fields.some((item) => item.field === "items.0.injected"));
      assert(!JSON.stringify(error.fields).includes("sensitive"));
      return true;
    },
  );
});

void test("order validation preserves trimming, decimal quantities and calendar dates", () => {
  const result = orderPayload({
    supplierId: id.toUpperCase(),
    requestNo: "  FP-01  ",
    requestedDeliveryDate: "2026-11-14",
    items: [{ ingredientEntryId: id, quantity: 1.125 }],
  });
  assert.equal(result.supplierId, id);
  assert.equal(result.requestNo, "FP-01");
  assert.equal(result.deliveryDate.toISOString(), "2026-11-14T00:00:00.000Z");
  assert.equal(result.items[0].quantity, 1.125);
  assert.throws(
    () =>
      orderPayload({
        supplierId: id,
        requestNo: "FP-02",
        requestedDeliveryDate: "2026-02-30",
        items: [{ ingredientEntryId: id, quantity: 1 }],
      }),
    RequestValidationError,
  );
  assert.throws(
    () =>
      orderPayload({
        supplierId: id,
        requestNo: "FP-03",
        requestedDeliveryDate: "2026-11-14",
        items: [
          { ingredientEntryId: id, quantity: 1 },
          { ingredientEntryId: id.toUpperCase(), quantity: 2 },
        ],
      }),
    RequestValidationError,
  );
});
