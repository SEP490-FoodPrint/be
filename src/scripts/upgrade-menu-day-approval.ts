import { Client } from "pg";
import { requireDatabaseUrl } from "../config/env";

// Additive local upgrade: preserve historical week decisions on every existing day.
async function main(): Promise<void> {
  const connectionString = requireDatabaseUrl();
  const target = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("Chỉ được nâng cấp database local.");
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'foodprint' AND table_name = 'menu_days' AND column_name = 'approval_status'",
    );
    await client.query(`
      ALTER TABLE foodprint.menu_days
        ADD COLUMN IF NOT EXISTS approval_status foodprint.weekly_menu_status NOT NULL DEFAULT 'PENDING_APPROVAL';
      ALTER TABLE foodprint.menu_review_records
        ADD COLUMN IF NOT EXISTS menu_day_id uuid REFERENCES foodprint.menu_days(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_menu_review_records_menu_day
        ON foodprint.menu_review_records(menu_day_id);
    `);
    if (!existing.rowCount) {
      await client.query(`
        UPDATE foodprint.menu_days d
        SET approval_status = m.status, updated_at = now()
        FROM foodprint.weekly_menus m WHERE d.weekly_menu_id = m.id;
      `);
    }
    await client.query("COMMIT");
    console.log(
      "Đã bổ sung duyệt thực đơn theo ngày; giữ nguyên dữ liệu hiện có.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
