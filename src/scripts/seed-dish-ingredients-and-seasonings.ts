import { prisma } from "../config/prisma";

async function main() {
  console.log(
    "🚀 Bắt đầu bổ sung dữ liệu Gia vị và Nguyên liệu chính vào Database...",
  );

  const demoSchoolId = "4eabb820-f445-52db-8aeb-2fd0f6cb882a";
  const cauGiaySchoolId = "10000000-0000-4000-8000-000000000001";

  const demoSupplierId = "fd161c1b-6f2d-5c8d-ab59-f430cfc2415a"; // Nhà cung cấp Nông Sản Xanh (DEMO)
  const cauGiaySupplierId = "30000000-0000-4000-8000-000000000001"; // Công ty TNHH Thực phẩm An Nhiên

  const demoUserId = "c11af88c-a6b2-5db1-8e84-57d4f9f23dcc";
  const cauGiayUserId = "20000000-0000-4000-8000-000000000003";

  // 1. Tạo hoặc lấy Danh mục "Gia vị / Phụ gia"
  let seasoningCategory = await prisma.ingredientCategory.findFirst({
    where: { categoryName: "Gia vị / Phụ gia" },
  });
  if (!seasoningCategory) {
    seasoningCategory = await prisma.ingredientCategory.create({
      data: {
        categoryName: "Gia vị / Phụ gia",
        categoryDescription:
          "Gia vị, dầu ăn, phụ gia nêm nếm dùng trong chế biến bếp trường học",
      },
    });
    console.log(
      "✅ Đã tạo danh mục nguyên liệu 'Gia vị / Phụ gia':",
      seasoningCategory.id,
    );
  } else {
    console.log("ℹ️ Đã có danh mục 'Gia vị / Phụ gia':", seasoningCategory.id);
  }

  // Lấy các danh mục khác nếu cần
  const meatCategory = await prisma.ingredientCategory.findFirst({
    where: { categoryName: "Thịt tươi" },
  });
  const vegCategory = await prisma.ingredientCategory.findFirst({
    where: { categoryName: "Rau củ" },
  });
  const fruitCategory = await prisma.ingredientCategory.findFirst({
    where: { categoryName: "Trái cây" },
  });
  const dairyCategory = await prisma.ingredientCategory.findFirst({
    where: { categoryName: "Sản phẩm từ sữa" },
  });

  // 2. Danh sách các gia vị chuẩn cho bếp ăn
  const standardSeasonings = [
    { name: "Muối tinh i-ốt", defaultUnit: "kg" },
    { name: "Hạt nêm thịt heo", defaultUnit: "kg" },
    { name: "Nước mắm truyền thống", defaultUnit: "lít" },
    { name: "Dầu thực vật tinh luyện", defaultUnit: "lít" },
    { name: "Đường kính trắng", defaultUnit: "kg" },
    { name: "Tiêu đen xay", defaultUnit: "kg" },
    { name: "Nước tương đậu nành", defaultUnit: "lít" },
    { name: "Hành khô & Tỏi xay", defaultUnit: "kg" },
    { name: "Gừng củ tươi", defaultUnit: "kg" },
  ];

  // Map lưu ingredientEntry theo school và name gia vị
  const demoSeasoningEntries = new Map<string, string>();
  const cauGiaySeasoningEntries = new Map<string, string>();

  // Tạo nguyên liệu gia vị cho cả 2 nhà cung cấp & tạo ingredient_entries tương ứng
  for (const s of standardSeasonings) {
    // 2.1 Demo school seasoning
    let demoIng = await prisma.ingredient.findFirst({
      where: { supplierId: demoSupplierId, name: s.name },
    });
    if (!demoIng) {
      demoIng = await prisma.ingredient.create({
        data: {
          supplierId: demoSupplierId,
          name: s.name,
          defaultUnit: s.defaultUnit,
          categoryId: seasoningCategory.id,
          description: `Gia vị bếp trường học: ${s.name}`,
          status: "ACTIVE",
        },
      });
      console.log(`✅ Đã tạo Ingredient gia vị (Demo): ${s.name}`);
    }

    let demoEntry = await prisma.ingredientEntry.findFirst({
      where: { schoolId: demoSchoolId, ingredientId: demoIng.id },
    });
    if (!demoEntry) {
      demoEntry = await prisma.ingredientEntry.create({
        data: {
          schoolId: demoSchoolId,
          ingredientId: demoIng.id,
          handlingType: "DRY_STOCK",
          status: "ACTIVE",
          createdByUserId: demoUserId,
        },
      });
      console.log(`✅ Đã tạo IngredientEntry kho khô (Demo): ${s.name}`);
    } else if (demoEntry.handlingType !== "DRY_STOCK") {
      await prisma.ingredientEntry.update({
        where: { id: demoEntry.id },
        data: { handlingType: "DRY_STOCK" },
      });
    }
    demoSeasoningEntries.set(s.name, demoEntry.id);

    // 2.2 Cầu Giấy school seasoning
    let cgIng = await prisma.ingredient.findFirst({
      where: { supplierId: cauGiaySupplierId, name: s.name },
    });
    if (!cgIng) {
      cgIng = await prisma.ingredient.create({
        data: {
          supplierId: cauGiaySupplierId,
          name: s.name,
          defaultUnit: s.defaultUnit,
          categoryId: seasoningCategory.id,
          description: `Gia vị kho bếp Cầu Giấy: ${s.name}`,
          status: "ACTIVE",
        },
      });
      console.log(`✅ Đã tạo Ingredient gia vị (Cầu Giấy): ${s.name}`);
    }

    let cgEntry = await prisma.ingredientEntry.findFirst({
      where: { schoolId: cauGiaySchoolId, ingredientId: cgIng.id },
    });
    if (!cgEntry) {
      cgEntry = await prisma.ingredientEntry.create({
        data: {
          schoolId: cauGiaySchoolId,
          ingredientId: cgIng.id,
          handlingType: "DRY_STOCK",
          status: "ACTIVE",
          createdByUserId: cauGiayUserId,
        },
      });
      console.log(`✅ Đã tạo IngredientEntry kho khô (Cầu Giấy): ${s.name}`);
    } else if (cgEntry.handlingType !== "DRY_STOCK") {
      await prisma.ingredientEntry.update({
        where: { id: cgEntry.id },
        data: { handlingType: "DRY_STOCK" },
      });
    }
    cauGiaySeasoningEntries.set(s.name, cgEntry.id);
  }

  // 3. Đảm bảo các nguyên liệu chính cơ bản cho Demo School tồn tại
  const demoMainItems = [
    {
      name: "Thịt lợn nạc",
      unit: "kg",
      catId: meatCategory?.id,
      handling: "DIRECT_USE" as const,
    },
    {
      name: "Rau muống sạch",
      unit: "kg",
      catId: vegCategory?.id,
      handling: "DIRECT_USE" as const,
    },
    {
      name: "Sữa chua học đường",
      unit: "hộp",
      catId: dairyCategory?.id,
      handling: "DIRECT_USE" as const,
    },
    {
      name: "Chuối tiêu hồng",
      unit: "quả",
      catId: fruitCategory?.id,
      handling: "DIRECT_USE" as const,
    },
  ];

  const demoMainEntries = new Map<string, string>();
  for (const m of demoMainItems) {
    let ing = await prisma.ingredient.findFirst({
      where: { supplierId: demoSupplierId, name: m.name },
    });
    if (!ing) {
      ing = await prisma.ingredient.create({
        data: {
          supplierId: demoSupplierId,
          name: m.name,
          defaultUnit: m.unit,
          categoryId: m.catId,
          status: "ACTIVE",
        },
      });
    }
    let entry = await prisma.ingredientEntry.findFirst({
      where: { schoolId: demoSchoolId, ingredientId: ing.id },
    });
    if (!entry) {
      entry = await prisma.ingredientEntry.create({
        data: {
          schoolId: demoSchoolId,
          ingredientId: ing.id,
          handlingType: m.handling,
          status: "ACTIVE",
          createdByUserId: demoUserId,
        },
      });
    }
    demoMainEntries.set(m.name, entry.id);
  }

  // Lấy các entry cũ của Demo school
  const gaoTeEntry = await prisma.ingredientEntry.findFirst({
    where: { schoolId: demoSchoolId, Ingredient: { name: "Gạo tẻ" } },
  });
  const caRotEntry = await prisma.ingredientEntry.findFirst({
    where: { schoolId: demoSchoolId, Ingredient: { name: "Cà rốt" } },
  });
  const dauPhongEntry = await prisma.ingredientEntry.findFirst({
    where: { schoolId: demoSchoolId, Ingredient: { name: "Đậu phộng" } },
  });
  const thitGaEntry = await prisma.ingredientEntry.findFirst({
    where: { schoolId: demoSchoolId, Ingredient: { name: "Thịt gà" } },
  });

  if (gaoTeEntry) demoMainEntries.set("Gạo tẻ", gaoTeEntry.id);
  if (caRotEntry) demoMainEntries.set("Cà rốt", caRotEntry.id);
  if (dauPhongEntry) demoMainEntries.set("Đậu phộng", dauPhongEntry.id);
  if (thitGaEntry) demoMainEntries.set("Thịt gà", thitGaEntry.id);

  // 4. Chuẩn hóa toàn bộ các dòng dish_ingredient_entries cũ: nếu ingredient_role null -> 'MAIN'
  const updatedExistingRoles = await prisma.dishIngredientEntry.updateMany({
    where: {
      OR: [{ ingredientRole: null }, { ingredientRole: "" }],
    },
    data: {
      ingredientRole: "MAIN",
    },
  });
  console.log(
    `✅ Đã chuẩn hóa ${updatedExistingRoles.count} dòng nguyên liệu cũ thành vai trò 'MAIN'`,
  );

  // 5. Cập nhật và bổ sung công thức hoàn chỉnh (Nguyên liệu chính + Gia vị) cho các món trường DEMO
  const demoDishes = await prisma.dish.findMany({
    where: { schoolId: demoSchoolId },
  });

  for (const dish of demoDishes) {
    console.log(`🍳 Đang thiết lập công thức món DEMO: "${dish.name}"...`);

    const linesToAdd: {
      entryId: string;
      role: "MAIN" | "SEASONING";
      qty: string;
      unit: string;
    }[] = [];

    if (dish.name.includes("Canh cà rốt")) {
      if (caRotEntry)
        linesToAdd.push({
          entryId: caRotEntry.id,
          role: "MAIN",
          qty: "0.05",
          unit: "kg",
        });
      const saltId = demoSeasoningEntries.get("Muối tinh i-ốt");
      const hatNemId = demoSeasoningEntries.get("Hạt nêm thịt heo");
      const nuocMamId = demoSeasoningEntries.get("Nước mắm truyền thống");
      if (saltId)
        linesToAdd.push({
          entryId: saltId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
      if (hatNemId)
        linesToAdd.push({
          entryId: hatNemId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
      if (nuocMamId)
        linesToAdd.push({
          entryId: nuocMamId,
          role: "SEASONING",
          qty: "0.003",
          unit: "lít",
        });
    } else if (dish.name.includes("Cơm rau củ")) {
      if (gaoTeEntry)
        linesToAdd.push({
          entryId: gaoTeEntry.id,
          role: "MAIN",
          qty: "0.08",
          unit: "kg",
        });
      if (caRotEntry)
        linesToAdd.push({
          entryId: caRotEntry.id,
          role: "MAIN",
          qty: "0.04",
          unit: "kg",
        });
      const dauAnId = demoSeasoningEntries.get("Dầu thực vật tinh luyện");
      const saltId = demoSeasoningEntries.get("Muối tinh i-ốt");
      if (dauAnId)
        linesToAdd.push({
          entryId: dauAnId,
          role: "SEASONING",
          qty: "0.003",
          unit: "lít",
        });
      if (saltId)
        linesToAdd.push({
          entryId: saltId,
          role: "SEASONING",
          qty: "0.001",
          unit: "kg",
        });
    } else if (dish.name.includes("Cơm trắng")) {
      if (gaoTeEntry)
        linesToAdd.push({
          entryId: gaoTeEntry.id,
          role: "MAIN",
          qty: "0.08",
          unit: "kg",
        });
      const dauAnId = demoSeasoningEntries.get("Dầu thực vật tinh luyện");
      if (dauAnId)
        linesToAdd.push({
          entryId: dauAnId,
          role: "SEASONING",
          qty: "0.002",
          unit: "lít",
        });
    } else if (dish.name.includes("Cháo gạo")) {
      if (gaoTeEntry)
        linesToAdd.push({
          entryId: gaoTeEntry.id,
          role: "MAIN",
          qty: "0.08",
          unit: "kg",
        });
      const saltId = demoSeasoningEntries.get("Muối tinh i-ốt");
      const hatNemId = demoSeasoningEntries.get("Hạt nêm thịt heo");
      if (saltId)
        linesToAdd.push({
          entryId: saltId,
          role: "SEASONING",
          qty: "0.001",
          unit: "kg",
        });
      if (hatNemId)
        linesToAdd.push({
          entryId: hatNemId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
    } else if (
      dish.name.includes("đậu phộng") ||
      dish.name.includes("Đậu phộng")
    ) {
      if (dauPhongEntry)
        linesToAdd.push({
          entryId: dauPhongEntry.id,
          role: "MAIN",
          qty: "0.03",
          unit: "kg",
        });
      const saltId = demoSeasoningEntries.get("Muối tinh i-ốt");
      const dauAnId = demoSeasoningEntries.get("Dầu thực vật tinh luyện");
      if (saltId)
        linesToAdd.push({
          entryId: saltId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
      if (dauAnId)
        linesToAdd.push({
          entryId: dauAnId,
          role: "SEASONING",
          qty: "0.002",
          unit: "lít",
        });
    } else if (dish.name.includes("Thịt gà kho gừng")) {
      if (thitGaEntry)
        linesToAdd.push({
          entryId: thitGaEntry.id,
          role: "MAIN",
          qty: "0.10",
          unit: "kg",
        });
      const nuocMamId = demoSeasoningEntries.get("Nước mắm truyền thống");
      const duongId = demoSeasoningEntries.get("Đường kính trắng");
      const hatNemId = demoSeasoningEntries.get("Hạt nêm thịt heo");
      const tieuId = demoSeasoningEntries.get("Tiêu đen xay");
      if (nuocMamId)
        linesToAdd.push({
          entryId: nuocMamId,
          role: "SEASONING",
          qty: "0.005",
          unit: "lít",
        });
      if (duongId)
        linesToAdd.push({
          entryId: duongId,
          role: "SEASONING",
          qty: "0.003",
          unit: "kg",
        });
      if (hatNemId)
        linesToAdd.push({
          entryId: hatNemId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
      if (tieuId)
        linesToAdd.push({
          entryId: tieuId,
          role: "SEASONING",
          qty: "0.001",
          unit: "kg",
        });
    } else if (
      dish.name.includes("Thịt heo kho") ||
      dish.name.includes("Thịt lợn")
    ) {
      const thitLonId = demoMainEntries.get("Thịt lợn nạc");
      if (thitLonId)
        linesToAdd.push({
          entryId: thitLonId,
          role: "MAIN",
          qty: "0.09",
          unit: "kg",
        });
      const nuocMamId = demoSeasoningEntries.get("Nước mắm truyền thống");
      const duongId = demoSeasoningEntries.get("Đường kính trắng");
      const hatNemId = demoSeasoningEntries.get("Hạt nêm thịt heo");
      if (nuocMamId)
        linesToAdd.push({
          entryId: nuocMamId,
          role: "SEASONING",
          qty: "0.005",
          unit: "lít",
        });
      if (duongId)
        linesToAdd.push({
          entryId: duongId,
          role: "SEASONING",
          qty: "0.003",
          unit: "kg",
        });
      if (hatNemId)
        linesToAdd.push({
          entryId: hatNemId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
    } else if (dish.name.includes("Rau muống") || dish.name.includes("rau")) {
      const rauMuongId = demoMainEntries.get("Rau muống sạch");
      if (rauMuongId)
        linesToAdd.push({
          entryId: rauMuongId,
          role: "MAIN",
          qty: "0.08",
          unit: "kg",
        });
      const dauAnId = demoSeasoningEntries.get("Dầu thực vật tinh luyện");
      const hatNemId = demoSeasoningEntries.get("Hạt nêm thịt heo");
      const hanhToiId = demoSeasoningEntries.get("Hành khô & Tỏi xay");
      if (dauAnId)
        linesToAdd.push({
          entryId: dauAnId,
          role: "SEASONING",
          qty: "0.004",
          unit: "lít",
        });
      if (hatNemId)
        linesToAdd.push({
          entryId: hatNemId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
      if (hanhToiId)
        linesToAdd.push({
          entryId: hanhToiId,
          role: "SEASONING",
          qty: "0.002",
          unit: "kg",
        });
    } else if (dish.name.includes("Sữa chua")) {
      const suaChuaId = demoMainEntries.get("Sữa chua học đường");
      if (suaChuaId)
        linesToAdd.push({
          entryId: suaChuaId,
          role: "MAIN",
          qty: "1",
          unit: "hộp",
        });
    } else if (dish.name.includes("Chuối")) {
      const chuoiId = demoMainEntries.get("Chuối tiêu hồng");
      if (chuoiId)
        linesToAdd.push({
          entryId: chuoiId,
          role: "MAIN",
          qty: "1",
          unit: "quả",
        });
    }

    for (const item of linesToAdd) {
      await prisma.dishIngredientEntry.upsert({
        where: {
          dishId_ingredientEntryId: {
            dishId: dish.id,
            ingredientEntryId: item.entryId,
          },
        },
        create: {
          dishId: dish.id,
          ingredientEntryId: item.entryId,
          ingredientRole: item.role,
          requiredQuantity: item.qty,
          unit: item.unit,
        },
        update: {
          ingredientRole: item.role,
          requiredQuantity: item.qty,
          unit: item.unit,
        },
      });
    }
  }

  // 6. Bổ sung gia vị kho khô vào các món trường Cầu Giấy
  const cauGiayDishes = await prisma.dish.findMany({
    where: { schoolId: cauGiaySchoolId },
    include: { dishIngredientEntries: true },
  });

  const cgSaltId = cauGiaySeasoningEntries.get("Muối tinh i-ốt")!;
  const cgHatNemId = cauGiaySeasoningEntries.get("Hạt nêm thịt heo")!;
  const cgNuocMamId = cauGiaySeasoningEntries.get("Nước mắm truyền thống")!;
  const cgDauAnId = cauGiaySeasoningEntries.get("Dầu thực vật tinh luyện")!;
  const cgDuongId = cauGiaySeasoningEntries.get("Đường kính trắng")!;
  const cgTieuId = cauGiaySeasoningEntries.get("Tiêu đen xay")!;

  for (const dish of cauGiayDishes) {
    const seasoningsToUpsert: { entryId: string; qty: string; unit: string }[] =
      [];

    if (dish.category === "MAIN_DISH") {
      seasoningsToUpsert.push(
        { entryId: cgNuocMamId, qty: "0.005", unit: "lít" },
        { entryId: cgHatNemId, qty: "0.002", unit: "kg" },
        { entryId: cgDuongId, qty: "0.002", unit: "kg" },
        { entryId: cgDauAnId, qty: "0.003", unit: "lít" },
        { entryId: cgTieuId, qty: "0.001", unit: "kg" },
      );
    } else if (dish.category === "SOUP") {
      seasoningsToUpsert.push(
        { entryId: cgHatNemId, qty: "0.002", unit: "kg" },
        { entryId: cgSaltId, qty: "0.002", unit: "kg" },
        { entryId: cgNuocMamId, qty: "0.003", unit: "lít" },
      );
    } else if (dish.category === "VEGETABLE") {
      seasoningsToUpsert.push(
        { entryId: cgDauAnId, qty: "0.004", unit: "lít" },
        { entryId: cgHatNemId, qty: "0.002", unit: "kg" },
        { entryId: cgSaltId, qty: "0.001", unit: "kg" },
      );
    } else if (dish.category === "RICE_STARCH") {
      seasoningsToUpsert.push({
        entryId: cgDauAnId,
        qty: "0.002",
        unit: "lít",
      });
    }

    for (const seas of seasoningsToUpsert) {
      await prisma.dishIngredientEntry.upsert({
        where: {
          dishId_ingredientEntryId: {
            dishId: dish.id,
            ingredientEntryId: seas.entryId,
          },
        },
        create: {
          dishId: dish.id,
          ingredientEntryId: seas.entryId,
          ingredientRole: "SEASONING",
          requiredQuantity: seas.qty,
          unit: seas.unit,
        },
        update: {
          ingredientRole: "SEASONING",
          requiredQuantity: seas.qty,
          unit: seas.unit,
        },
      });
    }
  }

  console.log(
    "🎉 Hoàn tất nạp dữ liệu Gia vị và Nguyên liệu chính vào Database!",
  );
}

main()
  .catch((e) => {
    console.error("❌ Lỗi khi nạp dữ liệu:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
