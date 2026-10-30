import assert from "node:assert/strict";
import { prisma } from "../config/prisma";
import { verifyBaseline } from "../utils/migration-baseline";

async function main(): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe(
          "SET LOCAL search_path TO pg_catalog, public",
        );
        const checksum = await verifyBaseline((sql) =>
          tx.$queryRawUnsafe<unknown[]>(sql),
        );
        const historyTables = await tx.$queryRawUnsafe<
          { schema_name: string }[]
        >(
          "SELECT n.nspname AS schema_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='_prisma_migrations' AND c.relkind='r'",
        );
        assert(
          historyTables.every((table) => table.schema_name === "foodprint"),
          "Đã có lịch sử migration trong namespace khác; cần đối chiếu riêng",
        );
        if (historyTables.length) {
          const history = await tx.$queryRawUnsafe<
            {
              migration_name: string;
              checksum: string;
              finished_at: Date | null;
              rolled_back_at: Date | null;
            }[]
          >(
            "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations",
          );
          assert(
            history.every(
              (row) =>
                row.migration_name === "0_init" &&
                row.checksum === checksum &&
                row.finished_at !== null &&
                row.rolled_back_at === null,
            ),
            "Lịch sử migration không khớp baseline ban đầu; cần đối chiếu riêng",
          );
        }
      },
      { maxWait: 10_000, timeout: 30_000, isolationLevel: "RepeatableRead" },
    );
    console.log(
      "PASS: cấu trúc database khớp 0_init, gồm CHECK, FK, enum và partial index. Chưa ghi lịch sử migration.",
    );
  } catch (error) {
    // Only baseline mismatch details are safe to expose; connection errors may contain secrets.
    console.error(
      "FAIL: chưa thể xác nhận baseline. Không chạy migrate resolve/deploy.",
    );
    if (error instanceof Error && error.name === "AssertionError")
      console.error(error.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
