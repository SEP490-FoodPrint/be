import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import type { Express } from "express";
import { MemoryStore } from "express-rate-limit";
import { createApp, redactPublicTraceUrl } from "../src/app";
import { createRedisRateLimitStore } from "../src/config/redis";
import { Prisma } from "../src/generated/prisma/client";
import { createApiRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { authenticate } from "../src/middlewares/auth.middleware";
import {
  deliveryTraceRepository,
  publicDeliveryTraceSelect,
  type DeliveryTraceRepository,
  type PublicDeliveryTraceRecord,
} from "../src/modules/delivery-trace/delivery-trace.repository";
import { createDeliveryTraceService } from "../src/modules/delivery-trace/delivery-trace.service";
import {
  PUBLIC_TRACE_NOT_FOUND_MESSAGE,
  validatePublicDeliveryTraceParams,
  validatePublicDeliveryTraceQuery,
} from "../src/modules/delivery-trace/delivery-trace.validation";
import { HttpError } from "../src/utils/http-error";
import { renderPublicTraceHtml } from "../src/utils/public-trace-html";
import { RequestValidationError } from "../src/utils/request-validation";

process.env.NODE_ENV = "test";

const VALID_TOKEN = "a1b2c3d4".repeat(8);
const UNKNOWN_TOKEN = "f0e1d2c3".repeat(8);
const REJECTED_TOKEN = "12345678".repeat(8);
const LEGACY_TOKEN = "9abcdef0".repeat(8);

function makeTraceRecord(
  overrides?: Partial<PublicDeliveryTraceRecord>,
): PublicDeliveryTraceRecord {
  return {
    ingredientNameSnapshot: "Gạo ST25 (Snapshot)",
    actualQuantity: new Prisma.Decimal("12.500"),
    unit: "kg",
    sourceFacilityNameSnapshot: "Cơ sở xay xát An Lành",
    sourceFacilityCodeSnapshot: "SF-001",
    Delivery: {
      deliveryNo: "FP-DE-00001",
      status: "IN_TRANSIT",
      traceabilityVersion: 1,
      Supplier: {
        name: "Nhà cung cấp Thực phẩm Xanh",
      },
    },
    ...overrides,
  };
}

async function startRawHttp(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    async request(path: string, init?: RequestInit) {
      const response = await fetch(baseUrl + path, init);
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        text,
        json(): unknown {
          return text ? JSON.parse(text) : null;
        },
      };
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

void test("US4 public-trace validation normalizes hex64 token and rejects malformed tokens with uniform 404 message", () => {
  const normalized = validatePublicDeliveryTraceParams({
    token: `  ${VALID_TOKEN.toUpperCase()}  `,
  });
  assert.equal(normalized.token, VALID_TOKEN);
  assert.deepEqual(validatePublicDeliveryTraceQuery({}), {});

  for (const badToken of [
    "",
    "short",
    "g".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    "00000000-0000-4000-8000-000000000001",
    12345,
  ]) {
    assert.throws(
      () => validatePublicDeliveryTraceParams({ token: badToken }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 404 &&
        error.message === PUBLIC_TRACE_NOT_FOUND_MESSAGE,
    );
  }

  assert.throws(
    () => validatePublicDeliveryTraceQuery({ page: "1" }),
    (error: unknown) =>
      error instanceof RequestValidationError && error.statusCode === 400,
  );
});

void test("US4 repository and service enforce point lookup, v1 allowlist, snapshot immutability, true status and generic 503", async () => {
  const selectJson = JSON.stringify(publicDeliveryTraceSelect);
  for (const forbidden of [
    "School",
    "schoolId",
    "vehiclePlate",
    "expectedArrivalAt",
    "arrivedAt",
    "receivedAt",
    "deliveryApprovals",
    "ingredientLots",
    "qrToken",
    "createdByUserId",
    "contacts",
    "notes",
  ]) {
    assert.equal(selectJson.includes(forbidden), false, forbidden);
  }

  let capturedWhere: unknown;
  let capturedSelect: unknown;
  let lotOrListTouched = false;
  const mockDb = {
    deliveryItem: {
      findUnique: (args: { where: unknown; select: unknown }) => {
        capturedWhere = args.where;
        capturedSelect = args.select;
        const where = args.where as { qrToken?: string };
        if (where.qrToken === VALID_TOKEN) {
          return Promise.resolve(makeTraceRecord());
        }
        if (where.qrToken === REJECTED_TOKEN) {
          return Promise.resolve(
            makeTraceRecord({
              sourceFacilityCodeSnapshot: null,
              Delivery: {
                deliveryNo: "FP-DE-00002",
                status: "REJECTED",
                traceabilityVersion: 1,
                Supplier: { name: "Nhà cung cấp Thực phẩm Xanh" },
              },
            }),
          );
        }
        if (where.qrToken === LEGACY_TOKEN) {
          return Promise.resolve(
            makeTraceRecord({
              Delivery: {
                deliveryNo: "DG-LEGACY-01",
                status: "CREATED",
                traceabilityVersion: null,
                Supplier: { name: "Nhà cung cấp Cũ" },
              },
            }),
          );
        }
        return Promise.resolve(null);
      },
      findMany: () => {
        lotOrListTouched = true;
        return Promise.resolve([]);
      },
    },
    ingredientLot: {
      findUnique: () => {
        lotOrListTouched = true;
        return Promise.resolve(null);
      },
    },
  } as unknown as Parameters<DeliveryTraceRepository["findByQrToken"]>[0];

  const foundViaRepo = await deliveryTraceRepository.findByQrToken(
    mockDb,
    VALID_TOKEN,
  );
  assert.ok(foundViaRepo);
  assert.deepEqual(capturedWhere, { qrToken: VALID_TOKEN });
  assert.deepEqual(capturedSelect, publicDeliveryTraceSelect);
  assert.equal(
    await deliveryTraceRepository.findByQrToken(mockDb, LEGACY_TOKEN),
    null,
  );
  assert.equal(
    await deliveryTraceRepository.findByQrToken(mockDb, UNKNOWN_TOKEN),
    null,
  );
  assert.equal(lotOrListTouched, false);

  const service = createDeliveryTraceService({
    connect: () => Promise.resolve(mockDb),
    findByQrToken: (db, qrToken) =>
      deliveryTraceRepository.findByQrToken(db, qrToken),
  });

  const validDto = await service.getPublicTrace(
    validatePublicDeliveryTraceParams({ token: VALID_TOKEN }),
    validatePublicDeliveryTraceQuery({}),
  );
  assert.deepEqual(Object.keys(validDto).sort(), [
    "actualQuantity",
    "deliveryNo",
    "ingredientName",
    "sourceFacility",
    "status",
    "statusLabel",
    "supplierName",
    "unit",
  ]);
  assert.equal(validDto.actualQuantity, "12.5");
  assert.equal(validDto.statusLabel, "Đang giao");
  assert.deepEqual(validDto.sourceFacility, {
    name: "Cơ sở xay xát An Lành",
    facilityCode: "SF-001",
  });

  const rejectedDto = await service.getPublicTrace(
    validatePublicDeliveryTraceParams({ token: REJECTED_TOKEN }),
    validatePublicDeliveryTraceQuery({}),
  );
  assert.equal(rejectedDto.status, "REJECTED");
  assert.equal(rejectedDto.statusLabel, "Yêu cầu giao hàng lại");
  assert.deepEqual(rejectedDto.sourceFacility, {
    name: "Cơ sở xay xát An Lành",
    facilityCode: null,
  });

  for (const missingToken of [LEGACY_TOKEN, UNKNOWN_TOKEN]) {
    await assert.rejects(
      () =>
        service.getPublicTrace(
          validatePublicDeliveryTraceParams({ token: missingToken }),
          validatePublicDeliveryTraceQuery({}),
        ),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 404 &&
        error.message === PUBLIC_TRACE_NOT_FOUND_MESSAGE,
    );
  }

  const failingService = createDeliveryTraceService({
    connect: () => Promise.resolve(mockDb),
    findByQrToken: () =>
      Promise.reject(
        new Error(`postgresql://user:secret@host/db token=${VALID_TOKEN}`),
      ),
  });
  await assert.rejects(
    () =>
      failingService.getPublicTrace(
        validatePublicDeliveryTraceParams({ token: VALID_TOKEN }),
        validatePublicDeliveryTraceQuery({}),
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("postgresql") &&
      !error.message.includes(VALID_TOKEN),
  );
});

void test("US4 public HTML escapes untrusted text cleanly, renders nullable source code and excludes scripts/forms/private data", () => {
  const html = renderPublicTraceHtml({
    supplierName: '<script>alert("xss")</script> & Nhà cung cấp',
    deliveryNo: 'FP-DE-00009" onclick="evil()',
    status: "CANCELLED_MEAL",
    statusLabel: "Đã hủy suất ăn",
    ingredientName: "Thịt bò <img src=x onerror=alert(1)>",
    actualQuantity: "7.25",
    unit: "kg",
    sourceFacility: {
      name: "Trang trại 'Sạch'",
      facilityCode: null,
    },
  });

  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("<form"), false);
  assert.equal(html.includes("<img"), false);
  assert.ok(
    html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"),
  );
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("Trang trại &#39;Sạch&#39;"));
  assert.ok(html.includes("Chưa có mã cơ sở"));
  assert.ok(html.includes("Đã hủy suất ăn"));
});

void test("US4 full createApp wiring serves public HTML/JSON/HEAD without auth, enforces 404/406/headers, keeps protected anchors locked, applies rate limiter and redacts tokens", async (context: TestContext) => {
  const store = new MemoryStore();
  let lookupCalls = 0;
  let dbOutage = false;

  const service = createDeliveryTraceService({
    connect: () => Promise.resolve({} as never),
    findByQrToken: (_db, qrToken) => {
      lookupCalls += 1;
      if (dbOutage) return Promise.reject(new Error("ECONNREFUSED"));
      if (qrToken === VALID_TOKEN) {
        return Promise.resolve(
          makeTraceRecord({
            sourceFacilityCodeSnapshot: null,
          }),
        );
      }
      if (qrToken === LEGACY_TOKEN) {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    },
  });

  const app = createApp(
    createApiRateLimiter(store, { windowMs: 60_000, limit: 20 }),
    authenticate,
    undefined,
    { deliveryTraceService: service },
  );
  const http = await startRawHttp(app);
  context.after(async () => {
    await http.close();
    store.shutdown();
  });

  // 1. Browser Accept -> HTML + strict security headers without auth header
  const htmlRes = await http.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
    {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    },
  );
  assert.equal(htmlRes.status, 200);
  assert.ok(
    htmlRes.headers.get("content-type")?.includes("text/html; charset=utf-8"),
  );
  assert.ok(htmlRes.headers.get("cache-control")?.includes("no-store"));
  assert.equal(htmlRes.headers.get("referrer-policy"), "no-referrer");
  assert.equal(htmlRes.headers.get("x-content-type-options"), "nosniff");
  assert.ok(htmlRes.headers.get("x-robots-tag")?.includes("noindex"));
  assert.ok(
    htmlRes.headers
      .get("content-security-policy")
      ?.includes("default-src 'none'"),
  );
  assert.ok(htmlRes.text.includes("Chưa có mã cơ sở"));

  // 2. API Accept (JSON / wildcard / omitted) -> shared JSON envelope
  for (const acceptHeader of ["application/json", "*/*", undefined]) {
    const jsonRes = await http.request(
      `/api/public/delivery-items/${VALID_TOKEN}`,
      acceptHeader ? { headers: { Accept: acceptHeader } } : undefined,
    );
    assert.equal(jsonRes.status, 200);
    assert.ok(
      jsonRes.headers.get("content-type")?.includes("application/json"),
    );
    assert.ok(jsonRes.headers.get("cache-control")?.includes("no-store"));
    assert.equal(jsonRes.headers.get("referrer-policy"), "no-referrer");
    assert.ok(jsonRes.headers.get("x-robots-tag")?.includes("noindex"));
    const body = jsonRes.json() as {
      success: boolean;
      data: Record<string, unknown>;
    };
    assert.equal(body.success, true);
    assert.equal(body.data.deliveryNo, "FP-DE-00001");
    assert.equal("qrToken" in body.data, false);
    assert.equal("schoolId" in body.data, false);
  }

  // 3. HEAD returns headers without body or extra writes
  const headRes = await http.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
    {
      method: "HEAD",
      headers: { Accept: "text/html" },
    },
  );
  assert.equal(headRes.status, 200);
  assert.equal(headRes.text, "");
  assert.ok(
    headRes.headers
      .get("content-security-policy")
      ?.includes("default-src 'none'"),
  );

  // 4. Unsupported Accept -> 406 before lookup
  const callsBefore406 = lookupCalls;
  const unacceptable = await http.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
    {
      headers: { Accept: "application/xml" },
    },
  );
  assert.equal(unacceptable.status, 406);
  assert.equal(lookupCalls, callsBefore406);

  // 5. Uniform 404 across malformed, unknown, and legacy tokens (both JSON and HTML)
  const badJson = await http.request(
    "/api/public/delivery-items/not-a-hex-token",
  );
  const unknownJson = await http.request(
    `/api/public/delivery-items/${UNKNOWN_TOKEN}`,
  );
  const legacyJson = await http.request(
    `/api/public/delivery-items/${LEGACY_TOKEN}`,
  );
  assert.equal(badJson.status, 404);
  assert.equal(unknownJson.status, 404);
  assert.equal(legacyJson.status, 404);
  assert.deepEqual(badJson.json(), unknownJson.json());
  assert.deepEqual(unknownJson.json(), legacyJson.json());

  const badHtml = await http.request("/api/public/delivery-items/short", {
    headers: { Accept: "text/html" },
  });
  const unknownHtml = await http.request(
    `/api/public/delivery-items/${UNKNOWN_TOKEN}`,
    { headers: { Accept: "text/html" } },
  );
  assert.equal(badHtml.status, 404);
  assert.equal(unknownHtml.status, 404);
  assert.equal(badHtml.text, unknownHtml.text);
  assert.ok(
    badHtml.headers
      .get("content-security-policy")
      ?.includes("default-src 'none'"),
  );

  // 6. Strict empty query rejects extra query params
  const badQuery = await http.request(
    `/api/public/delivery-items/${VALID_TOKEN}?extra=1`,
  );
  assert.equal(badQuery.status, 400);

  // 7. DB failure returns 503 HTML/JSON without leaking token
  dbOutage = true;
  const outageHtml = await http.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
    { headers: { Accept: "text/html" } },
  );
  assert.equal(outageHtml.status, 503);
  assert.equal(outageHtml.text.includes(VALID_TOKEN), false);
  dbOutage = false;

  // 8. Protected route stays protected
  const anchorsRes = await http.request("/api/traceability-anchors");
  assert.equal(anchorsRes.status, 401);

  // 9. URL redaction + morgan/error log redaction
  assert.equal(
    redactPublicTraceUrl(`/api/public/delivery-items/${VALID_TOKEN}?x=1`),
    "/api/public/delivery-items/[REDACTED]?x=1",
  );
});

