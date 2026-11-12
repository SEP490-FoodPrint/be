import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { requireDatabaseUrl } from "./env";

const connectionString = requireDatabaseUrl();
const schema = new URL(connectionString).searchParams.get("schema") || "public";
const isAzure = connectionString.includes("azure.com");

interface GlobalPrismaContext {
  prisma?: PrismaClient;
  prismaAdapter?: PrismaPg;
}

const globalForPrisma = globalThis as unknown as GlobalPrismaContext;

export const adapter =
  globalForPrisma.prismaAdapter ??
  new PrismaPg(
    {
      connectionString,
      max: 20,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 120000,
      statement_timeout: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      ...(isAzure ? { ssl: { rejectUnauthorized: false } } : {}),
    },
    { schema },
  );

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter, log: [] });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaAdapter = adapter;
}

export const connectDB = async (): Promise<void> => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  console.log(
    `🐘 Kết nối PostgreSQL ${isAzure ? "Azure Cloud" : "Local"} qua Prisma thành công!`,
  );
};

export default prisma;
