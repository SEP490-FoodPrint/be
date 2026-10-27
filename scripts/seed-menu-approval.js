import pg from "pg"
import sequelize from "../src/config/database.js"
import Ingredient from "../src/modules/ingredient/ingredient.model.js"
import IngredientEntry from "../src/modules/ingredient-entry/ingredient-entry.model.js"
import {
  Dish,
  DishIngredientEntry,
  MenuDay,
  MenuDayDish,
  MenuReviewRecord,
  WeeklyMenu,
} from "../src/modules/menu/menu.model.js"
import { School, Supplier } from "../src/modules/organization/organization.model.js"
import Role from "../src/modules/role/role.model.js"
import User from "../src/modules/user/user.model.js"

const { Client } = pg

const IDS = {
  school: "10000000-0000-4000-8000-000000000001",
  menu: "43000000-0000-4000-8000-000000000001",
  healthUser: "20000000-0000-4000-8000-000000000001",
  managementUser: "20000000-0000-4000-8000-000000000002",
  adminUser: "20000000-0000-4000-8000-000000000003",
  medicalReview: "44000000-0000-4000-8000-000000000001",
}

const suppliers = [
  ["30000000-0000-4000-8000-000000000001", "SUP-XANH-SONG-HONG", "Công ty CP Thực phẩm Xanh Sông Hồng"],
  ["30000000-0000-4000-8000-000000000002", "SUP-CP-FOODS", "CP Foods Việt Nam"],
  ["30000000-0000-4000-8000-000000000003", "SUP-RAU-VAN-NOI", "HTX Rau sạch Vân Nội"],
  ["30000000-0000-4000-8000-000000000004", "SUP-VINAMILK", "Công ty CP Sữa Vinamilk"],
  ["30000000-0000-4000-8000-000000000005", "SUP-HAI-SAN-HP", "Hải sản Hải Phòng Co."],
  ["30000000-0000-4000-8000-000000000006", "SUP-TH-TRUE-MILK", "Tập đoàn TH True Milk"],
  ["30000000-0000-4000-8000-000000000007", "SUP-RAU-TAM-DAO", "HTX Rau sạch Tam Đảo"],
  ["30000000-0000-4000-8000-000000000008", "SUP-THUY-SAN-HV", "Thủy sản Hùng Vương"],
  ["30000000-0000-4000-8000-000000000009", "SUP-DAU-MO", "HTX Đậu Mơ Hà Nội"],
  ["30000000-0000-4000-8000-000000000010", "SUP-NUTIFOOD", "Công ty Dinh dưỡng Nutifood"],
  ["30000000-0000-4000-8000-000000000011", "SUP-THO-PHAT", "Bánh bao Thọ Phát"],
  ["30000000-0000-4000-8000-000000000012", "SUP-KINH-DO", "Công ty Bánh kẹo Kinh Đô"],
  ["30000000-0000-4000-8000-000000000013", "SUP-BEP-TRUONG", "Bếp trường Ánh Dương"],
  ["30000000-0000-4000-8000-000000000014", "SUP-NONG-SAN", "Nông sản VietGAP miền Bắc"],
]

