import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Prisma } from "../src/generated/prisma/client";
import {
  detectEvidenceMime,
  evidenceFilesSchema,
  MAX_EVIDENCE_BYTES,
  storeEvidenceFiles,
  withStoredEvidence,
  type EvidenceFile,
  type EvidenceStorage,
} from "../src/utils/evidence-files";
import {
  addCommentWithEvidence,
  mapTicketAttachment,
  mapTicketComment,
} from "../src/modules/complaint-ticket/complaint-ticket.service";
import { createComplaintTicketRepository } from "../src/modules/complaint-ticket/complaint-ticket.repository";
import {
  ticketCommentInputSchema,
  ticketTitleSchema,
} from "../src/modules/complaint-ticket/complaint-ticket.validation";

const OWNER = "10000000-0000-4000-8000-000000000001";

function file(
  mimeType: string,
  buffer: Buffer,
  originalName = "a",
): EvidenceFile {
  return { buffer, size: buffer.length, mimeType, originalName };
}
const PNG = file(
  "image/png",
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
  "anh.png",
);
const JPG = file("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
const WEBP = file(
  "image/webp",
  Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from("WEBPVP8 "),
  ]),
);
const PDF = file("application/pdf", Buffer.from("%PDF-1.4\n"), "bien-ban.pdf");

function memoryStorage(failAt?: number) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const storage: EvidenceStorage = {
    upload: (_file, publicId) => {
      if (failAt === uploaded.length) return Promise.reject(new Error("x"));
      uploaded.push(publicId);
      return Promise.resolve();
    },
    remove: (publicId) => {
      removed.push(publicId);
      return Promise.resolve();
    },
    url: (publicId) => `signed:${publicId}`,
  };
  return { storage, uploaded, removed };
}

void test("detectEvidenceMime accepts JPG/PNG/WEBP/PDF by magic bytes", () => {
  assert.equal(detectEvidenceMime(PNG, 0), "image/png");
  assert.equal(detectEvidenceMime(JPG, 0), "image/jpeg");
  assert.equal(detectEvidenceMime(WEBP, 0), "image/webp");
  assert.equal(detectEvidenceMime(PDF, 0), "application/pdf");
});

void test("detectEvidenceMime rejects other types, mismatched content and oversize files", () => {
  assert.throws(
    () => detectEvidenceMime(file("image/gif", Buffer.from("GIF89a")), 2),
    (error: { statusCode: number; fields: { field: string }[] }) =>
      error.statusCode === 400 && error.fields[0].field === "files.2.mimeType",
  );
  assert.throws(
    () => detectEvidenceMime({ ...PDF, mimeType: "image/png" }, 0),
    (error: { statusCode: number; fields: { field: string }[] }) =>
      error.statusCode === 400 && error.fields[0].field === "files.0",
  );
  const big = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
  Buffer.from("%PDF-").copy(big);
  assert.throws(() => detectEvidenceMime(file("application/pdf", big), 0), {
    statusCode: 413,
  });
  assert.throws(() => detectEvidenceMime({ ...PNG, size: PNG.size + 1 }, 0), {
    statusCode: 400,
  });
});

void test("storeEvidenceFiles uploads in order with owner path, sanitized name and sha256", async () => {
  const memory = memoryStorage();
  let next = 0;
  const ids = ["u1", "u2"];
  const stored = await storeEvidenceFiles(
    memory.storage,
    [{ ...PNG, originalName: "a/b\u0001.png" }, PDF],
    OWNER,
    () => ids[next++],
  );
  assert.deepEqual(memory.uploaded, [
    `foodprint/complaints/${OWNER}/u1.png`,
    `foodprint/complaints/${OWNER}/u2.pdf`,
  ]);
  assert.deepEqual(stored[0], {
    publicId: `foodprint/complaints/${OWNER}/u1.png`,
    mimeType: "image/png",
    sizeBytes: PNG.size,
    fileName: "a_b_.png",
    sha256: createHash("sha256").update(PNG.buffer).digest("hex"),
  });
  assert.equal(stored[1].fileName, "bien-ban.pdf");
});

void test("storeEvidenceFiles validates every file before uploading and cleans up on failure", async () => {
  const invalid = memoryStorage();
  await assert.rejects(
    storeEvidenceFiles(
      invalid.storage,
      [PNG, file("text/plain", Buffer.from("x"))],
      OWNER,
    ),
    { statusCode: 400 },
  );
  assert.deepEqual(invalid.uploaded, []);

  const tooMany = memoryStorage();
  await assert.rejects(
    storeEvidenceFiles(
      tooMany.storage,
      Array(6).fill(PNG) as EvidenceFile[],
      OWNER,
    ),
    { statusCode: 400 },
  );
  assert.deepEqual(tooMany.uploaded, []);

  const failing = memoryStorage(1);
  await assert.rejects(storeEvidenceFiles(failing.storage, [PNG, JPG], OWNER), {
    statusCode: 503,
  });
  assert.equal(failing.uploaded.length, 1);
  assert.deepEqual(failing.removed, failing.uploaded);
});

