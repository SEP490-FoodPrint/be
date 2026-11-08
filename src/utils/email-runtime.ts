import type { PrismaClient } from "../generated/prisma/client";
import {
  closeEmailQueue,
  closeEmailWorker,
  createEmailQueue,
  createEmailWorker,
  dispatchEmailOutbox,
} from "./email-outbox";

interface EmailRuntimeDependencies {
  createQueue: typeof createEmailQueue;
  createWorker: typeof createEmailWorker;
  dispatch: typeof dispatchEmailOutbox;
  closeQueue: typeof closeEmailQueue;
  closeWorker: typeof closeEmailWorker;
  schedule: (tick: () => void) => () => void;
  logError: (message: string, details?: { outboxId: string }) => void;
}

const defaults: EmailRuntimeDependencies = {
  createQueue: createEmailQueue,
  createWorker: createEmailWorker,
  dispatch: dispatchEmailOutbox,
  closeQueue: closeEmailQueue,
  closeWorker: closeEmailWorker,
  schedule(tick) {
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  },
  logError: console.error,
};

/** Own queue/worker resources; the caller owns the shared database connection. */
export async function startEmailRuntime(
  db: PrismaClient,
  dependencies: EmailRuntimeDependencies = defaults,
) {
  const queue = dependencies.createQueue();
  queue.on("error", () =>
    dependencies.logError("Email queue gặp lỗi kết nối."),
  );
  let worker: ReturnType<typeof createEmailWorker>;
  try {
    worker = dependencies.createWorker(db);
  } catch (error) {
    await dependencies.closeQueue(queue);
    throw error;
  }
  worker.on("error", () =>
    dependencies.logError("Email worker gặp lỗi kết nối."),
  );
  worker.on("failed", (job) => {
    const data: unknown = job?.data;
    const id =
      data && typeof data === "object" && "id" in data ? data.id : undefined;
    const details =
      typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        ? { outboxId: id }
        : undefined;
    dependencies.logError("Email chưa được tiếp nhận", details);
  });

  let closing = false;
  let active: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const tick = () => {
    if (closing || active) return;
    active = Promise.resolve()
      .then(() => dependencies.dispatch(db, queue))
      .catch(() =>
        dependencies.logError("Email dispatcher tạm thời không hoạt động."),
      )
      .finally(() => {
        active = undefined;
      });
  };
  let cancel: () => void;
  try {
    cancel = dependencies.schedule(tick);
  } catch (error) {
    try {
      await dependencies.closeWorker(worker);
    } finally {
      await dependencies.closeQueue(queue);
    }
    throw error;
  }
  tick();
  return {
    stop(): Promise<void> {
      stopping ??= (async () => {
        closing = true;
        cancel();
        await active;
        try {
          await dependencies.closeWorker(worker);
        } finally {
          await dependencies.closeQueue(queue);
        }
      })();
      return stopping;
    },
  };
}