const menuDays = [
  {
    order: 2,
    date: "2026-10-26",
    items: [
      ["LUNCH", "MAIN", "Thịt nạc heo kho trứng cút sốt caramel dừa", "Thịt nạc thăn, trứng cút sạch Tiên Viên và nước dừa tươi Bến Tre", "SUP-CP-FOODS", "Trứng", "warning"],
      ["LUNCH", "MAIN", "Bí ngòi xanh xào cà rốt nấm đông cô", "Bí ngòi hữu cơ, cà rốt Đà Lạt và nấm hương khô loại 1", "SUP-RAU-VAN-NOI", "Ăn lành", "success"],
      ["LUNCH", "SOUP", "Canh bí đỏ hầm sườn thịt bằm hành hoa", "Bí đỏ hồ lô, thịt nạc dăm và nước xương ống hầm tự nhiên", "SUP-XANH-SONG-HONG", null, "neutral"],
      ["LUNCH", "STAPLE", "Cơm trắng dẻo ST25", "Gạo sạch ST An Giang", "SUP-NONG-SAN", null, "neutral"],
      ["LUNCH", "DESSERT", "Tráng miệng: Quýt đường Hàm Yên", "Đã rửa ozon khử khuẩn", "SUP-NONG-SAN", null, "neutral"],
      ["SNACK", "SNACK", "Súp bắp ngô non thịt gà xé tơ", "Ức gà tươi, bắp ngọt, nấm hương và trứng gà", "SUP-BEP-TRUONG", "Chứa trứng", "warning"],
      ["SNACK", "SNACK", "Sữa chua uống men sống Probi 65ml", "Bổ sung vi sinh đường ruột cho học sinh bán trú", "SUP-VINAMILK", "Sữa bò", "neutral"],
    ],
  },
  {
    order: 3,
    date: "2026-10-27",
    items: [
      ["LUNCH", "MAIN", "Bò Úc sốt tiêu nhẹ xào ớt chuông ngọt và hành tây", "Thịt bò bắp mềm, ớt chuông Đà Lạt và tiêu Phú Quốc vị dịu", "SUP-XANH-SONG-HONG", "Giàu sắt", "success"],
      ["LUNCH", "MAIN", "Cải chíp hấp dầu hào tỏi phi thơm", "Cải thìa non VietGAP, dầu hào và tỏi ta Kinh Môn", "SUP-RAU-VAN-NOI", "Gluten nhẹ", "warning"],
      ["LUNCH", "SOUP", "Canh mồng tơi nấu thịt cua đồng tinh khiết", "Cua đồng sơ chế tiệt trùng, rau mồng tơi và mướp hương", "SUP-HAI-SAN-HP", "Cảnh báo hải sản", "error"],
      ["LUNCH", "STAPLE", "Cơm trắng dẻo ST25", "Gạo sạch ST An Giang", "SUP-NONG-SAN", null, "neutral"],
      ["LUNCH", "DESSERT", "Tráng miệng: Chuối tiêu hồng Hưng Yên", "Chứng nhận OCOP 4 sao", "SUP-NONG-SAN", null, "neutral"],
      ["SNACK", "SNACK", "Bánh bao sữa hấp nhân thịt xá xíu mộc nhĩ", "Bột mì cao cấp, thịt nạc dăm, mộc nhĩ và sữa tươi", "SUP-THO-PHAT", "Gluten", "warning"],
      ["SNACK", "SNACK", "Sữa hạt sen Nam Đàn ít đường 180ml", "Thức uống thanh nhẹ, bổ dưỡng tự nhiên cho học sinh", "SUP-NUTIFOOD", "Thảo mộc", "neutral"],
    ],
  },
  {
    order: 4,
    date: "2026-10-28",
    items: [
      ["LUNCH", "MAIN", "Gà ta rim nước mắm cốt nhĩ và mật ong rừng", "Đùi gà rút xương, mật ong hoa nhãn và nước mắm Phan Thiết", "SUP-CP-FOODS", "Đạm cao", "success"],
      ["LUNCH", "MAIN", "Đậu cô ve xào thịt nạc thăn bằm", "Đậu cô ve xanh giống Nhật và thịt nạc thăn bằm nhuyễn", "SUP-RAU-VAN-NOI", null, "neutral"],
      ["LUNCH", "SOUP", "Canh củ cải trắng hầm thịt bò viên đậu Hà Lan", "Bò viên làm trong ngày, không hàn the và đậu Hà Lan non", "SUP-XANH-SONG-HONG", null, "neutral"],
      ["LUNCH", "STAPLE", "Cơm trắng dẻo ST25", "Gạo sạch ST An Giang", "SUP-NONG-SAN", null, "neutral"],
      ["LUNCH", "DESSERT", "Tráng miệng: Đu đủ ruột đỏ", "Trang trại Hòa Bình", "SUP-NONG-SAN", null, "neutral"],
      ["SNACK", "SNACK", "Phở gà truyền thống Hà Nội (bát nhỏ)", "Bánh phở tươi không formol, ức gà xé và nước hầm xương", "SUP-BEP-TRUONG", "Nước dùng ấm", "success"],
      ["SNACK", "SNACK", "Sữa chua men sống TH true YOGURT 100g", "Lên men tự nhiên từ sữa tươi trang trại TH", "SUP-TH-TRUE-MILK", "Sữa tươi", "neutral"],
    ],
  },
  {
    order: 5,
    date: "2026-10-29",
    items: [
      ["LUNCH", "MAIN", "Cá ba sa phi lê lăn bột hoàng kim sốt cà chua", "Phi lê cá chiên ráo dầu và sốt cà chua bi Đà Lạt", "SUP-THUY-SAN-HV", "Thủy sản & Gluten", "error"],
      ["LUNCH", "MAIN", "Su su xào tôm nõn khô băm và mộc nhĩ", "Su su Tam Đảo thái chỉ và tôm nõn giã dập tạo vị ngọt", "SUP-RAU-TAM-DAO", "Cảnh báo: Tôm", "error"],
      ["LUNCH", "SOUP", "Canh rau ngót nấu thịt nạc bằm", "Rau ngót vườn an toàn và thịt nạc mông xay", "SUP-XANH-SONG-HONG", null, "neutral"],
      ["LUNCH", "STAPLE", "Cơm trắng dẻo ST25", "Gạo sạch ST An Giang", "SUP-NONG-SAN", null, "neutral"],
      ["LUNCH", "DESSERT", "Tráng miệng: Táo ngọt Ninh Thuận", "Chứng nhận VietGAP", "SUP-NONG-SAN", null, "neutral"],
      ["SNACK", "SNACK", "Chè đậu đỏ hạt sen cốt dừa tươi", "Đậu đỏ ninh nhừ, hạt sen Huế và đường phèn Quảng Ngãi", "SUP-BEP-TRUONG", "Thanh ngọt", "neutral"],
      ["SNACK", "SNACK", "Bánh quy bơ hạt chia dinh dưỡng", "Gói lẻ đảm bảo an toàn vệ sinh cá nhân", "SUP-KINH-DO", "Gluten", "warning"],
    ],
  },
  {
    order: 6,
    date: "2026-10-30",
    items: [
      ["LUNCH", "MAIN", "Thịt ba chỉ quay giòn bì ăn kèm dưa leo non", "Ba chỉ nướng nhiệt đối lưu không cháy và nước sốt tương ngọt", "SUP-CP-FOODS", "Được yêu thích", "success"],
      ["LUNCH", "MAIN", "Đậu hũ non sốt nấm hương tươi và hành lá", "Đậu phụ làng Mơ kiểm định không chất bảo quản", "SUP-DAU-MO", "Đậu nành", "warning"],
      ["LUNCH", "SOUP", "Canh chua cá lóc miền Tây nấu dứa và cà chua", "Cá lóc đồng lọc xương cẩn thận, vị me chua thanh dịu", "SUP-XANH-SONG-HONG", "Thủy sản", "error"],
      ["LUNCH", "STAPLE", "Cơm trắng dẻo ST25", "Gạo sạch ST An Giang", "SUP-NONG-SAN", null, "neutral"],
      ["LUNCH", "DESSERT", "Tráng miệng: Sữa chua dầm dâu tây Mộc Châu", "Bếp chế biến đóng cốc", "SUP-BEP-TRUONG", null, "neutral"],
      ["SNACK", "SNACK", "Bánh mì gối tươi kẹp phô mai nướng mềm", "Phô mai Con Bò Cười và bánh mì mềm cho học sinh tiểu học", "SUP-BEP-TRUONG", "Sữa & Gluten", "warning"],
      ["SNACK", "SNACK", "Sữa tươi tiệt trùng Vinamilk 100% 180ml", "Sữa có đường bổ sung Vitamin D3 và Canxi", "SUP-VINAMILK", "Sữa bò", "neutral"],
    ],
  },
]

