import { createHash } from "node:crypto";
import { HttpError } from "../../utils/http-error";

export const dayString = (value: Date) => value.toISOString().slice(0, 10);
export const schoolToday = () =>
  new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()) + "T00:00:00Z",
  );

type Evidence = {
  number: string | null;
  signedOn: Date | null;
  startsOn: Date | null;
  endsOn: Date | null;
  exemptionNote: string | null;
  items: readonly unknown[];
  documents: readonly { kind: string }[];
  certification: {
    status: string;
    issuedDate: Date | null;
    expiryDate: Date | null;
  } | null;
};

export function contractIssues(contract: Evidence, on: Date): string[] {
  const issues: string[] = [];
  if (!contract.number) issues.push("Chưa có số hợp đồng/phụ lục.");
  if (!contract.signedOn || contract.signedOn > schoolToday())
    issues.push("Chưa có ngày ký hợp lệ.");
  if (!contract.startsOn || !contract.endsOn)
    issues.push("Chưa đủ thời hạn hợp đồng.");
  else if (contract.startsOn > on || contract.endsOn < on)
    issues.push("Hợp đồng chưa có hiệu lực hoặc đã hết hạn tại ngày áp dụng.");
  if (
    contract.startsOn &&
    contract.endsOn &&
    contract.startsOn > contract.endsOn
  )
    issues.push("Thời hạn hợp đồng không hợp lệ.");
  if (!contract.items.length)
    issues.push("Chưa chọn nguyên liệu được phép cung cấp.");
  if (!contract.documents.some((file) => file.kind === "SIGNED_CONTRACT"))
    issues.push("Chưa tải bản hợp đồng đã ký.");
  if (!contract.documents.some((file) => file.kind === "COMPLIANCE"))
    issues.push("Chưa tải hồ sơ pháp lý/ATTP áp dụng.");
  if (contract.certification) {
    const cert = contract.certification;
    if (
      cert.status !== "ACTIVE" ||
      (cert.issuedDate && cert.issuedDate > on) ||
      (cert.expiryDate && cert.expiryDate < on)
    )
      issues.push("Chứng nhận không còn hiệu lực tại ngày áp dụng.");
  } else if (!contract.exemptionNote?.trim())
    issues.push("Chọn chứng nhận hoặc ghi rõ căn cứ hồ sơ áp dụng/miễn cấp.");
  return issues;
}

export function validateDocument(buffer: Buffer, originalName: string) {
  if (!buffer.length || buffer.length > 10 * 1024 * 1024)
    throw new HttpError(400, "Tệp phải từ 1 byte đến 10 MB.");
  const mimeType =
    buffer.subarray(0, 5).toString() === "%PDF-"
      ? "application/pdf"
      : buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
          ? "image/jpeg"
          : null;
  if (!mimeType)
    throw new HttpError(400, "Chỉ nhận tệp PDF, PNG hoặc JPEG đúng định dạng.");
  const baseName = originalName.split(/[\\/]/).pop() || "ho-so";
  const fileName =
    Array.from(baseName)
      .filter((character) => {
        const code = character.codePointAt(0)!;
        return code >= 32 && code !== 127;
      })
      .join("")
      .trim()
      .slice(0, 255) || "ho-so";
  return {
    fileName,
    mimeType,
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    content: new Uint8Array(buffer),
  };
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
) {
  return aStart <= bEnd && bStart <= aEnd;
}
