import { Queue, Worker } from "bullmq";
import { createClient } from "redis";
import type { PrismaClient } from "../generated/prisma/client";
import { requireRedisUrl } from "../config/env";
import { sendMail, type MailOptions } from "./mailer";

export const EMAIL_ATTEMPTS = 5;
const prefix = "foodprint:queue";
const name = "registration-review-email";
const retryDelay = (attempt: number) => 5000 * 2 ** (attempt - 1);
const reservationMs = 60_000;
const dedupeWindowMs = 24 * 60 * 60 * 1000;
const connections = new WeakMap<object, ReturnType<typeof queueConnection>>();

function queueConnection(worker = false) {
  return createClient({
    url: requireRedisUrl(),
    disableOfflineQueue: !worker,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries: number) =>
        !worker && retries >= 3 ? false : Math.min(200 * 2 ** retries, 5000),
    },
  });
}

export type EmailSender = (mail: MailOptions) => Promise<{ id: string }>;

export async function processEmailOutbox(
  db: PrismaClient,
  id: string,
  sender: EmailSender = sendMail,
): Promise<void> {
  const now = new Date();
  const previous = await db.emailOutbox.findUnique({
    where: { id },
    select: { attempts: true, firstAttemptAt: true },
  });
  if (!previous) return;
  const claim = await db.emailOutbox.updateMany({
    where: {
      id,
      attempts: previous.attempts,
      AND: [
        { attempts: { lt: EMAIL_ATTEMPTS } },
        { firstAttemptAt: previous.firstAttemptAt },
        {
          OR: [
            { firstAttemptAt: null },
            {
              firstAttemptAt: { gt: new Date(now.getTime() - dedupeWindowMs) },
            },
          ],
        },
      ],
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", lockedUntil: { lt: now } },
      ],
    },
    data: {
      status: "PROCESSING",
      lockedUntil: new Date(now.getTime() + reservationMs),
      attempts: { increment: 1 },
      firstAttemptAt: previous.firstAttemptAt ?? now,
    },
  });
  if (!claim.count) return;
  const row = await db.emailOutbox.findUniqueOrThrow({ where: { id } });
  try {
    const sent = await sender({
      to: row.recipientEmail,
      subject: row.subject,
      text: row.text,
      html: row.html,
      idempotencyKey: `registration-review/${id}`,
    });
    await db.emailOutbox.updateMany({
      where: { id, status: "PROCESSING", attempts: row.attempts },
      data: {
        status: "ACCEPTED",
        providerMessageId: sent.id,
        lockedUntil: null,
      },
    });
  } catch {
    const exhausted = row.attempts >= EMAIL_ATTEMPTS;
    await db.emailOutbox.updateMany({
      where: { id, status: "PROCESSING", attempts: row.attempts },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + retryDelay(row.attempts)),
      },
    });
    throw new Error("Registration review email was not accepted");
  }
}

export function createEmailQueue(queuePrefix = prefix) {
  const connection = queueConnection();
  const queue = new Queue(name, {
    prefix: queuePrefix,
    connection,
  });
  connections.set(queue, connection);
  return queue;
}

export async function closeEmailQueue(
  queue: ReturnType<typeof createEmailQueue>,
) {
  await queue.close();
  const connection = connections.get(queue);
  if (connection?.isOpen) await connection.quit();
}

export function createEmailWorker(
  db: PrismaClient,
  sender: EmailSender = sendMail,
  queuePrefix = prefix,
) {
  const connection = queueConnection(true);
  const worker = new Worker(
    name,
    async (job) => {
      const data: unknown = job.data;
      if (
        !data ||
        typeof data !== "object" ||
        !("id" in data) ||
        typeof data.id !== "string"
      )
        throw new Error("Email job ID is invalid");
      await processEmailOutbox(db, data.id, sender);
    },
    {
      prefix: queuePrefix,
      connection,
      concurrency: 1,
    },
  );
  connections.set(worker, connection);
  return worker;
}

export async function closeEmailWorker(
  worker: ReturnType<typeof createEmailWorker>,
) {
  await worker.close();
  const connection = connections.get(worker);
  if (connection?.isOpen) await connection.quit();
}

export async function dispatchEmailOutbox(
  db: PrismaClient,
  queue: ReturnType<typeof createEmailQueue>,
): Promise<void> {
  const now = new Date();
  const expired = new Date(now.getTime() - dedupeWindowMs);
  await db.emailOutbox.updateMany({
    where: {
      firstAttemptAt: { lte: expired },
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", lockedUntil: { lt: now } },
      ],
    },
    data: { status: "FAILED", lockedUntil: null },
  });
  await db.emailOutbox.updateMany({
    where: {
      attempts: { gte: EMAIL_ATTEMPTS },
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", lockedUntil: { lt: now } },
      ],
    },
    data: { status: "FAILED", lockedUntil: null },
  });
  const rows = await db.emailOutbox.findMany({
    where: {
      attempts: { lt: EMAIL_ATTEMPTS },
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", lockedUntil: { lt: now } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const row of rows) {
    const old = await queue.getJob(row.id);
    if (old) {
      const state = await old.getState();
      if (state !== "completed" && state !== "failed") continue;
      await old.remove();
    }
    await queue.add(
      "send",
      { id: row.id },
      {
        jobId: row.id,
        attempts: EMAIL_ATTEMPTS,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
      },
    );
  }
}
