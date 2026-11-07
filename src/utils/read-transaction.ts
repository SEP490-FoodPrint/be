import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { getPrisma } from "./database";
import { HttpError } from "./http-error";

export async function withReadTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  connect: () => Promise<PrismaClient> = getPrisma,
): Promise<T> {
  try {
    const client = await connect();
    return await client.$transaction(operation, {
      isolationLevel: "RepeatableRead",
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Không thể tải dữ liệu. Vui lòng thử lại sau.");
  }
}
