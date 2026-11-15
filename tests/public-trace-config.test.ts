import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readPublicTraceOrigin } from "../src/config/env";

void describe("readPublicTraceOrigin", () => {
  void it("accepts HTTPS origins in production and non-production and normalizes trailing slash", () => {
    assert.equal(
      readPublicTraceOrigin({
        NODE_ENV: "production",
        PUBLIC_TRACE_ORIGIN: "https://trace.foodprint.vn/",
      }),
      "https://trace.foodprint.vn",
    );
    assert.equal(
      readPublicTraceOrigin({
        NODE_ENV: "development",
        PUBLIC_TRACE_ORIGIN: "https://staging.foodprint.vn:8443",
      }),
      "https://staging.foodprint.vn:8443",
    );
  });

  void it("allows HTTP only on loopback addresses outside production", () => {
    for (const origin of [
      "http://localhost:5000",
      "http://127.0.0.1:5000/",
      "http://[::1]:5000",
    ]) {
      assert.ok(
        readPublicTraceOrigin({
          NODE_ENV: "development",
          PUBLIC_TRACE_ORIGIN: origin,
        }).startsWith("http://"),
      );
    }

    assert.throws(() =>
      readPublicTraceOrigin({
        NODE_ENV: "production",
        PUBLIC_TRACE_ORIGIN: "http://localhost:5000",
      }),
    );
    assert.throws(() =>
      readPublicTraceOrigin({
        NODE_ENV: "development",
        PUBLIC_TRACE_ORIGIN: "http://trace.foodprint.local:5000",
      }),
    );
  });

  void it("rejects missing values, paths, query strings, hashes, and credentials without leaking secrets", () => {
    assert.throws(() => readPublicTraceOrigin({ NODE_ENV: "development" }));
    assert.throws(() =>
      readPublicTraceOrigin({
        NODE_ENV: "development",
        PUBLIC_TRACE_ORIGIN: "   ",
      }),
    );

    const secretUrl = "https://my-user:super-secret-pass@trace.foodprint.vn";
    assert.throws(
      () =>
        readPublicTraceOrigin({
          NODE_ENV: "production",
          PUBLIC_TRACE_ORIGIN: secretUrl,
        }),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        return !message.includes("super-secret-pass");
      },
    );

    for (const invalid of [
      "https://trace.foodprint.vn/api",
      "https://trace.foodprint.vn?a=1",
      "https://trace.foodprint.vn/?",
      "https://trace.foodprint.vn#frag",
      "https://trace.foodprint.vn/#",
      "ftp://trace.foodprint.vn",
    ]) {
      assert.throws(
        () =>
          readPublicTraceOrigin({
            NODE_ENV: "production",
            PUBLIC_TRACE_ORIGIN: invalid,
          }),
        invalid,
      );
    }
  });
});
