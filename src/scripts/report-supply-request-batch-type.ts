import { prisma } from "../config/prisma";

// Chỉ đọc: liệt kê đơn chưa backfill được order_type / batch_no (task TASK-05, D4).
async function main(): Promise<void> {
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return tx.$queryRaw<{ id: string; request_no: string; reason: string }[]>`
        SELECT id, request_no, 'order_type IS NULL (đơn trộn loại hoặc không có dòng)' AS reason
        FROM foodprint.supply_requests WHERE order_type IS NULL
        UNION ALL
        SELECT id, request_no, 'DIRECT_USE nhưng batch_no IS NULL (mã không theo -D1/-D2)' AS reason
        FROM foodprint.supply_requests WHERE order_type = 'DIRECT_USE' AND batch_no IS NULL
        ORDER BY request_no`;
    });
    if (!rows.length) {
      console.log("PASS: mọi đơn đã có order_type/batch_no hợp lệ.");
      return;
    }
    for (const row of rows)
      console.log(`${row.id}\t${row.request_no}\t${row.reason}`);
    console.error(`FAIL: ${rows.length} đơn cần xử lý tay trước migration 2.`);
    process.exitCode = 1;
  } catch {
    console.error("FAIL: không thể chạy báo cáo đơn nhập hàng.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
