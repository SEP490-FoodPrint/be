import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeliveryTraceUrl,
  DELIVERY_ITEM_QR_TOKEN_PATTERN,
  DELIVERY_QR_IMAGE_OPTIONS,
  generateDeliveryQrToken,
  renderDeliveryQrBatch,
  renderDeliveryQrDataUrl,
} from "../src/utils/qr-code";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

void describe("qr-code", () => {
  void it("generates 32-byte lowercase hex64 tokens and fixed-path URLs independent of request Host", () => {
    const tokenA = generateDeliveryQrToken();
    const tokenB = generateDeliveryQrToken();
    assert.notEqual(tokenA, tokenB);
    assert.match(tokenA, DELIVERY_ITEM_QR_TOKEN_PATTERN);
    assert.match(tokenB, DELIVERY_ITEM_QR_TOKEN_PATTERN);

    const url = buildDeliveryTraceUrl("https://trace.foodprint.vn/", tokenA);
    assert.equal(
      url,
      `https://trace.foodprint.vn/api/public/delivery-items/${tokenA}`,
    );

    assert.throws(() =>
      buildDeliveryTraceUrl("https://trace.foodprint.vn", "not-a-hex64-token"),
    );
    assert.throws(() =>
      buildDeliveryTraceUrl("https://trace.foodprint.vn/subpath", tokenA),
    );
  });

  void it("renders a real 384x384 PNG data URL from stored URL and propagates renderer errors", async () => {
    const token = generateDeliveryQrToken();
    const storedUrl = buildDeliveryTraceUrl("http://localhost:5000", token);
    const dataUrl = await renderDeliveryQrDataUrl(storedUrl);
    assert.ok(dataUrl.startsWith("data:image/png;base64,"));

    const png = Buffer.from(
      dataUrl.slice("data:image/png;base64,".length),
      "base64",
    );
    assert.deepEqual(png.subarray(0, 8), PNG_MAGIC);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), 384);
    assert.equal(png.readUInt32BE(20), 384);

    // Re-rendering from exact stored URL yields identical PNG
    const reRendered = await renderDeliveryQrDataUrl(storedUrl);
    assert.equal(reRendered, dataUrl);

    await assert.rejects(() =>
      renderDeliveryQrDataUrl(storedUrl, () =>
        Promise.reject(new Error("QR encoder failure")),
      ),
    );
  });

  void it("bounds renderDeliveryQrBatch concurrency to at most 4 and preserves order", async () => {
    const urls = Array.from({ length: 10 }, (_, idx) => {
      const token = idx.toString(16).padStart(64, "0");
      return buildDeliveryTraceUrl("https://trace.foodprint.vn", token);
    });
    let inFlight = 0;
    let maxObserved = 0;

    const results = await renderDeliveryQrBatch(urls, {
      concurrency: 10,
      renderer: async (text, options) => {
        assert.deepEqual(options, DELIVERY_QR_IMAGE_OPTIONS);
        inFlight += 1;
        maxObserved = Math.max(maxObserved, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return `data:image/png;base64,${Buffer.from(text).toString("base64")}`;
      },
    });

    assert.equal(maxObserved, 4);
    assert.equal(results.length, 10);
    results.forEach((dataUrl, idx) => {
      assert.equal(
        Buffer.from(
          dataUrl.slice("data:image/png;base64,".length),
          "base64",
        ).toString("utf8"),
        urls[idx],
      );
    });
  });
});
