import { prisma } from "../config/prisma";
import { readLifecyclePreflight } from "../modules/account-lifecycle/account-lifecycle-data.repository";

async function main(): Promise<void> {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return readLifecyclePreflight(tx);
      },
      { isolationLevel: "RepeatableRead" },
    );
    if (!result.ok) {
      console.error(
        `FAIL: ${result.duplicateUnits} xã có nhiều cán bộ; ${result.unresolvedUnits} xã có yêu cầu chưa xác định được cán bộ; ${result.mismatchedRecipients} người nhận không khớp; ${result.invalidOfficers} cán bộ có tổ chức không hợp lệ.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log("PASS: không phát hiện xung đột dữ liệu cán bộ ATTP.");
  } catch {
    console.error("FAIL: không thể kiểm tra dữ liệu cán bộ ATTP.");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