void test("US4 rate limiter throttles excessive public trace scans, fails closed 503 on Redis error and development logs never record raw tokens", async (context: TestContext) => {
  const logLines: string[] = [];
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  const limitedStore = new MemoryStore();
  const service = createDeliveryTraceService({
    connect: () => Promise.resolve({} as never),
    findByQrToken: (_db, qrToken) =>
      Promise.resolve(qrToken === VALID_TOKEN ? makeTraceRecord() : null),
  });
  const limitedHttp = await startRawHttp(
    createApp(
      createApiRateLimiter(limitedStore, { windowMs: 60_000, limit: 2 }),
      authenticate,
      undefined,
      {
        deliveryTraceService: service,
        accessLogStream: {
          write(line) {
            logLines.push(line);
          },
        },
      },
    ),
  );

  const failingStore = createRedisRateLimitStore("test:public-trace", {
    isReady: false,
    sendCommand: () => Promise.reject(new Error("Redis unavailable")),
  });
  const failClosedHttp = await startRawHttp(
    createApp(
      createApiRateLimiter(failingStore, { windowMs: 60_000, limit: 20 }),
      authenticate,
      undefined,
      { deliveryTraceService: service },
    ),
  );

  context.after(async () => {
    process.env.NODE_ENV = origEnv;
    await limitedHttp.close();
    await failClosedHttp.close();
    limitedStore.shutdown();
  });

  const first = await limitedHttp.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
  );
  const second = await limitedHttp.request(
    `/api/public/delivery-items/${UNKNOWN_TOKEN}`,
  );
  const third = await limitedHttp.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
  );
  assert.equal(first.status, 200);
  assert.equal(second.status, 404);
  assert.equal(third.status, 429);

  const failClosedRes = await failClosedHttp.request(
    `/api/public/delivery-items/${VALID_TOKEN}`,
  );
  assert.equal(failClosedRes.status, 503);

  const logs = logLines.join("");
  assert.equal(logs.includes(VALID_TOKEN), false);
  assert.equal(logs.includes(UNKNOWN_TOKEN), false);
  assert.ok(logs.includes("/api/public/delivery-items/[REDACTED]"));
});
