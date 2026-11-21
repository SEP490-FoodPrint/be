import type { PrismaClient } from "../generated/prisma/client";
import { feedbackWindowStart } from "../modules/complaint-ticket/complaint-ticket.lifecycle";
import {
  complaintTicketRepository,
  type ComplaintTicketRepository,
} from "../modules/complaint-ticket/complaint-ticket.repository";

export const AUTO_CLOSE_BATCH_SIZE = 100;
export const AUTO_CLOSE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Đóng (`AUTO_CLOSED`) các đơn khiếu nại `RESOLVED` quá 48h không được người gửi đánh giá
 * (specs/complaint-supertype, FR-008). Mỗi lô một transaction; mỗi đơn đóng bằng cập nhật có điều kiện
 * nên chạy lặp hoặc song song nhiều tiến trình không đóng trùng. Không gửi thông báo.
 */
export async function autoCloseExpiredComplaints(
  db: PrismaClient,
  options: {
    now?: () => Date;
    batchSize?: number;
    repository?: ComplaintTicketRepository;
  } = {},
): Promise<number> {
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? AUTO_CLOSE_BATCH_SIZE;
  const repository = options.repository ?? complaintTicketRepository;
  let closed = 0;
  for (;;) {
    const at = now();
    const cutoff = feedbackWindowStart(at);
    const ids = await repository.findDueResolved(db, cutoff, batchSize);
    if (ids.length === 0) break;
    const batchClosed = await db.$transaction(
      async (tx) => {
        let count = 0;
        for (const id of ids) {
          if (await repository.autoClose(tx, id, cutoff, at)) count += 1;
        }
        return count;
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    closed += batchClosed;
    // Lô không đóng được đơn nào (đã bị thao tác khác giành) thì dừng để tránh lặp vô hạn.
    if (ids.length < batchSize || batchClosed === 0) break;
  }
  return closed;
}

interface AutoCloseRuntimeDependencies {
  run: (db: PrismaClient) => Promise<number>;
  schedule: (tick: () => void) => () => void;
  logError: (message: string) => void;
}

const defaults: AutoCloseRuntimeDependencies = {
  run: (db) => autoCloseExpiredComplaints(db),
  schedule(tick) {
    const timer = setInterval(tick, AUTO_CLOSE_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  },
  logError: console.error,
};

/** Chạy job tự đóng định kỳ trong tiến trình API; không chạy chồng; `stop()` chờ lượt đang chạy. */
export function startComplaintAutoCloseRuntime(
  db: PrismaClient,
  dependencies: AutoCloseRuntimeDependencies = defaults,
) {
  let closing = false;
  let active: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  const tick = () => {
    if (closing || active) return;
    active = Promise.resolve()
      .then(() => dependencies.run(db))
      .then(() => undefined)
      .catch(() =>
        dependencies.logError(
          "Job tự đóng khiếu nại tạm thời không hoạt động.",
        ),
      )
      .finally(() => {
        active = undefined;
      });
  };
  const cancel = dependencies.schedule(tick);
  tick();
  return {
    stop(): Promise<void> {
      stopping ??= (async () => {
        closing = true;
        cancel();
        await active;
      })();
      return stopping;
    },
  };
}
