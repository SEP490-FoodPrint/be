import bcrypt from "bcryptjs";
import { requireDatabaseUrl } from "../config/env";
import { assertAzureMigrationTarget } from "../utils/migration-deployment";
import { assertLocalMigrationTarget } from "../utils/migration-target";
import { getPrisma } from "../utils/database";
import { schoolToday } from "../modules/supplier-onboarding/supplier-onboarding.rules";

async function main() {
  if (process.argv.includes("--azure"))
    assertAzureMigrationTarget(
      requireDatabaseUrl(),
      process.env.AZURE_DATABASE_HOST,
    );
  else assertLocalMigrationTarget(requireDatabaseUrl());
  if (!process.env.SEED_TEST_PASSWORD)
    throw new Error("Thiếu SEED_TEST_PASSWORD cho tài khoản test mới.");
  const db = await getPrisma();
  try {
    const schoolId = "10000000-0000-4000-8000-000000000001";
    if (
      !(await db.school.findUnique({
        where: { id: schoolId },
        select: { id: true },
      }))
    )
      throw new Error("Chưa có trường test.");
    // Use the shared location directory as stored; do not import or rewrite administrative boundaries.
    const province = await db.location.findFirst({
      where: { isActive: true, code: "HN", parentId: null },
      select: { id: true, name: true },
    });
    const wards = province
      ? await db.location.findMany({
          where: { parentId: province.id, isActive: true },
          orderBy: { code: "asc" },
          take: 2,
        })
      : [];
    const role = await db.role.findUniqueOrThrow({
      where: { code: "INGREDIENT_MANAGEMENT_DEPARTMENT" },
      select: { id: true },
    });
    const passwordHash = await bcrypt.hash(process.env.SEED_TEST_PASSWORD, 12);
    await db.$transaction(
      async (tx) => {
        await tx.user.createMany({
          data: [
            {
              id: "79000000-0000-4000-8000-000000000001",
              username: "school_warehouse_test",
              email: "warehouse-test@foodprint.local",
              fullName: "[TEST] Bộ phận kho Cầu Giấy",
              roleId: role.id,
              roleCode: "INGREDIENT_MANAGEMENT_DEPARTMENT",
              schoolId,
              passwordHash,
              status: "ACTIVE",
            },
          ],
          skipDuplicates: true,
        });
        for (let index = 1; index <= 2; index++) {
          const supplierId = `80000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
          const ward = wards[index - 1];
          await tx.supplier.createMany({
            data: [
              {
                id: supplierId,
                name: `[TEST] Nhà cung cấp kiểm thử hợp đồng ${index}`,
                taxCode: `TEST-FP-CONTRACT-0${index}`,
                status: "ACTIVE",
                locationId: ward?.id || province?.id,
                address:
                  ward && province
                    ? `${ward.name}, ${province.name} (dữ liệu kiểm thử)`
                    : "Địa chỉ kiểm thử",
                email: `supplier-contract-${index}@foodprint.local`,
              },
            ],
            skipDuplicates: true,
          });
          if (province)
            await tx.supplierServiceArea.createMany({
              data: [
                {
                  supplierId,
                  locationId: index === 1 && ward ? ward.id : province.id,
                },
              ],
              skipDuplicates: true,
            });
          const ingredientId = `81000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
          await tx.ingredient.createMany({
            data: [
              {
                id: ingredientId,
                supplierId,
                name: index === 1 ? "[TEST] Gạo tẻ" : "[TEST] Rau cải",
                category: index === 1 ? "Gạo / ngũ cốc" : "Rau củ",
                defaultUnit: "kg",
                status: "ACTIVE",
              },
            ],
            skipDuplicates: true,
          });
          await tx.ingredientEntry.createMany({
            data: [
              {
                id: `82000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
                schoolId,
                ingredientId,
                handlingType: index === 1 ? "DRY_STOCK" : "DIRECT_USE",
                status: "ACTIVE",
              },
            ],
            skipDuplicates: true,
          });
          const issuedDate = schoolToday();
          issuedDate.setUTCFullYear(issuedDate.getUTCFullYear() - 1);
          const expiryDate = schoolToday();
          expiryDate.setUTCFullYear(expiryDate.getUTCFullYear() + 1);
          await tx.supplierCertification.createMany({
            data: [
              {
                id: `83000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
                supplierId,
                certificationType:
                  "[TEST] Hồ sơ ATTP kiểm thử — không phải chứng nhận thật",
                certificateNo: `TEST-ATTP-0${index}`,
                issuedDate,
                expiryDate,
                status: "ACTIVE",
              },
            ],
            skipDuplicates: true,
          });
        }
      },
      { timeout: 30000 },
    );
    console.log(
      "Đã thêm 2 NCC test chưa liên kết, danh mục nguyên liệu và tài khoản kho test; không tạo hợp đồng ký giả, không sửa dữ liệu cũ.",
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  console.error(
    "Chưa hoàn tất seed liên kết NCC. Kiểm tra migration, đích database và dữ liệu trường test.",
  );
  process.exitCode = 1;
});
