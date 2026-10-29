import { prisma } from "../config/prisma";
import {
  assertAzureMigrationTarget,
  MigrationDeploymentError,
  pendingDeploymentMigrations,
  readMigrationFiles,
  type MigrationHistoryRow,
} from "../utils/migration-deployment";

async function main(): Promise<void> {
  try {
    assertAzureMigrationTarget(
      process.env.DATABASE_URL,
      process.env.AZURE_DATABASE_HOST,
    );
    const files = await readMigrationFiles();
    const pending = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const tables = await tx.$queryRawUnsafe<{ name: string | null }[]>(
          "SELECT to_regclass('foodprint._prisma_migrations')::text AS name",
        );
        if (tables[0]?.name === null) {
          throw new MigrationDeploymentError(
            "Chưa có lịch sử Prisma; cần nhận baseline thủ công trước khi bật CD",
          );
        }
        const history = await tx.$queryRawUnsafe<MigrationHistoryRow[]>(
          "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations",
        );
        return pendingDeploymentMigrations(files, history);
      },
      { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 30_000 },
    );
    console.log(
      `PASS: đích Azure và checksum lịch sử hợp lệ; ${pending.length} migration đang chờ. Chỉ đọc database.`,
    );
  } catch (error) {
    console.error(
      error instanceof MigrationDeploymentError
        ? error.message
        : "Không xác minh được lịch sử triển khai. Kiểm tra kết nối/quyền database và file migration; chưa được phép deploy tiếp.",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
