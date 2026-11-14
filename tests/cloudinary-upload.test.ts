import assert from "node:assert/strict";
import { test } from "node:test";
import { Writable } from "node:stream";
import { v2 as cloudinary } from "cloudinary";
import { cloudinaryTransport } from "../src/utils/cloudinary-client";
import { createCloudinaryUpload } from "../src/utils/cloudinary-upload";
import type { UploadFile } from "../src/utils/cloudinary-upload.types";
import {
  imageAtFiveMib,
  imageFixture,
  pdfFixture,
} from "./helpers/upload-fixtures";

const context = {
  namespace: "ingredients",
  ownerId: "22222222-2222-4222-8222-222222222222",
};

function fixture(failAt: number[] = []) {
  const calls: Array<{
    file: UploadFile;
    options: { kind: string; publicId: string; format: string };
  }> = [];
  let sequence = 0;
  const transport = {
    prepare() {
      return {
        async upload(
          file: UploadFile,
          options: {
            kind: "image" | "document";
            publicId: string;
            format: "jpg" | "png" | "webp" | "pdf";
          },
        ) {
          await Promise.resolve();
          const index = calls.length;
          calls.push({ file, options });
          if (failAt.includes(index)) throw new Error("secret provider error");
          if (options.kind === "document") {
            return {
              publicId: options.publicId,
              fileName: file.originalName,
              format: options.format as "pdf" | "png" | "jpg",
              bytes: file.size,
              resourceType: "raw" as const,
              deliveryType: "authenticated" as const,
            };
          }
          return {
            publicId: options.publicId,
            url: `https://res.cloudinary.com/test/image/upload/${options.publicId}.${options.format}`,
            format: options.format as "png" | "jpg" | "webp",
            bytes: file.size,
            width: 2,
            height: 2,
          };
        },
      };
    },
  };
  const uploader = createCloudinaryUpload(
    transport,
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  );
  return { uploader, calls };
}

void test("single image and document helpers distinguish public images and private documents", async () => {
  const f = fixture();
  const image = await imageFixture();
  const result = await f.uploader.uploadImage(image, context);
  assert.equal(result.format, "png");
  assert.match(result.url, /^https:\/\//);
  const doc = await f.uploader.uploadDocument(pdfFixture(), context);
  assert.equal(doc.resourceType, "raw");
  assert.equal(doc.deliveryType, "authenticated");
  assert(!("url" in doc));
  assert.equal(f.calls[0]?.options.kind, "image");
  assert.equal(f.calls[1]?.options.kind, "document");
});

void test("all inputs are checked before any upload", async () => {
  const f = fixture();
  const image = await imageFixture();
  for (const bad of [
    { ...image, buffer: Buffer.alloc(0), size: 0 },
    { ...image, size: image.size + 1 },
    { ...image, mimeType: "image/jpeg" },
    { ...image, buffer: image.buffer.subarray(0, 16), size: 16 },
    {
      ...image,
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      size: 5 * 1024 * 1024 + 1,
    },
  ])
    await assert.rejects(() => f.uploader.uploadImages([image, bad], context));
  await assert.rejects(() => f.uploader.uploadImages([], context));
  await assert.rejects(() =>
    f.uploader.uploadImages(
      Array.from({ length: 6 }, () => image),
      context,
    ),
  );
  await assert.rejects(() =>
    f.uploader.uploadDocument({ ...image, mimeType: "image/webp" }, context),
  );
  assert.equal(f.calls.length, 0);
});

void test("batch keeps input order and successful results when uploads fail", async () => {
  const f = fixture([1, 3]);
  const image = await imageFixture();
  const results = await f.uploader.uploadImages(
    Array.from({ length: 5 }, () => image),
    context,
  );
  assert.deepEqual(
    results.map((item) => item.index),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    results.map((item) => item.status),
    ["success", "failed", "success", "failed", "success"],
  );
  assert(!JSON.stringify(results).includes("secret provider error"));
  assert.equal(new Set(f.calls.map((call) => call.options.publicId)).size, 5);
});

void test("documents allow mixed PDF PNG JPEG and reject WebP before upload", async () => {
  const f = fixture();
  const png = await imageFixture("png");
  const jpg = await imageFixture("jpg");
  const results = await f.uploader.uploadDocuments(
    [pdfFixture(), png, jpg],
    context,
  );
  assert.deepEqual(
    results.map((item) => item.status),
    ["success", "success", "success"],
  );
  assert(f.calls.every((call) => call.options.kind === "document"));
  const before = f.calls.length;
  const webp = await imageFixture("webp");
  await assert.rejects(() =>
    f.uploader.uploadDocuments([pdfFixture(), webp], context),
  );
  assert.equal(f.calls.length, before);
});

void test("all failed uploads return one safe result per input", async () => {
  const f = fixture([0, 1, 2, 3, 4]);
  const image = await imageFixture("jpg");
  const results = await f.uploader.uploadImages(
    Array.from({ length: 5 }, () => image),
    context,
  );
  assert.equal(results.length, 5);
  assert(results.every((item) => item.status === "failed"));
  assert.deepEqual(
    results.map((item) => item.index),
    [0, 1, 2, 3, 4],
  );
  assert.equal(f.calls.length, 5);
});

void test("multiple concurrent uploads use unique identifiers per trusted organization", async () => {
  const f = fixture();
  const image = await imageFixture("webp");
  const otherContext = {
    ...context,
    ownerId: "33333333-3333-4333-8333-333333333333",
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      f.uploader.uploadImage(image, index % 2 ? context : otherContext),
    ),
  );
  assert.equal(new Set(results.map((item) => item.publicId)).size, 10);
  assert.equal(
    results.filter((item) => item.publicId.includes(context.ownerId)).length,
    5,
  );
  assert.equal(
    results.filter((item) => item.publicId.includes(otherContext.ownerId))
      .length,
    5,
  );
});

