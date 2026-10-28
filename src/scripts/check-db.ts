import { connectDB, prisma } from "../config/prisma";

function connectionCode(error: unknown, depth = 0): string | undefined {
  if (typeof error !== "object" || error === null || depth > 5)
    return undefined;
  for (const key of ["cause", "meta", "driverAdapterError"]) {
    const nested = connectionCode(Reflect.get(error, key), depth + 1);
    if (nested) return nested;
  }
  const code: unknown =
    Reflect.get(error, "originalCode") ??
    Reflect.get(error, "code") ??
    Reflect.get(error, "errorCode");
  return typeof code === "string" && /^[A-Z0-9]+$/.test(code)
    ? code
    : undefined;
}

async function main(): Promise<void> {
  try {
    await connectDB();
    console.log("PASS: Prisma SELECT 1");
  } catch (error) {
    console.error(
      "FAIL: Không thể kết nối PostgreSQL local. Kiểm tra DATABASE_URL.",
    );
    const code = connectionCode(error);
    if (code) console.error(`Mã lỗi kết nối: ${code}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
