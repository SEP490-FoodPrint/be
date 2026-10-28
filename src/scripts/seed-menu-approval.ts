import { getPrisma } from "../utils/database";

const ids = {
  school: "10000000-0000-4000-8000-000000000001",
  menu: "43000000-0000-4000-8000-000000000001",
  healthUser: "20000000-0000-4000-8000-000000000001",
  managementUser: "20000000-0000-4000-8000-000000000002",
  adminUser: "20000000-0000-4000-8000-000000000003",
  medicalReview: "44000000-0000-4000-8000-000000000001",
} as const;

const suppliers = [
  [
    "30000000-0000-4000-8000-000000000001",
    "SUP-XANH-SONG-HONG",
    "Thực phẩm Xanh Sông Hồng",
  ],
  ["30000000-0000-4000-8000-000000000002", "SUP-CP-FOODS", "CP Foods Việt Nam"],
  [
    "30000000-0000-4000-8000-000000000003",
    "SUP-RAU-VAN-NOI",
    "HTX Rau sạch Vân Nội",
  ],
  ["30000000-0000-4000-8000-000000000004", "SUP-VINAMILK", "Vinamilk"],
  [
    "30000000-0000-4000-8000-000000000005",
    "SUP-NONG-SAN",
    "Nông sản VietGAP miền Bắc",
  ],
] as const;

const roles = [
  ["SYSTEM_ADMIN", "SYSTEM"],
  ["INGREDIENT_SUPPLIER_ADMIN", "SUPPLIER"],
  ["SCHOOL_ADMINISTRATION", "SCHOOL"],
  ["SCHOOL_MANAGEMENT_BOARD", "SCHOOL"],
  ["SCHOOL_HEALTH_OFFICER", "SCHOOL"],
  ["SCHOOL_KITCHEN_STAFF", "SCHOOL"],
  ["HOMEROOM_TEACHER", "SCHOOL"],
  ["PARENTS_COMMITTEE", "SCHOOL"],
  ["INGREDIENT_MANAGEMENT_DEPARTMENT", "SCHOOL"],
] as const;

const users = [
  [
    "20000000-0000-4000-8000-000000000010",
    "system_admin",
    "Nguyễn Văn Toàn",
    "SYSTEM_ADMIN",
    null,
    null,
  ],
  [
    "20000000-0000-4000-8000-000000000011",
    "supplier_fresh",
    "Trần Thị Bích",
    "INGREDIENT_SUPPLIER_ADMIN",
    null,
    suppliers[0][0],
  ],
  [
    ids.adminUser,
    "school_admin",
    "Phạm Hải Đăng",
    "SCHOOL_ADMINISTRATION",
    ids.school,
    null,
  ],
  [
    ids.managementUser,
    "school_bgh",
    "Thầy Nguyễn Văn Minh",
    "SCHOOL_MANAGEMENT_BOARD",
    ids.school,
    null,
  ],
  [
    ids.healthUser,
    "school_health",
    "BS. Lê Thị Hoa",
    "SCHOOL_HEALTH_OFFICER",
    ids.school,
    null,
  ],
  [
    "20000000-0000-4000-8000-000000000012",
    "school_kitchen",
    "Đầu bếp Vũ Đình Trọng",
    "SCHOOL_KITCHEN_STAFF",
    ids.school,
    null,
  ],
  [
    "20000000-0000-4000-8000-000000000013",
    "school_teacher",
    "Cô Hoàng Thu Trang",
    "HOMEROOM_TEACHER",
    ids.school,
    null,
  ],
  [
    "20000000-0000-4000-8000-000000000014",
    "school_parents",
    "Ông Bùi Quốc Tuấn",
    "PARENTS_COMMITTEE",
    ids.school,
    null,
  ],
  [
    "20000000-0000-4000-8000-000000000015",
    "school_warehouse",
    "Đỗ Minh Quân",
    "INGREDIENT_MANAGEMENT_DEPARTMENT",
    ids.school,
    null,
  ],
] as const;