void test("a missing storage configuration and unsafe storage context fail before upload", async () => {
  const image = await imageFixture();
  let calls = 0;
  const uploader = createCloudinaryUpload({
    prepare() {
      calls++;
      throw new Error("missing configuration");
    },
  });
  await assert.rejects(() =>
    uploader.uploadImage(image, { ...context, namespace: "../unsafe" }),
  );
  assert.equal(calls, 0);
  await assert.rejects(() => uploader.uploadImage(image, context));
  assert.equal(calls, 1);
});

void test("valid image exactly five MiB is accepted", async () => {
  const f = fixture();
  const image = await imageAtFiveMib();
  assert.equal(image.size, 5 * 1024 * 1024);
  const result = await f.uploader.uploadImage(image, context);
  assert.equal(result.bytes, image.size);
});

void test("batch limits concurrent uploads to two and keeps input order on reversed completion", async () => {
  const image = await imageFixture();
  let active = 0;
  let peak = 0;
  let sequence = 0;
  const uploader = createCloudinaryUpload(
    {
      prepare() {
        return {
          async upload(file, options) {
            active++;
            peak = Math.max(peak, active);
            const index = ++sequence;
            await new Promise((resolve) =>
              setTimeout(resolve, index % 2 ? 8 : 1),
            );
            active--;
            return {
              publicId: options.publicId,
              url: `https://res.cloudinary.com/test/image/upload/${options.publicId}.png`,
              format: "png" as const,
              bytes: file.size,
              width: 2,
              height: 2,
            };
          },
        };
      },
    },
    () => `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, "0")}`,
  );
  const results = await uploader.uploadImages(
    Array.from({ length: 5 }, () => image),
    context,
  );
  assert.equal(peak, 2);
  assert.deepEqual(
    results.map((result) => result.index),
    [0, 1, 2, 3, 4],
  );
  assert(results.every((result) => result.status === "success"));
});

