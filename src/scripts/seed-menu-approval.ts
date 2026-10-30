import { requireDatabaseUrl } from "../config/env";
import { getPrisma } from "../utils/database";

function assertLocalDatabase(): void {
  const target = new URL(requireDatabaseUrl());
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error(
      "Script seed menu approval chỉ được phép chạy với PostgreSQL local.",
    );
  }
}

const ids = {
  school: "10000000-0000-4000-8000-000000000001",
  menu: "43000000-0000-4000-8000-000000000001",
  schoolAdmin: "20000000-0000-4000-8000-000000000003",
  managementBoard: "20000000-0000-4000-8000-000000000002",
  healthOfficer: "20000000-0000-4000-8000-000000000001",
  healthReview: "44000000-0000-4000-8000-000000000001",
} as const;

const roles = [
  {
    id: "21000000-0000-4000-8000-000000000001",
    code: "SCHOOL_ADMINISTRATION",
    name: "Quản trị viên nhà trường",
  },
  {
    id: "21000000-0000-4000-8000-000000000002",
    code: "SCHOOL_MANAGEMENT_BOARD",
    name: "Ban Giám hiệu",
  },
  {
    id: "21000000-0000-4000-8000-000000000003",
    code: "SCHOOL_HEALTH_OFFICER",
    name: "Cán bộ Y tế trường",
  },
] as const;

const users = [
  {
    id: ids.schoolAdmin,
    username: "school_admin",
    email: "school_admin@foodprint.local",
    fullName: "Phạm Hải Đăng",
    roleCode: "SCHOOL_ADMINISTRATION",
  },
  {
    id: ids.managementBoard,
    username: "school_bgh",
    email: "school_bgh@foodprint.local",
    fullName: "ThS. Lê Hoàng Nam",
    roleCode: "SCHOOL_MANAGEMENT_BOARD",
  },
  {
    id: ids.healthOfficer,
    username: "school_health",
    email: "school_health@foodprint.local",
    fullName: "BS. Nguyễn Mai Lan",
    roleCode: "SCHOOL_HEALTH_OFFICER",
  },
] as const;

const suppliers = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    key: "fresh-food",
    taxCode: "0109284512",
    name: "Công ty TNHH Thực phẩm An Nhiên",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    key: "green-vegetable",
    taxCode: "0500614278",
    name: "Hợp tác xã Nông sản Xanh Ba Vì",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    key: "dairy",
    taxCode: "0107742036",
    name: "Công ty Cổ phần Sữa Học đường Việt",
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    key: "dry-food",
    taxCode: "0106521189",
    name: "Công ty TNHH Nông sản Đông Đô",
  },
] as const;

const dishes = [
  {
    mealType: "LUNCH",
    name: "Thịt kho trứng",
    description: "Thịt nạc kho cùng trứng và nước dừa.",
    supplierKey: "fresh-food",
    ingredientName: "Thịt nạc và trứng",
    category: "Thực phẩm tươi sống",
    handlingType: "DIRECT_USE",
    requiredQuantity: 0.09,
    requiredUnit: "kg",
  },
  {
    mealType: "LUNCH",
    name: "Rau cải xào",
    description: "Rau cải xào trong ngày.",
    supplierKey: "green-vegetable",
    ingredientName: "Rau cải",
    category: "Rau củ",
    handlingType: "DIRECT_USE",
    requiredQuantity: 0.07,
    requiredUnit: "kg",
  },
  {
    mealType: "LUNCH",
    name: "Canh bí đỏ",
    description: "Canh bí đỏ nấu thịt băm.",
    supplierKey: "green-vegetable",
    ingredientName: "Bí đỏ",
    category: "Rau củ",
    handlingType: "DIRECT_USE",
    requiredQuantity: 0.08,
    requiredUnit: "kg",
  },
  {
    mealType: "LUNCH",
    name: "Cơm trắng",
    description: "Gạo được bảo quản trong kho khô của trường.",
    supplierKey: "dry-food",
    ingredientName: "Gạo tẻ",
    category: "Lương thực khô",
    handlingType: "DRY_STOCK",
    requiredQuantity: 0.12,
    requiredUnit: "kg",
  },
  {
    mealType: "LUNCH",
    name: "Tráng miệng theo mùa",
    description: "Trái cây tươi thay đổi theo mùa.",
    supplierKey: "green-vegetable",
    ingredientName: "Trái cây theo mùa",
    category: "Trái cây",
    handlingType: "DIRECT_USE",
    requiredQuantity: 0.1,
    requiredUnit: "kg",
  },
  {
    mealType: "AFTERNOON",
    name: "Súp gà ngô non",
    description: "Súp gà nấu cùng ngô non và rau củ.",
    supplierKey: "fresh-food",
    ingredientName: "Thịt gà",
    category: "Thực phẩm tươi sống",
    handlingType: "DIRECT_USE",
    requiredQuantity: 0.06,
    requiredUnit: "kg",
  },
  {
    mealType: "AFTERNOON",
    name: "Sữa chua",
    description: "Sữa chua dùng cho bữa phụ buổi chiều.",
    supplierKey: "dairy",
    ingredientName: "Sữa chua",
    category: "Sản phẩm từ sữa",
    handlingType: "DIRECT_USE",
    requiredQuantity: 1,
    requiredUnit: "hộp",
  },
] as const;

