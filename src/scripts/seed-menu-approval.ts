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
    email: "lienhe@annhienfood.vn",
    phone: "024 3555 1020",
    address: "18 Trần Thái Tông, Cầu Giấy, Hà Nội",
    certificateType: "Giấy chứng nhận cơ sở đủ điều kiện ATTP",
    certificateNo: "ATTP-AN-2026-018",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    key: "green-vegetable",
    taxCode: "0500614278",
    name: "Hợp tác xã Nông sản Xanh Ba Vì",
    email: "kinhdoanh@nongsanxanhbavi.vn",
    phone: "024 3388 4572",
    address: "Vân Hòa, Ba Vì, Hà Nội",
    certificateType: "VietGAP trồng trọt",
    certificateNo: "VIETGAP-BV-2026-022",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    key: "seafood",
    taxCode: "0201987741",
    name: "Công ty TNHH Thủy sản Hải Minh",
    email: "sales@haiminhseafood.vn",
    phone: "0225 3766 889",
    address: "12 Lê Thánh Tông, Ngô Quyền, Hải Phòng",
    certificateType: "HACCP thủy sản",
    certificateNo: "HACCP-HM-2026-009",
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    key: "dairy",
    taxCode: "0107742036",
    name: "Công ty Cổ phần Sữa Học đường Việt",
    email: "truonghoc@suahocduongviet.vn",
    phone: "024 3776 2026",
    address: "86 Hoàng Quốc Việt, Cầu Giấy, Hà Nội",
    certificateType: "ISO 22000:2018",
    certificateNo: "ISO22000-SHDV-2026",
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    key: "dry-food",
    taxCode: "0106521189",
    name: "Công ty TNHH Nông sản Đông Đô",
    email: "donhang@nongsandongdo.vn",
    phone: "024 3668 1199",
    address: "35 Đức Giang, Long Biên, Hà Nội",
    certificateType: "Hệ thống quản lý an toàn thực phẩm",
    certificateNo: "FSMS-DD-2026-031",
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    key: "fruit",
    taxCode: "2400912675",
    name: "Hợp tác xã Trái cây Sạch Miền Bắc",
    email: "htx@traicaysachmb.vn",
    phone: "0204 3886 225",
    address: "Lục Ngạn, Bắc Giang",
    certificateType: "VietGAP cây ăn quả",
    certificateNo: "VIETGAP-TCMB-2026-014",
  },
] as const;