void test("Cloudinary adapter rejects collisions and responses outside the expected identity", async (t) => {
  const names = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ] as const;
  const original = names.map((name) => process.env[name]);
  t.after(() =>
    names.forEach((name, index) => {
      const value = original[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }),
  );
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  const file = await imageFixture();
  const publicId = `foodprint/uploads/ingredients/${context.ownerId}/00000000-0000-4000-8000-000000000001`;
  let override: Record<string, unknown> = {};
  let actualOptions: Record<string, unknown> = {};
  t.mock.method(cloudinary.uploader, "upload_stream", ((...args: unknown[]) => {
    actualOptions = args[0] as Record<string, unknown>;
    const callback = args[1] as (error: null, result: unknown) => void;
    return new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
      final(done) {
        callback(null, {
          public_id: publicId,
          resource_type: "image",
          type: "upload",
          format: "png",
          bytes: file.size,
          width: 2,
          height: 2,
          secure_url: `https://res.cloudinary.com/test-cloud/image/upload/v1/${publicId}.png`,
          ...override,
        });
        done();
      },
    });
  }) as typeof cloudinary.uploader.upload_stream);
  const session = cloudinaryTransport.prepare();
  const options = { kind: "image" as const, format: "png" as const, publicId };
  const asset = await session.upload(file, options);
  assert.equal(asset.publicId, publicId);
  assert.equal(actualOptions.overwrite, false);
  assert.equal(actualOptions.cloud_name, "test-cloud");
  for (const invalid of [
    { existing: true },
    { public_id: "another-owner/asset" },
    { type: "authenticated" },
    { resource_type: "raw" },
    {
      secure_url:
        "https://res.cloudinary.com/other-cloud/image/upload/other.png",
    },
    {
      secure_url:
        "https://res.cloudinary.com/test-cloud/image/upload/other.png",
    },
    { width: 0 },
  ]) {
    override = invalid;
    await assert.rejects(
      () => session.upload(file, options),
      (error: unknown) => {
        assert(error instanceof Error);
        assert(!error.message.includes("test-secret"));
        return true;
      },
    );
  }
});

void test("Cloudinary adapter times out and ignores late callbacks", async (t) => {
  const names = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ] as const;
  const original = names.map((name) => process.env[name]);
  t.after(() =>
    names.forEach((name, index) => {
      const value = original[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }),
  );
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  const file = await imageFixture();
  let lateCallback: ((error: null, result: unknown) => void) | undefined;
  t.mock.method(cloudinary.uploader, "upload_stream", ((...args: unknown[]) => {
    lateCallback = args[1] as (error: null, result: unknown) => void;
    return new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
  }) as typeof cloudinary.uploader.upload_stream);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = cloudinaryTransport
    .prepare()
    .upload(file, { kind: "image", format: "png", publicId: "test-id" });
  const rejected = assert.rejects(pending, { code: "UPLOAD_TIMEOUT" });
  t.mock.timers.tick(30000);
  await rejected;
  lateCallback?.(null, {});
});

void test("document adapter sends raw authenticated options and does not return a public URL", async (t) => {
  const names = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ] as const;
  const original = names.map((name) => process.env[name]);
  t.after(() =>
    names.forEach((name, index) => {
      const value = original[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }),
  );
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  const file = pdfFixture();
  const publicId = `foodprint/uploads/ingredients/${context.ownerId}/00000000-0000-4000-8000-000000000001.pdf`;
  let actualOptions: Record<string, unknown> = {};
  t.mock.method(cloudinary.uploader, "upload_stream", ((...args: unknown[]) => {
    actualOptions = args[0] as Record<string, unknown>;
    const callback = args[1] as (error: null, result: unknown) => void;
    return new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
      final(done) {
        callback(null, {
          public_id: publicId,
          resource_type: "raw",
          type: "authenticated",
          bytes: file.size,
          secure_url: "https://private.invalid/secret",
        });
        done();
      },
    });
  }) as typeof cloudinary.uploader.upload_stream);
  const asset = await cloudinaryTransport
    .prepare()
    .upload(file, { kind: "document", format: "pdf", publicId });
  assert.equal(actualOptions.resource_type, "raw");
  assert.equal(actualOptions.type, "authenticated");
  assert.equal(actualOptions.overwrite, false);
  assert(!("url" in asset));
  assert(!JSON.stringify(asset).includes("private.invalid"));
  assert(!JSON.stringify(asset).includes("test-secret"));
});