const menuDates = [
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
] as const;

function stableUuid(namespace: number, sequence: number): string {
  return `${String(namespace).padStart(8, "0")}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

async function seedMenuApproval(): Promise<void> {
  const prisma = await getPrisma();

  await prisma.$transaction(
    async (transaction) => {
      await transaction.school.upsert({
        where: { id: ids.school },
        update: {
          name: "Trường Tiểu học Cầu Giấy",
          code: "TH-CG-01",
          email: "vanphong@thcaugiay.edu.vn",
          phone: "024 3767 8899",
          address: "Số 01 Nguyễn Thị Duệ, Hà Nội",
          status: "ACTIVE",
        },
        create: {
          id: ids.school,
          name: "Trường Tiểu học Cầu Giấy",
          code: "TH-CG-01",
          email: "vanphong@thcaugiay.edu.vn",
          phone: "024 3767 8899",
          address: "Số 01 Nguyễn Thị Duệ, Hà Nội",
          status: "ACTIVE",
        },
      });

      const roleIds = new Map<string, string>();
      for (const roleSeed of roles) {
        const role = await transaction.role.upsert({
          where: { code: roleSeed.code },
          update: { name: roleSeed.name, type: "SCHOOL" },
          create: {
            id: roleSeed.id,
            code: roleSeed.code,
            name: roleSeed.name,
            type: "SCHOOL",
          },
          select: { id: true },
        });
        roleIds.set(roleSeed.code, role.id);
      }

      for (const userSeed of users) {
        const roleId = roleIds.get(userSeed.roleCode);
        if (!roleId)
          throw new Error(`Không tìm thấy vai trò ${userSeed.roleCode}`);

        await transaction.user.upsert({
          where: { id: userSeed.id },
          update: {
            roleId,
            schoolId: ids.school,
            supplierId: null,
            username: userSeed.username,
            email: userSeed.email,
            fullName: userSeed.fullName,
            status: "ACTIVE",
          },
          create: {
            id: userSeed.id,
            roleId,
            schoolId: ids.school,
            supplierId: null,
            username: userSeed.username,
            email: userSeed.email,
            passwordHash: "prototype-seed-no-login",
            fullName: userSeed.fullName,
            status: "ACTIVE",
          },
        });
      }

      for (const supplierSeed of suppliers) {
        await transaction.supplier.upsert({
          where: { id: supplierSeed.id },
          update: {
            name: supplierSeed.name,
            taxCode: supplierSeed.taxCode,
            status: "ACTIVE",
          },
          create: {
            id: supplierSeed.id,
            name: supplierSeed.name,
            taxCode: supplierSeed.taxCode,
            status: "ACTIVE",
          },
        });
      }

      await transaction.weeklyMenu.upsert({
        where: { id: ids.menu },
        update: {
          schoolId: ids.school,
          createdByUserId: ids.schoolAdmin,
          weekStartDate: new Date("2026-10-26T00:00:00.000Z"),
          title: "Thực đơn bán trú tuần 44",
          status: "PENDING_APPROVAL",
          submittedAt: new Date("2026-10-23T08:30:00.000Z"),
          approvedAt: null,
        },
        create: {
          id: ids.menu,
          schoolId: ids.school,
          createdByUserId: ids.schoolAdmin,
          weekStartDate: new Date("2026-10-26T00:00:00.000Z"),
          title: "Thực đơn bán trú tuần 44",
          status: "PENDING_APPROVAL",
          submittedAt: new Date("2026-10-23T08:30:00.000Z"),
        },
      });

      await transaction.menuReviewRecord.deleteMany({
        where: { weeklyMenuId: ids.menu },
      });
      await transaction.menuReviewRecord.create({
        data: {
          id: ids.healthReview,
          weeklyMenuId: ids.menu,
          reviewerUserId: ids.healthOfficer,
          decision: "APPROVED",
          feedback:
            "Đã xem xét thành phần món ăn và nguồn nguyên liệu trong thực đơn. Không ghi nhận yêu cầu điều chỉnh tại thời điểm thẩm định.",
          reviewedAt: new Date("2026-10-23T09:15:00.000Z"),
        },
      });

      const supplierIds = new Map(
        suppliers.map((supplier) => [supplier.key, supplier.id] as const),
      );

      for (let dayIndex = 0; dayIndex < menuDates.length; dayIndex += 1) {
        const menuDayId = stableUuid(45, dayIndex + 1);
        await transaction.menuDay.upsert({
          where: { id: menuDayId },
          update: {
            weeklyMenuId: ids.menu,
            menuDate: new Date(`${menuDates[dayIndex]}T00:00:00.000Z`),
            note: "Kế hoạch phục vụ 1.520 suất.",
          },
          create: {
            id: menuDayId,
            weeklyMenuId: ids.menu,
            menuDate: new Date(`${menuDates[dayIndex]}T00:00:00.000Z`),
            note: "Kế hoạch phục vụ 1.520 suất.",
          },
        });

        await transaction.menuDayDish.deleteMany({ where: { menuDayId } });

        for (let dishIndex = 0; dishIndex < dishes.length; dishIndex += 1) {
          const dishSeed = dishes[dishIndex];
          const sequence = dishIndex + 1;
          const supplierId = supplierIds.get(dishSeed.supplierKey);
          if (!supplierId) {
            throw new Error(
              `Không tìm thấy nhà cung cấp ${dishSeed.supplierKey}`,
            );
          }

          const dish = await transaction.dish.upsert({
            where: {
              schoolId_name: { schoolId: ids.school, name: dishSeed.name },
            },
            update: { description: dishSeed.description, status: "ACTIVE" },
            create: {
              id: stableUuid(46, sequence),
              schoolId: ids.school,
              name: dishSeed.name,
              description: dishSeed.description,
              status: "ACTIVE",
            },
            select: { id: true },
          });

          const ingredient = await transaction.ingredient.upsert({
            where: {
              supplierId_name: { supplierId, name: dishSeed.ingredientName },
            },
            update: {
              category: dishSeed.category,
              defaultUnit: dishSeed.requiredUnit,
              description: dishSeed.description,
              status: "ACTIVE",
            },
            create: {
              id: stableUuid(47, sequence),
              supplierId,
              name: dishSeed.ingredientName,
              category: dishSeed.category,
              defaultUnit: dishSeed.requiredUnit,
              description: dishSeed.description,
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
            update: {
              storageRequirements: dishSeed.category,
              handlingType: dishSeed.handlingType,
              status: "ACTIVE",
              createdByUserId: ids.schoolAdmin,
            },
            create: {
              id: stableUuid(49, sequence),
              schoolId: ids.school,
              ingredientId: ingredient.id,
              storageRequirements: dishSeed.category,
              handlingType: dishSeed.handlingType,
              status: "ACTIVE",
              createdByUserId: ids.schoolAdmin,
            },
            select: { id: true },
          });

          await transaction.dishIngredientEntry.upsert({
            where: {
              dishId_ingredientEntryId: {
                dishId: dish.id,
                ingredientEntryId: ingredientEntry.id,
              },
            },
            update: {
              requiredQuantity: dishSeed.requiredQuantity,
              unit: dishSeed.requiredUnit,
            },
            create: {
              dishId: dish.id,
              ingredientEntryId: ingredientEntry.id,
              requiredQuantity: dishSeed.requiredQuantity,
              unit: dishSeed.requiredUnit,
            },
          });

          await transaction.menuDayDish.create({
            data: {
              menuDayId,
              dishId: dish.id,
              mealType: dishSeed.mealType,
              displayOrder: sequence,
              // The current approval DTO uses this value as the planned serving count.
              portionSize: 1520,
              portionUnit: "suất",
            },
          });
        }
      }
    },
    { maxWait: 5_000, timeout: 60_000 },
  );

  console.log("Đã tạo dữ liệu mẫu duyệt thực đơn cho Ban Giám hiệu.");
  console.log(`Menu ID: ${ids.menu}`);
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const prisma = await getPrisma();
  try {
    await seedMenuApproval();
  } catch (error) {
    console.error("Không thể seed dữ liệu duyệt thực đơn:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
