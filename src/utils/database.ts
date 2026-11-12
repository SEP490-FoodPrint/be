import type { PrismaClient } from "../generated/prisma/client";

let cachedPrisma: PrismaClient | null = null;

/** Reuse the shared client without initializing PostgreSQL when importing routes. */
export async function getPrisma(): Promise<PrismaClient> {
  if (cachedPrisma) return cachedPrisma;
  const { prisma } = await import("../config/prisma.js");
  cachedPrisma = prisma;
  return prisma;
}
