import { readBusinessCodeKey, requireDatabaseUrl } from "../config/env";
import { assertLocalMigrationTarget } from "../utils/migration-target";
import {
  assertAzureMigrationTarget,
  pendingDeploymentMigrations,
  readMigrationFiles,
  type MigrationHistoryRow,
} from "../utils/migration-deployment";
import { getPrisma } from "../utils/database";
import {
  backfillBusinessCodes,
  createBusinessCodeBackfillRepository,
} from "../utils/business-code-backfill";

/**
 * Thao tác vận hành: gán mã FP-IC cho sự cố ATTP cũ chưa có mã (khiếu nại đã có mã NOT NULL ở bảng cha).
 * Mặc định chỉ chạy trên PostgreSQL local; `--azure` là thao tác cần cho phép tường minh. CD không chạy script này.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--azure"))
    throw new Error("Chỉ hỗ trợ tùy chọn --azure");
  const url = requireDatabaseUrl();
  if (args.includes("--azure"))
    assertAzureMigrationTarget(url, process.env.AZURE_DATABASE_HOST);
  else assertLocalMigrationTarget(url);
  // Kiểm tra khóa trước khi mở kết nối để báo lỗi cấu hình sớm (không in giá trị khóa).
  readBusinessCodeKey();
  const db = await getPrisma();
  try {
    const history = await db.$queryRawUnsafe<MigrationHistoryRow[]>(
      "SELECT migration_name,checksum,finished_at,rolled_back_at FROM foodprint._prisma_migrations",
    );
    if (pendingDeploymentMigrations(await readMigrationFiles(), history).length)
      throw new Error("Cần áp dụng đủ migration trước khi backfill");
    const result = await backfillBusinessCodes(
      createBusinessCodeBackfillRepository(db),
    );
    console.log(
      `Backfill mã nghiệp vụ hoàn tất: ${result.IC} sự cố an toàn thực phẩm (FP-IC).`,
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  console.error(
    "Backfill mã nghiệp vụ chưa hoàn tất. Kiểm tra đích local/--azure, migration, BUSINESS_CODE_KEY và kết nối. Các lô đã commit được giữ; chạy lại sẽ tiếp tục với bản ghi còn thiếu mã.",
  );
  process.exitCode = 1;
});
