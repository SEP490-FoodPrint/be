/* Test doubles temporarily replace storage methods and do not use `this`. */
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { documentStorage } from "../src/utils/onboarding-documents";
import { uploadRecordPhoto, recordPhotoUrl } from "../src/utils/record-photo";
import express from "express";
import { receivePhoto } from "../src/utils/record-photo";
import { createDeliveryInspectionController } from "../src/modules/delivery/delivery.controller";
import { createRetainedSampleController } from "../src/modules/retained-sample/retained-sample.controller";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { testStaff } from "./helpers/authorization";
import { startHttp } from "./helpers/http";

const userId = "11111111-1111-4111-8111-111111111111";
const file = (buffer: Buffer, mimetype: string) =>
  ({
    buffer,
    mimetype,
    size: buffer.length,
    originalname: "photo.jpg",
    fieldname: "photo",
  }) as Express.Multer.File;

void test("photo upload accepts image bytes, computes a stable hash and retains private asset metadata", async () => {
  const previousUpload = documentStorage.upload;
  const previousDownload = documentStorage.download;
  const bytes = Buffer.from([255, 216, 255, 0, 1]);
  const doc = {
    id: userId,
    field: "photo",
    publicId: "private/photo.jpg",
    format: "jpg" as const,
    fileName: "photo.jpg",
    bytes: bytes.length,
  };
  documentStorage.upload = async () => doc;
  documentStorage.download = () => "signed-private-link";
  try {
    const result = await uploadRecordPhoto(userId, file(bytes, "image/jpeg"));
    assert.equal(result?.photo.photoPublicId, doc.publicId);
    assert.equal(
      result?.photo.photoHash,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(
      recordPhotoUrl(result?.photo.photoPublicId ?? null),
      "signed-private-link",
    );
    assert.equal(await uploadRecordPhoto(userId), null);
    assert.equal(recordPhotoUrl(null), null);
  } finally {
    documentStorage.upload = previousUpload;
    documentStorage.download = previousDownload;
  }
});

void test("multipart photos are attached to decisions and samples, and failed writes remove the uploaded asset", async (t) => {
  const previousUpload = documentStorage.upload;
  const previousRemove = documentStorage.remove;
  const doc = {
    id: userId,
    field: "photo",
    publicId: "private/photo.jpg",
    format: "jpg" as const,
    fileName: "photo.jpg",
    bytes: 5,
  };
  let removed = 0;
  documentStorage.upload = async () => doc;
  documentStorage.remove = async () => {
    removed++;
  };
  t.after(() => {
    documentStorage.upload = previousUpload;
    documentStorage.remove = previousRemove;
  });
  let fail = false;
  let attached = "";
  const decision = createDeliveryInspectionController({
    decide: async (
      _id: string,
      _input: unknown,
      _actor: unknown,
      photo: { photoHash: string },
    ) => {
      attached = photo.photoHash;
      if (fail) throw new Error("database failure");
      return { created: true };
    },
  } as never);
  const sample = createRetainedSampleController({
    create: async (
      _id: string,
      _input: unknown,
      _actor: unknown,
      photo: { photoHash: string },
    ) => {
      attached = photo.photoHash;
      return { created: true };
    },
  } as never);
  const app = express();
  app.use((req, _res, next) => {
    req.auth = testStaff;
    next();
  });
  app.post("/delivery/:id", receivePhoto, decision.decide);
  app.post("/sample/:id", receivePhoto, sample.create);
  app.use(globalErrorHandler);
  const http = await startHttp(app);
  t.after(() => http.close());
  const form = (isSample = false) => {
    const data = new FormData();
    if (isSample) {
      data.set("quantity", "150");
      data.set("unit", "g");
      data.set("storageLocation", "A");
      data.set("sampledAt", new Date().toISOString());
    } else data.set("decision", "APPROVE");
    data.set(
      "photo",
      new Blob([new Uint8Array([255, 216, 255, 0, 1])], { type: "image/jpeg" }),
      "photo.jpg",
    );
    return data;
  };
  assert.equal(
    (
      await http.request(`/delivery/${userId}`, {
        method: "POST",
        body: form(),
      })
    ).status,
    200,
  );
  assert.equal(attached.length, 64);
  assert.equal(
    (
      await http.request(`/sample/${userId}`, {
        method: "POST",
        body: form(true),
      })
    ).status,
    201,
  );
  fail = true;
  assert.equal(
    (
      await http.request(`/delivery/${userId}`, {
        method: "POST",
        body: form(),
      })
    ).status,
    500,
  );
  assert.equal(removed, 1);
});

void test("photo upload rejects spoofed content, PDFs, and oversized images before storage", async () => {
  const previousUpload = documentStorage.upload;
  let calls = 0;
  documentStorage.upload = async () => {
    calls++;
    throw new Error("unexpected upload");
  };
  try {
    await assert.rejects(
      uploadRecordPhoto(
        userId,
        file(Buffer.from("not an image"), "image/jpeg"),
      ),
    );
    await assert.rejects(
      uploadRecordPhoto(
        userId,
        file(Buffer.from("%PDF-1.4"), "application/pdf"),
      ),
    );
    await assert.rejects(
      uploadRecordPhoto(
        userId,
        file(Buffer.alloc(5 * 1024 * 1024 + 1), "image/jpeg"),
      ),
    );
    assert.equal(calls, 0);
  } finally {
    documentStorage.upload = previousUpload;
  }
});
