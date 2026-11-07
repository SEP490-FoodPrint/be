import assert from "node:assert/strict";
import { test } from "node:test";
import {
  paginationSchema,
  emptyQuerySchema,
  parse,
} from "../src/utils/directory-validation";
import { HttpError } from "../src/utils/http-error";
import { withReadTransaction } from "../src/utils/read-transaction";

void test("directory validation rejects multiple invalid fields and unsafe offsets", () => {
  assert.deepEqual(parse(paginationSchema, {}), { page: 1, limit: 20 });
  for (const value of [
    { page: "0", limit: "101" },
    { page: ["1"] },
    { page: "2147483648", limit: "100" },
  ])
    assert.throws(() => parse(paginationSchema, value), HttpError);
  assert.throws(
    () => parse(emptyQuerySchema, { search: "private-input" }),
    (error: unknown) =>
      error instanceof HttpError && !error.message.includes("private-input"),
  );
});
void test("read transaction sanitizes connection errors and preserves business errors", async () => {
  await assert.rejects(
    withReadTransaction(
      () => Promise.resolve(1),
      () => Promise.reject(new Error("password-secret")),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 503 &&
      !error.message.includes("secret"),
  );
  const denied = new HttpError(403, "Không có quyền");
  await assert.rejects(
    withReadTransaction(
      () => Promise.resolve(1),
      () => Promise.reject(denied),
    ),
    (error: unknown) => error === denied,
  );
});

void test("read transaction forwards one client with RepeatableRead isolation", async () => {
  const tx = {};
  let level = "";
  const client = {
    $transaction: async (
      callback: (value: object) => Promise<number>,
      options: { isolationLevel: string },
    ) => {
      level = options.isolationLevel;
      return callback(tx);
    },
  } as unknown as import("../src/generated/prisma/client").PrismaClient;
  const result = await withReadTransaction(
    (received) => {
      assert.equal(received, tx);
      return Promise.resolve(7);
    },
    () => Promise.resolve(client),
  );
  assert.equal(level, "RepeatableRead");
  assert.equal(result, 7);
});
