import sharp from "sharp";

export async function imageFixture(format: "png" | "jpg" | "webp" = "png") {
  const pipeline = sharp({
    create: { width: 2, height: 2, channels: 3, background: "#328f43" },
  });
  const buffer = await (
    format === "jpg"
      ? pipeline.jpeg()
      : format === "webp"
        ? pipeline.webp()
        : pipeline.png()
  ).toBuffer();
  return {
    buffer,
    size: buffer.length,
    mimeType: format === "jpg" ? "image/jpeg" : `image/${format}`,
    originalName: `fixture.${format}`,
  };
}

export function pdfFixture() {
  const buffer = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
  return {
    buffer,
    size: buffer.length,
    mimeType: "application/pdf",
    originalName: "fixture.pdf",
  };
}

export async function imageAtFiveMib() {
  const { crc32 } = await import("node:zlib");
  const fixture = await imageFixture("png");
  const target = 5 * 1024 * 1024;
  const payloadSize = target - fixture.buffer.length - 12;
  const chunk = Buffer.alloc(payloadSize + 12);
  chunk.writeUInt32BE(payloadSize, 0);
  chunk.write("vpAg", 4, "ascii");
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, chunk.length - 4)),
    chunk.length - 4,
  );
  const buffer = Buffer.concat([
    fixture.buffer.subarray(0, fixture.buffer.length - 12),
    chunk,
    fixture.buffer.subarray(fixture.buffer.length - 12),
  ]);
  return { ...fixture, buffer, size: buffer.length };
}
