import { requireDatabaseUrl } from "../config/env";
import { getPrisma } from "../utils/database";
import { EMAIL_ATTEMPTS } from "../utils/email-outbox";

async function main() {
  const [action, id, ...flags] = process.argv.slice(2);
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new Error("Cần cung cấp một outbox UUID hợp lệ");
  const target = new URL(requireDatabaseUrl());
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    const azureHost = process.env.AZURE_DATABASE_HOST;
    if (
      !flags.includes("--azure") ||
      !azureHost ||
      target.hostname !== azureHost
    )
      throw new Error(
        "Azure yêu cầu --azure và AZURE_DATABASE_HOST khớp chính xác",
      );
  }
  const db = await getPrisma();
  try {
    const row = await db.emailOutbox.findUnique({
      where: { id },
      select: {
        id: true,
        registrationId: true,
        status: true,
        attempts: true,
        firstAttemptAt: true,
        providerMessageId: true,
      },
    });
    if (!row) throw new Error("Không tìm thấy outbox ID");
    if (action === "status") {
      console.log(JSON.stringify(row));
      return;
    }
    if (action !== "retry" || row.status !== "FAILED")
      throw new Error("Chỉ có thể gửi lại outbox FAILED");
    const uncertain =
      row.firstAttemptAt &&
      Date.now() - row.firstAttemptAt.getTime() >= 24 * 60 * 60 * 1000;
    if (uncertain && !flags.includes("--confirm-possible-duplicate"))
      throw new Error(
        "Cần đối soát với Resend trước; sau đó truyền --confirm-possible-duplicate",
      );
    const result = await db.emailOutbox.updateMany({
      where: { id, status: "FAILED", attempts: { lte: EMAIL_ATTEMPTS } },
      data: {
        status: "PENDING",
        attempts: 0,
        firstAttemptAt: null,
        lockedUntil: null,
        nextAttemptAt: new Date(),
      },
    });
    if (!result.count) throw new Error("Outbox đã được thay đổi; kiểm tra lại");
    console.log(JSON.stringify({ id, status: "PENDING" }));
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Không thể thao tác email outbox",
  );
  process.exitCode = 1;
});
