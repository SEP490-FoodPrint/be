import { getPrisma } from "../utils/database";
import {
  closeEmailQueue,
  closeEmailWorker,
  createEmailQueue,
  createEmailWorker,
  dispatchEmailOutbox,
} from "../utils/email-outbox";

async function main() {
  const db = await getPrisma();
  await db.$connect();
  const queue = createEmailQueue();
  const worker = createEmailWorker(db);
  worker.on("error", () => console.error("Email worker gặp lỗi kết nối."));
  worker.on("failed", (job) => {
    const data: unknown = job?.data;
    const outboxId =
      data &&
      typeof data === "object" &&
      "id" in data &&
      typeof data.id === "string"
        ? data.id
        : undefined;
    console.error("Email chưa được tiếp nhận", { outboxId });
  });
  let closing = false;
  let dispatching = false;
  const tick = async () => {
    if (closing || dispatching) return;
    dispatching = true;
    try {
      await dispatchEmailOutbox(db, queue);
    } catch {
      console.error("Email dispatcher tạm thời không hoạt động.");
    } finally {
      dispatching = false;
    }
  };
  const timer = setInterval(() => void tick(), 5000);
  void tick();
  const stop = async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await closeEmailWorker(worker);
    await closeEmailQueue(queue);
    await db.$disconnect();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

void main().catch(() => {
  console.error("Không thể chạy email worker. Kiểm tra PostgreSQL và Redis.");
  process.exitCode = 1;
});
