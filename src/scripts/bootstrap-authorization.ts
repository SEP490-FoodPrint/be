import { requireDatabaseUrl } from "../config/env";
import { assertLocalMigrationTarget } from "../utils/migration-target";
import {
  assertAzureMigrationTarget,
  pendingDeploymentMigrations,
  readMigrationFiles,
  type MigrationHistoryRow,
} from "../utils/migration-deployment";
import { getPrisma } from "../utils/database";
import { bootstrapAuthorization } from "../utils/authorization-bootstrap";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--azure"))
    throw new Error("Chỉ hỗ trợ tùy chọn --azure");
  const url = requireDatabaseUrl();
  if (args.includes("--azure"))
    assertAzureMigrationTarget(url, process.env.AZURE_DATABASE_HOST);
  else assertLocalMigrationTarget(url);
  const db = await getPrisma();
  try {
    const history = await db.$queryRawUnsafe<MigrationHistoryRow[]>(
      "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations",
    );
    if (pendingDeploymentMigrations(await readMigrationFiles(), history).length)
      throw new Error("Cần áp dụng đủ migration trước khi bootstrap");
    const result = await bootstrapAuthorization(db);
    console.log(
      `Bootstrap hoàn tất: ${result.assignmentsCreated} liên kết role-permission được thêm. Không tạo tài khoản hoặc mock data.`,
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "Bootstrap chưa hoàn tất. Kiểm tra đích local/--azure, migration, kết nối và dữ liệu catalog. Không tự reset hoặc sửa dữ liệu hiện có.",
  );
  process.exitCode = 1;
});