void test("withStoredEvidence skips storage without files and removes uploads when the operation fails", async () => {
  const empty = memoryStorage();
  assert.equal(
    await withStoredEvidence(empty.storage, undefined, OWNER, (stored) =>
      Promise.resolve(stored.length),
    ),
    0,
  );
  assert.deepEqual(empty.uploaded, []);

  const memory = memoryStorage();
  await assert.rejects(
    withStoredEvidence(memory.storage, [PNG, PDF], OWNER, () =>
      Promise.reject(new Error("tx failed")),
    ),
    /tx failed/,
  );
  assert.equal(memory.uploaded.length, 2);
  assert.deepEqual(memory.removed, memory.uploaded);
});

void test("schemas: title 5–255 chars, files array max 5, comment content still required", () => {
  assert.equal(ticketTitleSchema.parse("  Cơm sống  "), "Cơm sống");
  assert.equal(ticketTitleSchema.safeParse("Ngắn").success, false);
  assert.equal(ticketTitleSchema.safeParse("ạ".repeat(256)).success, false);
  assert.equal(ticketTitleSchema.safeParse("ạ".repeat(255)).success, true);
  assert.equal(
    evidenceFilesSchema.safeParse(Array(6).fill(PNG)).success,
    false,
  );
  assert.equal(
    ticketCommentInputSchema.safeParse({ content: "  ", files: [PNG] }).success,
    false,
  );
  assert.deepEqual(
    ticketCommentInputSchema.parse({ content: " Có ảnh ", files: [PNG] }),
    { content: "Có ảnh", files: [PNG] },
  );
});

void test("mapTicketAttachment exposes an allowlist and tolerates signing failures", () => {
  const row = {
    id: "a1",
    storagePublicId: "foodprint/complaints/u/x.pdf",
    mimeType: "application/pdf",
    sizeBytes: 9,
    originalFilename: "x.pdf",
    uploaderSide: "HANDLER" as const,
    createdAt: new Date("2026-11-25T00:00:00Z"),
  };
  assert.deepEqual(mapTicketAttachment(row, { url: (id) => `signed:${id}` }), {
    id: "a1",
    fileName: "x.pdf",
    mimeType: "application/pdf",
    sizeBytes: 9,
    uploaderSide: "HANDLER",
    createdAt: "2026-11-25T00:00:00.000Z",
    url: "signed:foodprint/complaints/u/x.pdf",
  });
  const failing = {
    url: (): string => {
      throw new Error("not configured");
    },
  };
  assert.equal(mapTicketAttachment(row, failing).url, null);
  const comment = mapTicketComment(
    {
      id: "c1",
      authorSide: "HANDLER",
      commentType: "RESOLUTION",
      content: "Đã xử lý",
      createdAt: row.createdAt,
      authorUser: { id: "u", fullName: "BGH" },
      attachments: [row],
    },
    failing,
  );
  assert.equal(comment.attachments.length, 1);
  assert.ok(!("storagePublicId" in comment.attachments[0]));
});

void test("addCommentWithEvidence ties files to the new comment of the same complaint", async () => {
  const written: unknown[] = [];
  const tx = {
    complaintComment: {
      create: () => Promise.resolve({ id: "comment-1" }),
    },
    complaintAttachment: {
      createMany: (args: unknown) => {
        written.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const repository = createComplaintTicketRepository();
  await addCommentWithEvidence(tx, repository, {
    complaintId: "complaint-1",
    actor: { userId: OWNER, roleCode: "SCHOOL_MANAGEMENT_BOARD" },
    side: "HANDLER",
    type: "MESSAGE",
    content: "Gửi biên bản",
    files: [
      {
        publicId: "p1",
        mimeType: "application/pdf",
        sizeBytes: 9,
        fileName: "bien-ban.pdf",
        sha256: "a".repeat(64),
      },
    ],
  });
  assert.deepEqual(written, [
    {
      data: [
        {
          complaintId: "complaint-1",
          commentId: "comment-1",
          uploadedByUserId: OWNER,
          uploaderSide: "HANDLER",
          storagePublicId: "p1",
          mimeType: "application/pdf",
          sizeBytes: 9,
          originalFilename: "bien-ban.pdf",
          sha256: "a".repeat(64),
        },
      ],
    },
  ]);
  // Không có file: không ghi gì.
  written.length = 0;
  await addCommentWithEvidence(tx, repository, {
    complaintId: "complaint-1",
    actor: { userId: OWNER, roleCode: "SCHOOL_MANAGEMENT_BOARD" },
    side: "HANDLER",
    type: "MESSAGE",
    content: "Không file",
    files: [],
  });
  assert.deepEqual(written, []);
});
