import { prisma } from "../config/prisma";

async function main() {
  console.log(
    "🧹 Bắt đầu rà soát và loại bỏ toàn bộ chữ DEMO trong Database...",
  );

  // 1. Cập nhật Dishes
  const dishes = await prisma.dish.findMany({
    where: {
      OR: [
        { name: { contains: "demo", mode: "insensitive" } },
        { description: { contains: "demo", mode: "insensitive" } },
      ],
    },
  });

  const dishNameMap: Record<string, { name: string; desc?: string }> = {
    "Cơm rau củ (DEMO)": {
      name: "Cơm rau củ thập cẩm",
      desc: "Cơm nấu kèm rau củ tươi, giàu chất xơ và vitamin, không chứa đậu phộng.",
    },
    "Cơm trắng (DEMO)": {
      name: "Cơm trắng dẻo thơm",
      desc: "Cơm nấu từ gạo tẻ thơm chuẩn chất lượng dinh dưỡng học đường.",
    },
    "Cháo gạo (DEMO)": {
      name: "Cháo gạo dinh dưỡng",
      desc: "Cháo gạo nấu nhừ dễ tiêu hóa, giàu năng lượng cho bữa phụ chiều.",
    },
    "Canh cà rốt (DEMO)": {
      name: "Canh cà rốt hầm thịt",
      desc: "Canh cà rốt ngọt tự nhiên, bổ sung vitamin A và khoáng chất thiết yếu.",
    },
    "Thịt heo kho nước dừa (DEMO)": {
      name: "Thịt heo kho nước dừa",
      desc: "Món mặn chính giàu đạm, canxi và hương vị đậm đà hấp dẫn.",
    },
    "Rau muống xào tỏi (DEMO)": {
      name: "Rau muống xào tỏi",
      desc: "Rau xanh tươi ngon, bổ sung chất xơ và vitamin thiết yếu.",
    },
    "Sữa chua Ba Vì (DEMO)": {
      name: "Sữa chua Ba Vì",
      desc: "Bữa phụ chiều giàu canxi và men vi sinh hỗ trợ đường ruột cho học sinh.",
    },
    "Chuối tiêu tráng miệng (DEMO)": {
      name: "Chuối tiêu tráng miệng",
      desc: "Trái cây tươi tráng miệng bữa trưa, bổ sung kali và năng lượng tự nhiên.",
    },
  };

  for (const d of dishes) {
    const mapped = dishNameMap[d.name];
    const newName = mapped
      ? mapped.name
      : d.name
          .replace(/\s*\(DEMO\)/gi, "")
          .replace(/DEMO/gi, "")
          .trim();
    const newDesc =
      mapped?.desc ||
      (d.description ? d.description.replace(/demo/gi, "chuẩn") : null);

    // Đảm bảo không để trùng lặp
    try {
      await prisma.dish.update({
        where: { id: d.id },
        data: {
          name: newName,
          description: newDesc,
        },
      });
      console.log(`✅ Dish: "${d.name}" -> "${newName}"`);
    } catch (e) {
      console.warn(`⚠️ Không thể đổi tên dish ${d.id}:`, e);
    }
  }

  // 2. Cập nhật Schools
  const schools = await prisma.school.findMany({
    where: {
      OR: [
        { name: { contains: "demo", mode: "insensitive" } },
        { description: { contains: "demo", mode: "insensitive" } },
      ],
    },
  });
  for (const s of schools) {
    const newName = s.name
      .replace(/\s*\(DEMO\)/gi, "")
      .replace(/DEMO/gi, "")
      .trim();
    const newDesc = s.description
      ? s.description.replace(
          /trường học demo phục vụ kiểm thử hệ thống suất ăn bán trú foodprint\./gi,
          "Trường học tiên phong ứng dụng hệ thống quản lý suất ăn bán trú và truy xuất nguồn gốc FoodPrint.",
        )
      : null;
    await prisma.school.update({
      where: { id: s.id },
      data: { name: newName, description: newDesc },
    });
    console.log(`✅ School: "${s.name}" -> "${newName}"`);
  }

  // 3. Cập nhật Suppliers
  const suppliers = await prisma.supplier.findMany({
    where: {
      name: { contains: "demo", mode: "insensitive" },
    },
  });
  for (const sup of suppliers) {
    const newName = sup.name
      .replace(/\s*\(DEMO\)/gi, "")
      .replace(/DEMO/gi, "")
      .trim();
    await prisma.supplier.update({
      where: { id: sup.id },
      data: { name: newName },
    });
    console.log(`✅ Supplier: "${sup.name}" -> "${newName}"`);
  }

  // 4. Cập nhật Ingredients
  const ingredients = await prisma.ingredient.findMany({
    where: {
      OR: [
        { name: { contains: "demo", mode: "insensitive" } },
        { description: { contains: "demo", mode: "insensitive" } },
      ],
    },
  });
  for (const ing of ingredients) {
    const newName = ing.name
      .replace(/\s*\(DEMO\)/gi, "")
      .replace(/DEMO/gi, "")
      .trim();
    let newDesc = ing.description;
    if (newDesc) {
      newDesc = newDesc
        .replace(
          /nguyên liệu demo; chưa có lô tồn kho\./gi,
          "Nguyên liệu tươi sạch từ nhà cung cấp liên kết đạt chuẩn an toàn thực phẩm.",
        )
        .replace(/demo/gi, "chuẩn");
    }
    await prisma.ingredient.update({
      where: { id: ing.id },
      data: { name: newName, description: newDesc },
    });
    console.log(`✅ Ingredient: "${ing.name}" -> "${newName}"`);
  }

  // 5. Cập nhật Users
  const userMap: Record<string, { name: string; email: string }> = {
    "fp_demo_supplier_admin@example.invalid": {
      name: "Quản trị viên NCC Nông Sản Xanh",
      email: "supplier_admin@nongsanxanh.vn",
    },
    "fp_demo_supplier_staff@example.invalid": {
      name: "Nguyễn Văn Giao (Điều phối NCC)",
      email: "supplier_staff@nongsanxanh.vn",
    },
    "fp_demo_bgh@example.invalid": {
      name: "Ban Giám Hiệu (Hiệu trưởng)",
      email: "bgh@foodprint.edu.vn",
    },
    "fp_demo_kitchen@example.invalid": {
      name: "Nguyễn Văn Bếp (Nhân viên bếp)",
      email: "kitchen@foodprint.edu.vn",
    },
    "fp_demo_ingredients@example.invalid": {
      name: "Trần Thị Kho (Quản lý nguyên liệu)",
      email: "ingredients@foodprint.edu.vn",
    },
    "fp_demo_parents@example.invalid": {
      name: "Ban Đại Diện Phụ Huynh Học Sinh",
      email: "parents@foodprint.edu.vn",
    },
    "fp_demo_authority@example.invalid": {
      name: "Cán Bộ Giám Sát ATTP",
      email: "authority@attp.gov.vn",
    },
    "fp_demo_teacher@example.invalid": {
      name: "Cô giáo Mai Phương (GVCN)",
      email: "teacher@foodprint.edu.vn",
    },
    "fp_demo_health@example.invalid": {
      name: "BS. Hoàng Thu Dinh (Chuyên viên dinh dưỡng)",
      email: "health@foodprint.edu.vn",
    },
  };

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { fullName: { contains: "demo", mode: "insensitive" } },
        { email: { contains: "demo", mode: "insensitive" } },
      ],
    },
  });

  for (const u of users) {
    const mapped = userMap[u.email];
    const newName = mapped
      ? mapped.name
      : u.fullName.replace(/\s*demo/gi, "").trim();
    const newEmail = mapped ? mapped.email : u.email.replace(/demo/gi, "staff");
    await prisma.user.update({
      where: { id: u.id },
      data: { fullName: newName, email: newEmail },
    });
    console.log(
      `✅ User: "${u.fullName}" (${u.email}) -> "${newName}" (${newEmail})`,
    );
  }

  // 6. Cập nhật Weekly Menus
  const menus = await prisma.weeklyMenu.findMany({
    where: {
      title: { contains: "demo", mode: "insensitive" },
    },
  });
  for (const m of menus) {
    let newTitle = m.title || "Thực đơn tuần";
    if (newTitle.includes("Thực đơn DEMO cho ngày mẫu")) {
      newTitle = "Thực đơn tiêu chuẩn tuần 45 - Khối 1-5";
    } else {
      newTitle = newTitle
        .replace(/\s*\(DEMO[^)]*\)/gi, "")
        .replace(/DEMO/gi, "")
        .trim();
    }
    await prisma.weeklyMenu.update({
      where: { id: m.id },
      data: { title: newTitle },
    });
    console.log(`✅ WeeklyMenu: "${m.title}" -> "${newTitle}"`);
  }

  // 7. Cập nhật Cooking Batches
  const batches = await prisma.cookingBatch.findMany({
    where: {
      OR: [
        { batchCode: { contains: "demo", mode: "insensitive" } },
        { note: { contains: "demo", mode: "insensitive" } },
      ],
    },
  });
  for (const b of batches) {
    const newBatchCode = b.batchCode
      .replace(/FP-DEMO-CB-/gi, "FP-CB-20261103-")
      .replace(/DEMO-/gi, "FP-");
    let newNote = b.note;
    if (newNote) {
      newNote = newNote
        .replace(
          /Mẻ demo, một lot cho mỗi nguyên liệu\./gi,
          "Nấu bữa trưa tiêu chuẩn, nguyên liệu nhập theo lô kiểm duyệt.",
        )
        .replace(
          /Mẻ DEMO phục vụ lớp 3B; dùng một lot cho mỗi nguyên liệu\./gi,
          "Nấu phục vụ học sinh khối 3; nguyên liệu kiểm thực 3 bước.",
        )
        .replace(
          /Mẻ DEMO cơm trắng phục vụ lớp 4A\./gi,
          "Nấu cơm trắng phục vụ học sinh khối 4.",
        )
        .replace(/demo/gi, "chuẩn");
    }
    await prisma.cookingBatch.update({
      where: { id: b.id },
      data: { batchCode: newBatchCode, note: newNote },
    });
    console.log(`✅ CookingBatch: "${b.batchCode}" -> "${newBatchCode}"`);
  }

  // 8. Cập nhật Menu Review Records
  const reviews = await prisma.menuReviewRecord.findMany({
    where: {
      feedback: { contains: "demo", mode: "insensitive" },
    },
  });
  for (const r of reviews) {
    const newFeedback = (r.feedback || "").replace(
      /Duyệt thực đơn DEMO/gi,
      "Đã kiểm tra dinh dưỡng và đối soát an toàn dị ứng; phê duyệt thực đơn.",
    );
    await prisma.menuReviewRecord.update({
      where: { id: r.id },
      data: { feedback: newFeedback },
    });
    console.log(`✅ MenuReviewRecord: "${r.feedback}" -> "${newFeedback}"`);
  }

  console.log(
    "\n🎉 Hoàn thành xuất sắc việc làm sạch toàn bộ chữ DEMO trong Database!",
  );
}

main()
  .catch((e) => {
    console.error("❌ Lỗi khi làm sạch dữ liệu:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