const products = [
  {
    key: "pork",
    supplierKey: "fresh-food",
    name: "Thịt lợn nạc",
    category: "Thịt tươi",
    unit: "kg",
    handlingType: "DIRECT_USE",
    description: "Thịt lợn có kiểm soát thú y, giao mới trong ngày.",
  },
  {
    key: "chicken",
    supplierKey: "fresh-food",
    name: "Thịt gà ta",
    category: "Thịt tươi",
    unit: "kg",
    handlingType: "DIRECT_USE",
    description: "Thịt gà ta sơ chế, bảo quản lạnh theo quy định.",
  },
  {
    key: "greens",
    supplierKey: "green-vegetable",
    name: "Rau cải xanh",
    category: "Rau củ",
    unit: "kg",
    handlingType: "DIRECT_USE",
    description: "Rau cải xanh VietGAP thu hoạch trong ngày.",
  },
  {
    key: "pumpkin",
    supplierKey: "green-vegetable",
    name: "Bí đỏ",
    category: "Rau củ",
    unit: "kg",
    handlingType: "DIRECT_USE",
    description: "Bí đỏ VietGAP, không sử dụng chất bảo quản.",
  },
  {
    key: "fish",
    supplierKey: "seafood",
    name: "Cá basa phi lê",
    category: "Thủy sản",
    unit: "kg",
    handlingType: "DIRECT_USE",
    description: "Cá basa phi lê cấp đông, truy xuất được lô hàng.",
  },
  {
    key: "shrimp",
    supplierKey: "seafood",
    name: "Tôm nõn",
    category: "Thủy sản",
    unit: "kg",
    handlingType: "DIRECT_USE",
    description: "Tôm nõn sơ chế, bảo quản lạnh đúng nhiệt độ.",
  },
  {
    key: "yogurt",
    supplierKey: "dairy",
    name: "Sữa chua học đường",
    category: "Sản phẩm từ sữa",
    unit: "hộp",
    handlingType: "DIRECT_USE",
    description: "Sữa chua 100 g, bảo quản lạnh từ 2 đến 8 độ C.",
  },
  {
    key: "milk",
    supplierKey: "dairy",
    name: "Sữa tươi tiệt trùng",
    category: "Sản phẩm từ sữa",
    unit: "hộp",
    handlingType: "DIRECT_USE",
    description: "Sữa tươi tiệt trùng hộp 180 ml dành cho học sinh.",
  },
  {
    key: "rice",
    supplierKey: "dry-food",
    name: "Gạo ST25",
    category: "Lương thực khô",
    unit: "kg",
    handlingType: "DRY_STOCK",
    description: "Gạo ST25 đóng bao, bảo quản tại kho khô của trường.",
  },
  {
    key: "bun",
    supplierKey: "dry-food",
    name: "Bánh bao nhân thịt",
    category: "Thực phẩm chế biến",
    unit: "cái",
    handlingType: "DIRECT_USE",
    description: "Bánh bao nhân thịt loại 80 g, giao trong ngày.",
  },
  {
    key: "banana",
    supplierKey: "fruit",
    name: "Chuối tiêu hồng",
    category: "Trái cây",
    unit: "quả",
    handlingType: "DIRECT_USE",
    description: "Chuối tiêu hồng VietGAP, độ chín phù hợp.",
  },
  {
    key: "orange",
    supplierKey: "fruit",
    name: "Cam ngọt",
    category: "Trái cây",
    unit: "quả",
    handlingType: "DIRECT_USE",
    description: "Cam ngọt VietGAP, rửa sạch trước khi phục vụ.",
  },
] as const;

