import type { PrismaClient } from "../generated/prisma/client";

/** Reuse the shared client without initializing PostgreSQL when importing routes. */
export async function getPrisma(): Promise<PrismaClient> {
  const { prisma } = await import("../config/prisma.js");
  return prisma;
}
