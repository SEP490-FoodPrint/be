import { getPrisma } from "../utils/database";
import { startEmailRuntime } from "../utils/email-runtime";

async function main() {
  const db = await getPrisma();
  await db.$connect();
  let runtime: Awaited<ReturnType<typeof startEmailRuntime>>;
  try {
    runtime = await startEmailRuntime(db);
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const stop = async () => {
    closing ??= (async () => {
      try {
        await runtime.stop();
      } finally {
        await db.$disconnect();
      }
    })();
    try {
      await closing;
    } catch {
      console.error("Không thể đóng đầy đủ email worker.");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

void main().catch(() => {
  console.error("Không thể chạy email worker. Kiểm tra PostgreSQL và Redis.");
  process.exitCode = 1;
});