const menuDays = [
  {
    date: "2026-10-26",
    dishes: [
      [
        "LUNCH",
        "Thịt kho trứng",
        "Thịt lợn kho mềm cùng trứng và nước dừa.",
        "pork",
        0.09,
      ],
      [
        "LUNCH",
        "Rau cải xào tỏi",
        "Rau cải xanh xào tỏi trong ngày.",
        "greens",
        0.07,
      ],
      [
        "LUNCH",
        "Canh bí đỏ thịt băm",
        "Canh bí đỏ nấu thịt băm vị thanh.",
        "pumpkin",
        0.08,
      ],
      ["LUNCH", "Cơm gạo ST25", "Cơm trắng nấu từ gạo ST25.", "rice", 0.12],
      [
        "LUNCH",
        "Chuối tiêu tráng miệng",
        "Chuối tiêu hồng chín tự nhiên.",
        "banana",
        1,
      ],
      [
        "AFTERNOON",
        "Súp gà ngô non",
        "Súp gà nấu cùng ngô non và rau củ.",
        "chicken",
        0.06,
      ],
      [
        "AFTERNOON",
        "Sữa chua học đường",
        "Sữa chua mát dùng cho bữa phụ.",
        "yogurt",
        1,
      ],
    ],
  },
  {
    date: "2026-10-27",
    dishes: [
      ["LUNCH", "Gà rim gừng", "Thịt gà ta rim gừng vị dịu.", "chicken", 0.1],
      [
        "LUNCH",
        "Rau cải luộc",
        "Rau cải luộc chín tới, giữ màu xanh.",
        "greens",
        0.07,
      ],
      [
        "LUNCH",
        "Canh bí đỏ hầm",
        "Canh bí đỏ hầm mềm, ít muối.",
        "pumpkin",
        0.08,
      ],
      [
        "LUNCH",
        "Cơm trắng ST25",
        "Cơm trắng mềm phù hợp học sinh tiểu học.",
        "rice",
        0.12,
      ],
      [
        "LUNCH",
        "Cam ngọt tráng miệng",
        "Cam ngọt chia theo khẩu phần.",
        "orange",
        1,
      ],
      [
        "AFTERNOON",
        "Bánh bao nhân thịt",
        "Bánh bao hấp nóng trước giờ phục vụ.",
        "bun",
        1,
      ],
      ["AFTERNOON", "Sữa tươi tiệt trùng", "Sữa tươi hộp 180 ml.", "milk", 1],
    ],
  },
  {
    date: "2026-10-28",
    dishes: [
      [
        "LUNCH",
        "Cá basa sốt cà chua",
        "Cá basa phi lê sốt cà chua ít dầu.",
        "fish",
        0.09,
      ],
      [
        "LUNCH",
        "Rau cải xào",
        "Rau cải xào chín tới trong ngày.",
        "greens",
        0.07,
      ],
      [
        "LUNCH",
        "Canh bí đỏ",
        "Canh bí đỏ nấu mềm, vị ngọt tự nhiên.",
        "pumpkin",
        0.08,
      ],
      [
        "LUNCH",
        "Cơm gạo ST25 dẻo",
        "Cơm gạo ST25 nấu theo định lượng.",
        "rice",
        0.12,
      ],
      [
        "LUNCH",
        "Chuối tiêu hồng",
        "Chuối tiêu hồng dùng sau bữa trưa.",
        "banana",
        1,
      ],
      [
        "AFTERNOON",
        "Cháo gà rau củ",
        "Cháo gà nấu nhuyễn cùng rau củ.",
        "chicken",
        0.06,
      ],
      [
        "AFTERNOON",
        "Sữa chua ít đường",
        "Sữa chua ít đường hộp 100 g.",
        "yogurt",
        1,
      ],
    ],
  },
  {
    date: "2026-10-29",
    dishes: [
      [
        "LUNCH",
        "Tôm rim nhạt",
        "Tôm nõn rim nhạt phù hợp trẻ nhỏ.",
        "shrimp",
        0.07,
      ],
      ["LUNCH", "Bí đỏ xào thịt", "Bí đỏ xào cùng thịt băm.", "pumpkin", 0.08],
      ["LUNCH", "Canh rau cải", "Canh rau cải nấu vị thanh.", "greens", 0.07],
      ["LUNCH", "Cơm trắng", "Cơm trắng nấu từ gạo ST25.", "rice", 0.12],
      ["LUNCH", "Cam ngọt", "Cam ngọt VietGAP tráng miệng.", "orange", 1],
      ["AFTERNOON", "Bánh bao hấp", "Bánh bao nhân thịt hấp nóng.", "bun", 1],
      [
        "AFTERNOON",
        "Sữa tươi học đường",
        "Sữa tươi tiệt trùng hộp 180 ml.",
        "milk",
        1,
      ],
    ],
  },
  {
    date: "2026-10-30",
    dishes: [
      [
        "LUNCH",
        "Thịt lợn rang mềm",
        "Thịt lợn rang mềm, giảm muối.",
        "pork",
        0.09,
      ],
      [
        "LUNCH",
        "Rau cải xào thịt",
        "Rau cải xanh xào cùng thịt băm.",
        "greens",
        0.07,
      ],
      [
        "LUNCH",
        "Canh chua cá basa",
        "Canh cá basa nấu chua nhẹ.",
        "fish",
        0.08,
      ],
      ["LUNCH", "Cơm ST25", "Cơm gạo ST25 dẻo mềm.", "rice", 0.12],
      ["LUNCH", "Chuối tráng miệng", "Chuối tiêu hồng chín vừa.", "banana", 1],
      [
        "AFTERNOON",
        "Súp tôm bí đỏ",
        "Súp tôm nõn và bí đỏ xay mịn.",
        "shrimp",
        0.05,
      ],
      ["AFTERNOON", "Sữa chua", "Sữa chua học đường hộp 100 g.", "yogurt", 1],
    ],
  },
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
          address: "Số 01 Nguyễn Thị Duệ, Cầu Giấy, Hà Nội",
          status: "ACTIVE",
        },
        create: {
          id: ids.school,
          name: "Trường Tiểu học Cầu Giấy",
          code: "TH-CG-01",
          email: "vanphong@thcaugiay.edu.vn",
          phone: "024 3767 8899",
          address: "Số 01 Nguyễn Thị Duệ, Cầu Giấy, Hà Nội",
          status: "ACTIVE",
        },
      });

      const roleIds = new Map<string, string>();
      for (const roleSeed of roles) {
        const role = await transaction.role.upsert({
          where: { code: roleSeed.code },
          update: { name: roleSeed.name, type: "SCHOOL" },
          create: { ...roleSeed, type: "SCHOOL" },
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

      for (let index = 0; index < suppliers.length; index += 1) {
        const supplier = suppliers[index];
        await transaction.supplier.upsert({
          where: { id: supplier.id },
          update: {
            name: supplier.name,
            taxCode: supplier.taxCode,
            email: supplier.email,
            phone: supplier.phone,
            address: supplier.address,
            status: "ACTIVE",
          },
          create: {
            id: supplier.id,
            name: supplier.name,
            taxCode: supplier.taxCode,
            email: supplier.email,
            phone: supplier.phone,
            address: supplier.address,
            status: "ACTIVE",
          },
        });
        await transaction.schoolSupplierRelationship.upsert({
          where: { id: stableUuid(31, index + 1) },
          update: {
            schoolId: ids.school,
            supplierId: supplier.id,
            status: "ACTIVE",
            linkedByUserId: ids.schoolAdmin,
            linkNote:
              "Nhà cung cấp phục vụ thực đơn bán trú năm học 2026–2027.",
            unlinkedByUserId: null,
            unlinkReason: null,
            unlinkedAt: null,
          },
          create: {
            id: stableUuid(31, index + 1),
            schoolId: ids.school,
            supplierId: supplier.id,
            status: "ACTIVE",
            linkedByUserId: ids.schoolAdmin,
            linkNote:
              "Nhà cung cấp phục vụ thực đơn bán trú năm học 2026–2027.",
            linkedAt: new Date("2026-08-15T02:00:00.000Z"),
          },
        });
        await transaction.supplierCertification.upsert({
          where: {
            supplierId_certificateNo: {
              supplierId: supplier.id,
              certificateNo: supplier.certificateNo,
            },
          },
          update: {
            certificationType: supplier.certificateType,
            issuedDate: new Date("2026-01-15T00:00:00.000Z"),
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            status: "ACTIVE",
          },
          create: {
            id: stableUuid(32, index + 1),
            supplierId: supplier.id,
            certificationType: supplier.certificateType,
            certificateNo: supplier.certificateNo,
            issuedDate: new Date("2026-01-15T00:00:00.000Z"),
            expiryDate: new Date("2027-12-31T00:00:00.000Z"),
            status: "ACTIVE",
          },
        });
      }

      const supplierIds = new Map(
        suppliers.map((supplier) => [supplier.key, supplier.id] as const),
      );
      const productEntries = new Map<string, string>();
      for (let index = 0; index < products.length; index += 1) {
        const product = products[index];
        const supplierId = supplierIds.get(product.supplierKey);
        if (!supplierId)
          throw new Error(`Không tìm thấy nhà cung cấp ${product.supplierKey}`);
        const ingredient = await transaction.ingredient.upsert({
          where: { supplierId_name: { supplierId, name: product.name } },
          update: {
            category: product.category,
            defaultUnit: product.unit,
            description: product.description,
            status: "ACTIVE",
          },
          create: {
            id: stableUuid(57, index + 1),
            supplierId,
            name: product.name,
            category: product.category,
            defaultUnit: product.unit,
            description: product.description,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        const entry = await transaction.ingredientEntry.upsert({
          where: {
            schoolId_ingredientId: {
              schoolId: ids.school,
              ingredientId: ingredient.id,
            },
          },
          update: {
            storageRequirements: product.description,
            handlingType: product.handlingType,
            status: "ACTIVE",
            createdByUserId: ids.schoolAdmin,
          },
          create: {
            id: stableUuid(59, index + 1),
            schoolId: ids.school,
            ingredientId: ingredient.id,
            storageRequirements: product.description,
            handlingType: product.handlingType,
            status: "ACTIVE",
            createdByUserId: ids.schoolAdmin,
          },
          select: { id: true },
        });
        productEntries.set(product.key, entry.id);
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
            "Đã thẩm định cơ cấu món ăn, định lượng và nguồn nguyên liệu. Thực đơn đa dạng, phù hợp học sinh tiểu học và đủ điều kiện trình Ban Giám hiệu phê duyệt.",
          reviewedAt: new Date("2026-10-23T09:15:00.000Z"),
        },
      });

      let dishSequence = 0;
      for (let dayIndex = 0; dayIndex < menuDays.length; dayIndex += 1) {
        const daySeed = menuDays[dayIndex];
        const menuDayId = stableUuid(45, dayIndex + 1);
        await transaction.menuDay.upsert({
          where: { id: menuDayId },
          update: {
            weeklyMenuId: ids.menu,
            menuDate: new Date(`${daySeed.date}T00:00:00.000Z`),
            note: "Kế hoạch phục vụ 1.520 suất.",
            approvalStatus: "PENDING_APPROVAL",
          },
          create: {
            id: menuDayId,
            weeklyMenuId: ids.menu,
            menuDate: new Date(`${daySeed.date}T00:00:00.000Z`),
            note: "Kế hoạch phục vụ 1.520 suất.",
            approvalStatus: "PENDING_APPROVAL",
          },
        });
        await transaction.menuDayDish.deleteMany({ where: { menuDayId } });
        for (
          let itemIndex = 0;
          itemIndex < daySeed.dishes.length;
          itemIndex += 1
        ) {
          const [mealType, name, description, productKey, quantity] =
            daySeed.dishes[itemIndex];
          const product = products.find((item) => item.key === productKey);
          const ingredientEntryId = productEntries.get(productKey);
          if (!product || !ingredientEntryId)
            throw new Error(`Không tìm thấy sản phẩm ${productKey}`);
          dishSequence += 1;
          const dish = await transaction.dish.upsert({
            where: { schoolId_name: { schoolId: ids.school, name } },
            update: { description, status: "ACTIVE" },
            create: {
              id: stableUuid(56, dishSequence),
              schoolId: ids.school,
              name,
              description,
              status: "ACTIVE",
            },
            select: { id: true },
          });
          await transaction.dishIngredientEntry.deleteMany({
            where: { dishId: dish.id },
          });
          await transaction.dishIngredientEntry.create({
            data: {
              dishId: dish.id,
              ingredientEntryId,
              requiredQuantity: quantity,
              unit: product.unit,
            },
          });
          await transaction.menuDayDish.create({
            data: {
              menuDayId,
              dishId: dish.id,
              mealType,
              displayOrder: itemIndex + 1,
              portionSize: 1520,
              portionUnit: "suất",
            },
          });
        }
      }
    },
    { maxWait: 5_000, timeout: 60_000 },
  );

  console.log("Đã tạo dữ liệu duyệt thực đơn phong phú cho Ban Giám hiệu.");
  console.log(`Nhà cung cấp: ${suppliers.length}`);
  console.log(`Sản phẩm/nguyên liệu: ${products.length}`);
  console.log(`Ngày thực đơn: ${menuDays.length}`);
  console.log(
    `Món trong tuần: ${menuDays.reduce((total, day) => total + day.dishes.length, 0)}`,
  );
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
