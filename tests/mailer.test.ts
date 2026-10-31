import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { sendMail, MAIL_TIMEOUT_MS } from "../src/utils/mailer";
import { HttpError } from "../src/utils/http-error";

function configure(context: TestContext) {
  const previous = [process.env.RESEND_API_KEY, process.env.RESEND_FROM];
  process.env.RESEND_API_KEY = "re_mailer_unit_test_only";
  process.env.RESEND_FROM = "FoodPrint <no-reply@example.test>";
  context.after(() => {
    ["RESEND_API_KEY", "RESEND_FROM"].forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  });
}
const message = {
  to: "recipient@example.test",
  subject: "Thông báo FoodPrint",
  text: "Nội dung thông báo",
};
function payload(init?: RequestInit): Record<string, unknown> {
  assert(typeof init?.body === "string");
  const value: unknown = JSON.parse(init.body);
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const unavailable = (error: unknown) =>
  error instanceof HttpError &&
  error.statusCode === 503 &&
  error.message === "Chưa thể gửi email. Vui lòng thử lại sau.";

void test("shared mailer sends text/HTML to one or multiple recipients with the configured sender, bounded timeout and caller idempotency key", async (context) => {
  configure(context);
  const requests: { body: Record<string, unknown>; headers: Headers }[] = [];
  const timeouts: number[] = [];
  context.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  context.mock.method(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      assert.equal(url, "https://api.resend.com/emails");
      assert(init);
      assert.equal(init?.method, "POST");
      assert(init.signal instanceof AbortSignal);
      requests.push({
        body: payload(init),
        headers: new Headers(init.headers),
      });
      return Promise.resolve(response({ id: "accepted-email-id" }));
    },
  );
  const result = await sendMail({
    ...message,
    idempotencyKey: "notification/request-123",
  });
  assert.deepEqual(result, { id: "accepted-email-id" });
  assert.deepEqual(requests[0].body, {
    from: process.env.RESEND_FROM,
    to: [message.to],
    subject: message.subject,
    text: message.text,
  });
  assert.equal(
    requests[0].headers.get("idempotency-key"),
    "notification/request-123",
  );
  await sendMail({
    to: [" first@example.test ", "second@example.test"],
    subject: "HTML notification",
    html: "<p>Thông báo</p>",
  });
  assert.deepEqual(requests[1].body.to, [
    "first@example.test",
    "second@example.test",
  ]);
  assert.equal(requests[1].body.html, "<p>Thông báo</p>");
  assert.equal(requests[1].body.text, undefined);
  assert.equal(requests[1].headers.get("idempotency-key"), null);
  await sendMail({ ...message, html: "<p>Nội dung thông báo</p>" });
  assert.equal(requests[2].body.text, message.text);
  assert.equal(requests[2].body.html, "<p>Nội dung thông báo</p>");
  assert.deepEqual(timeouts, [
    MAIL_TIMEOUT_MS,
    MAIL_TIMEOUT_MS,
    MAIL_TIMEOUT_MS,
  ]);
  assert.equal(MAIL_TIMEOUT_MS, 10_000);
});

void test("shared mailer rejects invalid recipients, empty content and header injection before contacting Resend", async (context) => {
  configure(context);
  const fetch = context.mock.method(globalThis, "fetch", () =>
    Promise.reject(new Error("Unexpected network request")),
  );
  for (const input of [
    { ...message, to: [] },
    { ...message, to: "invalid-address" },
    { ...message, to: [message.to, "invalid-address"] },
    { ...message, subject: "   " },
    { ...message, subject: "Subject\r\nBcc: other@example.test" },
    { ...message, text: " " },
    { ...message, text: "", html: " " },
    { ...message, idempotencyKey: " " },
    { ...message, idempotencyKey: "key\r\nInjected: value" },
  ])
    await assert.rejects(
      () => sendMail(input),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 400,
    );
  assert.equal(fetch.mock.callCount(), 0);
});

void test("shared mailer sanitizes SDK errors, missing acknowledgements, network failures and aborts without automatic retries or sensitive logs", async (context) => {
  configure(context);
  const log = context.mock.method(console, "error", () => undefined);
  let calls = 0;
  let mode: "provider" | "missing-id" | "network" | "abort" = "provider";
  const reason = new Error("private timeout details");
  context.mock.method(AbortSignal, "timeout", () =>
    mode === "abort" ? AbortSignal.abort(reason) : new AbortController().signal,
  );
  context.mock.method(
    globalThis,
    "fetch",
    (_input: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (mode === "network")
        return Promise.reject(new Error("private API key and email payload"));
      if (mode === "abort") {
        assert.equal(init?.signal?.reason, reason);
        return Promise.reject(reason);
      }
      return Promise.resolve(
        mode === "provider"
          ? response(
              { name: "validation_error", message: "private provider details" },
              422,
            )
          : response({}),
      );
    },
  );
  for (const next of ["provider", "missing-id", "network", "abort"] as const) {
    mode = next;
    await assert.rejects(() => sendMail(message), unavailable);
  }
  assert.equal(calls, 4);
  assert.equal(log.mock.callCount(), 0);
});

void test("shared mailer validates configuration before sending and uses the latest API key and sender", async (context) => {
  configure(context);
  const requests: { authorization: string | null; from: unknown }[] = [];
  const fetch = context.mock.method(
    globalThis,
    "fetch",
    (_input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        from: payload(init).from,
      });
      return Promise.resolve(response({ id: "accepted-id" }));
    },
  );
  await sendMail(message);
  process.env.RESEND_API_KEY = "re_rotated_mailer_unit_test_only";
  process.env.RESEND_FROM = "FoodPrint Alerts <alerts@example.test>";
  await sendMail(message);
  assert.deepEqual(requests, [
    {
      authorization: "Bearer re_mailer_unit_test_only",
      from: "FoodPrint <no-reply@example.test>",
    },
    {
      authorization: "Bearer re_rotated_mailer_unit_test_only",
      from: "FoodPrint Alerts <alerts@example.test>",
    },
  ]);
  delete process.env.RESEND_API_KEY;
  await assert.rejects(
    () => sendMail(message),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  process.env.RESEND_API_KEY = "re_mailer_unit_test_only";
  process.env.RESEND_FROM = "invalid-sender";
  await assert.rejects(
    () => sendMail(message),
    (error: unknown) => error instanceof HttpError && error.statusCode === 503,
  );
  assert.equal(fetch.mock.callCount(), 2);
});
