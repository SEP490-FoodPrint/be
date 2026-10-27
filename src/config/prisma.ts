import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { requireDatabaseUrl } from "./env";

const connectionString = requireDatabaseUrl();
const schema = new URL(connectionString).searchParams.get("schema") || "public";
const adapter = new PrismaPg(
  {
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  },
  { schema },
);

export const prisma = new PrismaClient({ adapter, log: [] });

export const connectDB = async (): Promise<void> => {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  console.log("Kết nối PostgreSQL local qua Prisma thành công");
};

export default prisma;
