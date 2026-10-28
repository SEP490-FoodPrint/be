import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { requireDatabaseUrl } from "./env";

const connectionString = requireDatabaseUrl();
const schema = new URL(connectionString).searchParams.get("schema") || "public";
const isAzure = connectionString.includes("azure.com");

const adapter = new PrismaPg(
  {
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
    ...(isAzure ? { ssl: { rejectUnauthorized: false } } : {}),
  },
  { schema },
);

export const prisma = new PrismaClient({ adapter, log: [] });

export const connectDB = async (): Promise<void> => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  console.log(
    `🐘 Kết nối PostgreSQL ${isAzure ? "Azure Cloud" : "Local"} qua Prisma thành công!`,
  );
};

export default prisma;