const uuidFor = (prefix, day, item) =>
  `${prefix.padEnd(8, "0")}-0000-4000-8000-${String(day).padStart(2, "0")}${String(item).padStart(10, "0")}`

const ensureDatabase = async () => {
  const database = process.env.DB_NAME || "foodprint"
  if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error("Tên database không hợp lệ")

  const client = new Client({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASS || "123",
    database: "postgres",
  })
  await client.connect()
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])
    if (!result.rowCount) await client.query(`CREATE DATABASE "${database}"`)
  } finally {
    await client.end()
  }
}

const seed = async () => {
  await ensureDatabase()
  await sequelize.authenticate()
  await sequelize.query('CREATE SCHEMA IF NOT EXISTS "foodprint"')
  await sequelize.sync()

  await School.upsert({
    id: IDS.school,
    name: "Trường Tiểu học Ánh Dương",
    code: "SCH_ANH_DUONG",
    address: "Số 18 Phố Nguyễn Phong Sắc, Cầu Giấy, Hà Nội",
    status: "ACTIVE",
  })

  for (const [id, code, name] of suppliers) {
    await Supplier.upsert({
      id,
      name,
      tax_code: code,
      status: "ACTIVE",
    })
  }

  const roleIds = new Map()
  const roleCodes = [
    "SYSTEM_ADMIN",
    "INGREDIENT_SUPPLIER",
    "SCHOOL_ADMIN",
    "SCHOOL_MANAGEMENT_BOARD",
    "SCHOOL_HEALTH_OFFICER",
    "SCHOOL_KITCHEN_STAFF",
    "HOMEROOM_TEACHER",
    "PARENTS_COMMITTEE",
    "INGREDIENT_MANAGEMENT_DEPARTMENT",
  ]
  for (let index = 0; index < roleCodes.length; index += 1) {
    const code = roleCodes[index]
    const id = `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    roleIds.set(code, id)
    await Role.upsert({ id, code, name: code, type: "SYSTEM", description: null })
  }

  const users = [
    ["20000000-0000-4000-8000-000000000010", "system_admin", "Nguyễn Văn Toàn", "SYSTEM_ADMIN", null, null, "SYSTEM"],
    ["20000000-0000-4000-8000-000000000011", "supplier_fresh", "Trần Thị Bích", "INGREDIENT_SUPPLIER", null, suppliers[0][0], "SUPPLIER"],
    [IDS.adminUser, "school_admin", "Phạm Hải Đăng", "SCHOOL_ADMIN", IDS.school, null, "SCHOOL"],
    [IDS.managementUser, "school_bgh", "Thầy Nguyễn Văn Minh", "SCHOOL_MANAGEMENT_BOARD", IDS.school, null, "SCHOOL"],
    [IDS.healthUser, "school_health", "BS. Lê Thị Hoa", "SCHOOL_HEALTH_OFFICER", IDS.school, null, "SCHOOL"],
    ["20000000-0000-4000-8000-000000000012", "school_kitchen", "Đầu bếp Vũ Đình Trọng", "SCHOOL_KITCHEN_STAFF", IDS.school, null, "SCHOOL"],
    ["20000000-0000-4000-8000-000000000013", "school_teacher", "Cô Hoàng Thu Trang", "HOMEROOM_TEACHER", IDS.school, null, "SCHOOL"],
    ["20000000-0000-4000-8000-000000000014", "school_parents", "Ông Bùi Quốc Tuấn", "PARENTS_COMMITTEE", IDS.school, null, "SCHOOL"],
    ["20000000-0000-4000-8000-000000000015", "school_warehouse", "Đỗ Minh Quân", "INGREDIENT_MANAGEMENT_DEPARTMENT", IDS.school, null, "SCHOOL"],
  ]
  for (const [id, username, fullName, role, schoolId, supplierId] of users) {
    await User.upsert({
      id,
      role_id: roleIds.get(role),
      school_id: schoolId,
      supplier_id: supplierId,
      username,
      email: `${username}@foodprint.local`,
      password_hash: "prototype-no-login",
      full_name: fullName,
      status: "ACTIVE",
    })
  }

  await WeeklyMenu.upsert({
    id: IDS.menu,
    school_id: IDS.school,
    created_by_user_id: IDS.adminUser,
    title: "Thực đơn Bán trú Tiêu chuẩn Mùa Thu - Tuần 43",
    week_start_date: "2026-10-26",
    status: "PENDING_APPROVAL",
    submitted_at: new Date("2026-10-20T14:30:00+07:00"),
  })

  await MenuReviewRecord.destroy({
    where: { weekly_menu_id: IDS.menu },
  })

  await MenuReviewRecord.upsert({
    id: IDS.medicalReview,
    weekly_menu_id: IDS.menu,
    reviewer_user_id: IDS.healthUser,
    decision: "APPROVED",
    feedback: "Đã thẩm định cơ cấu nhóm chất cân đối. Các món phù hợp với thời tiết giao mùa cuối thu.",
    reviewed_at: new Date("2026-10-21T09:15:00+07:00"),
  })

  const suppliersByCode = new Map(suppliers.map(([id, code]) => [code, id]))
  for (const day of menuDays) {
    const menuDayId = uuidFor("45", day.order, 1)
    await MenuDay.upsert({
      id: menuDayId,
      weekly_menu_id: IDS.menu,
      menu_date: day.date,
      note: "Phục vụ 1.520 suất",
    })

    for (let index = 0; index < day.items.length; index += 1) {
      const [mealType, dishType, name, description, supplierCode, tag, tone] = day.items[index]
      const sequence = index + 1
      const dishId = uuidFor("46", day.order, sequence)
      const ingredientId = uuidFor("47", day.order, sequence)
      const menuDayDishId = uuidFor("48", day.order, sequence)
      const entryId = uuidFor("49", day.order, sequence)

      await Dish.upsert({
        id: dishId,
        school_id: IDS.school,
        name,
        description,
        status: "ACTIVE",
      })
      await Ingredient.upsert({
        id: ingredientId,
        supplier_id: suppliersByCode.get(supplierCode),
        name: `Nguyên liệu chính: ${name}`,
        category: dishType,
        default_unit: "kg",
        description,
        status: "ACTIVE",
      })
      await IngredientEntry.upsert({
        id: entryId,
        school_id: IDS.school,
        ingredient_id: ingredientId,
        storage_requirements: tag || null,
        shelf_life_days: 1,
        handling_type: "FRESH",
        status: "ACTIVE",
        created_by_user_id: IDS.adminUser,
      })
      await MenuDayDish.upsert({
        menu_day_id: menuDayId,
        dish_id: dishId,
        meal_type: mealType,
        display_order: sequence,
        portion_size: 1520,
        portion_unit: "suất",
      })
      await DishIngredientEntry.upsert({
        dish_id: dishId,
        ingredient_entry_id: entryId,
        required_quantity: 1,
        unit: "định lượng chuẩn",
      })
    }
  }

  console.log("✅ Seed thực đơn tuần 43 hoàn tất")
  console.log("   Menu ID:", IDS.menu)
  console.log("   Actor mặc định: school_bgh (không yêu cầu đăng nhập)")
}

try {
  await seed()
} catch (error) {
  console.error("❌ Seed thất bại:", error)
  process.exitCode = 1
} finally {
  await sequelize.close()
}