const dishes = [
  [
    "LUNCH",
    "Thịt kho trứng",
    "Thịt nạc kho cùng trứng và nước dừa",
    "SUP-CP-FOODS",
    "Thịt, trứng",
  ],
  [
    "LUNCH",
    "Rau củ xào",
    "Rau củ VietGAP xào trong ngày",
    "SUP-RAU-VAN-NOI",
    "Rau củ",
  ],
  [
    "LUNCH",
    "Canh bí đỏ",
    "Canh bí đỏ nấu thịt bằm",
    "SUP-XANH-SONG-HONG",
    "Bí đỏ",
  ],
  ["LUNCH", "Cơm trắng ST25", "Gạo sạch ST25", "SUP-NONG-SAN", "Gạo"],
  [
    "LUNCH",
    "Tráng miệng theo mùa",
    "Trái cây VietGAP theo mùa",
    "SUP-NONG-SAN",
    "Trái cây",
  ],
  [
    "AFTERNOON",
    "Súp gà ngô non",
    "Súp gà nấu ngô non và rau củ",
    "SUP-CP-FOODS",
    "Thịt gà",
  ],
  ["AFTERNOON", "Sữa chua", "Sữa chua men sống", "SUP-VINAMILK", "Sữa"],
] as const;

const menuDates = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
] as const;

const uuidFor = (prefix: string, day: number, item: number): string =>
  `${prefix.padEnd(8, "0")}-0000-4000-8000-${String(day).padStart(2, "0")}${String(item).padStart(10, "0")}`;

