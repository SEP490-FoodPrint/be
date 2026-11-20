import { prisma } from "../config/prisma";
import { readHandlingAudit } from "../modules/supplier-onboarding/supplier-onboarding.repository";

// Chỉ đọc: liệt kê theo trường các nguyên liệu trong hợp đồng ACTIVE chưa có
// IngredientEntry và các dòng hồ sơ chưa có loại. Không gán loại mặc định.
async function main(): Promise<void> {
  try {
    const { items, entries } = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return readHandlingAudit(tx);
      },
      { isolationLevel: "RepeatableRead" },
    );
    const hasEntry = new Set(
      entries.map((entry) => `${entry.schoolId}:${entry.ingredientId}`),
    );
    const bySchool = new Map<
      string,
      { missing: string[]; untyped: string[] }
    >();
    for (const item of items) {
      const school = item.contract.school.name;
      const report = bySchool.get(school) ?? { missing: [], untyped: [] };
      const line = `${item.ingredient.name} — ${item.contract.supplier.name} — hợp đồng ${item.contract.number ?? item.contract.id} (${item.contract.status})`;
      if (
        item.contract.status === "ACTIVE" &&
        !hasEntry.has(`${item.contract.schoolId}:${item.ingredientId}`)
      )
        report.missing.push(line);
      if (!item.handlingType) report.untyped.push(line);
      bySchool.set(school, report);
    }
    let problems = 0;
    for (const [school, report] of bySchool) {
      if (!report.missing.length && !report.untyped.length) continue;
      console.log(`\n# ${school}`);
      if (report.missing.length) {
        console.log(
          "  Nguyên liệu trong hợp đồng ACTIVE chưa có IngredientEntry:",
        );
        report.missing.forEach((line) => console.log(`  - ${line}`));
      }
      if (report.untyped.length) {
        console.log("  Dòng hồ sơ chưa chọn loại (handling_type NULL):");
        report.untyped.forEach((line) => console.log(`  - ${line}`));
      }
      problems += report.missing.length + report.untyped.length;
    }
    console.log(
      problems
        ? `\nCần xử lý ${problems} dòng. Chọn loại qua trang chi tiết nhà cung cấp hoặc script ghi được duyệt riêng.`
        : "PASS: không có nguyên liệu thiếu entry hoặc thiếu loại.",
    );
  } catch {
    console.error("FAIL: không thể đối soát loại nguyên liệu.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