async function seed(): Promise<void> {
  const prisma = await getPrisma();

  await prisma.$transaction(
    async (transaction) => {
      await transaction.school.upsert({
        where: { id: ids.school },
        update: {
          name: "Trường Tiểu học Ánh Dương",
          code: "SCH_ANH_DUONG",
          address: "Cầu Giấy, Hà Nội",
          status: "ACTIVE",
        },
        create: {
          id: ids.school,
          name: "Trường Tiểu học Ánh Dương",
          code: "SCH_ANH_DUONG",
          address: "Cầu Giấy, Hà Nội",
          status: "ACTIVE",
        },
      });

      for (const [id, taxCode, name] of suppliers) {
        await transaction.supplier.upsert({
          where: { id },
          update: { taxCode, name, status: "ACTIVE" },
          create: { id, taxCode, name, status: "ACTIVE" },
        });
      }

      const roleIds = new Map<string, string>();
      for (let index = 0; index < roles.length; index += 1) {
        const [code, type] = roles[index];
        const role = await transaction.role.upsert({
          where: { code },
          update: { name: code, type },
          create: {
            id: `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            code,
            name: code,
            type,
          },
          select: { id: true },
        });
        roleIds.set(code, role.id);
      }

      for (const [
        id,
        username,
        fullName,
        role,
        schoolId,
        supplierId,
      ] of users) {
        const roleId = roleIds.get(role);
        if (!roleId) throw new Error(`Không tìm thấy role ${role}`);
        await transaction.user.upsert({
          where: { id },
          update: { roleId, schoolId, supplierId, fullName, status: "ACTIVE" },
          create: {
            id,
            roleId,
            schoolId,
            supplierId,
            username,
            email: `${username}@foodprint.local`,
            passwordHash: "prototype-no-login",
            fullName,
            status: "ACTIVE",
          },
        });
      }

      await transaction.weeklyMenu.upsert({
        where: { id: ids.menu },
        update: {
          schoolId: ids.school,
          createdByUserId: ids.adminUser,
          weekStartDate: new Date("2026-10-26T00:00:00.000Z"),
          title: "Thực đơn bán trú tiêu chuẩn mùa thu - Tuần 43",
          status: "PENDING_APPROVAL",
          submittedAt: new Date("2026-10-20T07:30:00.000Z"),
          approvedAt: null,
        },
        create: {
          id: ids.menu,
          schoolId: ids.school,
          createdByUserId: ids.adminUser,
          weekStartDate: new Date("2026-10-26T00:00:00.000Z"),
          title: "Thực đơn bán trú tiêu chuẩn mùa thu - Tuần 43",
          status: "PENDING_APPROVAL",
          submittedAt: new Date("2026-10-20T07:30:00.000Z"),
        },
      });

      await transaction.menuReviewRecord.deleteMany({
        where: { weeklyMenuId: ids.menu },
      });
      await transaction.menuReviewRecord.create({
        data: {
          id: ids.medicalReview,
          weeklyMenuId: ids.menu,
          reviewerUserId: ids.healthUser,
          decision: "APPROVED",
          feedback:
            "Đã thẩm định cơ cấu nhóm chất và dị nguyên trong thực đơn.",
          reviewedAt: new Date("2026-10-21T02:15:00.000Z"),
        },
      });

      const supplierIds = new Map(
        suppliers.map(([id, code]) => [code, id] as const),
      );
      for (let dayIndex = 0; dayIndex < menuDates.length; dayIndex += 1) {
        const dayNumber = dayIndex + 2;
        const menuDayId = uuidFor("45", dayNumber, 1);
        await transaction.menuDay.upsert({
          where: { id: menuDayId },
          update: {
            weeklyMenuId: ids.menu,
            menuDate: new Date(`${menuDates[dayIndex]}T00:00:00.000Z`),
            note: "Phục vụ 1.520 suất",
          },
          create: {
            id: menuDayId,
            weeklyMenuId: ids.menu,
            menuDate: new Date(`${menuDates[dayIndex]}T00:00:00.000Z`),
            note: "Phục vụ 1.520 suất",
          },
        });

        for (let itemIndex = 0; itemIndex < dishes.length; itemIndex += 1) {
          const [mealType, name, description, supplierCode, category] =
            dishes[itemIndex];
          const sequence = itemIndex + 1;
          const supplierId = supplierIds.get(supplierCode);
          if (!supplierId)
            throw new Error(`Không tìm thấy supplier ${supplierCode}`);

          const dish = await transaction.dish.upsert({
            where: { schoolId_name: { schoolId: ids.school, name } },
            update: { description, status: "ACTIVE" },
            create: {
              id: uuidFor("46", 1, sequence),
              schoolId: ids.school,
              name,
              description,
              status: "ACTIVE",
            },
            select: { id: true },
          });
          const ingredientName = `Nguyên liệu chính: ${name}`;
          const ingredient = await transaction.ingredient.upsert({
            where: { supplierId_name: { supplierId, name: ingredientName } },
            update: { category, description, status: "ACTIVE" },
            create: {
              id: uuidFor("47", 1, sequence),
              supplierId,
              name: ingredientName,
              category,
              defaultUnit: "kg",
              description,
              status: "ACTIVE",
            },
            select: { id: true },
          });
          const ingredientEntry = await transaction.ingredientEntry.upsert({
            where: {
              schoolId_ingredientId: {
                schoolId: ids.school,
                ingredientId: ingredient.id,
              },
            },
            update: { status: "ACTIVE", handlingType: "DIRECT_USE" },
            create: {
              id: uuidFor("49", 1, sequence),
              schoolId: ids.school,
              ingredientId: ingredient.id,
              storageRequirements: category,
              shelfLifeDays: 1,
              handlingType: "DIRECT_USE",
              status: "ACTIVE",
              createdByUserId: ids.adminUser,
            },
            select: { id: true },
          });

          await transaction.menuDayDish.upsert({
            where: {
              menuDayId_dishId_mealType: {
                menuDayId,
                dishId: dish.id,
                mealType,
              },
            },
            update: {
              displayOrder: sequence,
              portionSize: 1520,
              portionUnit: "suất",
            },
            create: {
              menuDayId,
              dishId: dish.id,
              mealType,
              displayOrder: sequence,
              portionSize: 1520,
              portionUnit: "suất",
            },
          });
          await transaction.dishIngredientEntry.upsert({
            where: {
              dishId_ingredientEntryId: {
                dishId: dish.id,
                ingredientEntryId: ingredientEntry.id,
              },
            },
            update: { requiredQuantity: 1, unit: "định lượng chuẩn" },
            create: {
              dishId: dish.id,
              ingredientEntryId: ingredientEntry.id,
              requiredQuantity: 1,
              unit: "định lượng chuẩn",
            },
          });
        }
      }
    },
    { maxWait: 5_000, timeout: 60_000 },
  );

  console.log("Seed thực đơn tuần 43 hoàn tất");
  console.log(`Menu ID: ${ids.menu}`);
}

async function main(): Promise<void> {
  const prisma = await getPrisma();
  try {
    await seed();
  } catch (error) {
    console.error("Seed thất bại:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
