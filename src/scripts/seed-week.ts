/**
 * ============================================================================
 * SEED TUẦN: THỰC ĐƠN ĐÃ DUYỆT + ĐIỂM DANH ĐỂ TEST LUỒNG 5 CHẶNG
 * ============================================================================
 * Đề xuất & quyết định: .task_specs/TASK-01-B-PROPOSAL-weekly-seed-data.md
 *
 * ---------------------------------------------------------------------------
 * 1. LỆNH CHẠY (đứng trong thư mục FoodPrintBE)
 * ---------------------------------------------------------------------------
 *   # Xem trước (KHÔNG ghi gì). Mặc định: tuần hiện tại + tuần kế tiếp.
 *   npm run seed:week -- insert
 *   npm run seed:week -- insert --week 2026-11-23
 *
 *   # Ghi thật. DB không phải localhost (Azure dev) phải thêm --remote-ok.
 *   npm run seed:week -- insert --apply --remote-ok
 *   npm run seed:week -- insert --week 2026-11-23 --apply --remote-ok
 *
 *   # Xoá (bắt buộc --week; tuỳ chọn --grade "Khối lớp 4-5"). Mặc định chỉ xem trước.
 *   npm run seed:week -- delete --week 2026-11-23
 *   npm run seed:week -- delete --week 2026-11-23 --apply --remote-ok
 *
 *   --week nhận MỘT NGÀY BẤT KỲ trong tuần, script tự quy về thứ Hai.
 *
 * ---------------------------------------------------------------------------
 * 2. INSERT LÀM GÌ
 * ---------------------------------------------------------------------------
 * Với mỗi tuần, mỗi khối trong CONFIG.grades:
 *   a) TỰ CHỌN MÓN (không cần lên thực đơn tay):
 *      - Mỗi thực đơn khối dùng ĐÚNG 1 NCC cho toàn bộ nguyên liệu tươi (DIRECT_USE),
 *        nên đơn đặt NL đợt 1 / đợt 2 của khối đó chỉ ra 1 NCC.
 *      - Nguyên liệu khô / gia vị (DRY_STOCK) lấy từ kho khô (phải có tồn kho, xem mục 4).
 *      - Chỉ chọn món có công thức theo khối và mọi NL đều ACTIVE, nằm trong
 *        hợp đồng ACTIVE của NCC tương ứng (điều kiện để gửi đơn được).
 *      - Món chọn theo "suất" danh mục trong CONFIG.slots (trưa: cơm + mặn + canh + rau;
 *        xế: món chính chiều + sữa/trái cây). NCC đồ tươi được chọn sao cho đủ món
 *        cho mọi suất. Món xoay vòng theo ngày nên mỗi ngày khác nhau.
 *   b) TẠO THỰC ĐƠN ĐÃ DUYỆT: WeeklyMenu (theo khối, APPROVED) + WeeklyMenuGrade +
 *      MenuDay (APPROVED) + MenuDayDish + MenuDayDishIngredient (dòng MAIN của công thức
 *      theo khối) + MenuMealSeasoning (gộp dòng SEASONING theo bữa) + MenuReviewRecord
 *      (BGH duyệt). KHÔNG tạo nhóm suất, nên GVCN chỉ cần chốt tổng suất.
 *   c) ĐIỂM DANH: chỉ tạo DailyMealPortion (FINALIZED, = 100% suất đăng ký) cho lớp
 *      CHƯA có bản ghi ngày/bữa đó. Bản ghi có sẵn được GIỮ NGUYÊN. Bỏ qua lớp đang có
 *      GVCN phân công (để cô giáo tự điểm danh trên UI).
 *
 * Bỏ qua (có in lý do):
 *   - Ngày đã qua, thứ 7/CN, ngày nghỉ của năm học, ngày ngoài năm học.
 *   - Khối đã có thực đơn THẬT trong tuần (do người tạo qua UI). Không đụng vào.
 *   - Ngày mà điểm danh có sẵn của lớp trong khối đã gắn nhóm suất / suất dị ứng của
 *     thực đơn khác (bếp sẽ báo lệch nhóm suất nếu seed thực đơn không nhóm suất).
 *
 * Chạy lại nhiều lần an toàn: id sinh tất định từ (trường, tuần, khối, ngày, lớp, bữa),
 * đã có thì bỏ qua, không nhân bản.
 *
 * ---------------------------------------------------------------------------
 * 3. DELETE XOÁ GÌ (chỉ những gì seed tạo ra + mọi thứ sinh ra TỪ thực đơn seed)
 * ---------------------------------------------------------------------------
 *   - Thực đơn seed (nhận diện bằng id tất định + tiền tố "[SEED]" ở tiêu đề).
 *   - Điểm danh do seed tạo (id tất định). Điểm danh có sẵn / do GVCN nhập: GIỮ.
 *   - Mẻ nấu, nhóm mẻ, NL đã dùng của mẻ, gia vị đã giữ của các ngày thực đơn seed.
 *   - Mẫu lưu của các mẻ đó; phân bổ suất + phát suất dùng các mẻ đó.
 *   - Đơn đặt NL (SupplyRequest) của trường có ngày giao = ngày thực đơn seed,
 *     tạo SAU thực đơn seed, và MỌI dòng NL đều thuộc thực đơn seed của ngày đó;
 *     kèm chuyến giao (Delivery, dòng hàng, 4 phê duyệt), lô NL, phiếu nhập kho,
 *     phản hồi chất lượng.
 *   - Bằng chứng blockchain (bảng blockchain_proofs) của tất cả các bản ghi trên.
 *   - Hoàn lại tồn kho cho các lô KHÔNG bị xoá đã bị trừ khi nấu (vd. gia vị kho khô).
 *
 * Từ chối xoá (rollback toàn bộ, in lý do) khi gặp dữ liệu không thể tự quyết:
 *   sự cố ATTP / kết quả kiểm nghiệm / khiếu nại gắn vào; lô của đơn seed đã bị mẻ nấu
 *   KHÁC dùng; bằng chứng phát suất của ngày còn chứa lớp không thuộc seed.
 *
 * Không xoá được (ngoài DB): hash đã ghi lên blockchain (Sepolia) và ảnh trên Cloudinary.
 *
 * ---------------------------------------------------------------------------
 * 4. YÊU CẦU TRƯỚC KHI TEST LUỒNG
 * ---------------------------------------------------------------------------
 *   - Kho khô phải có lô DRY_STOCK cho các gia vị / NL khô của thực đơn (bếp giữ gia vị
 *     khi nấu). Đơn đợt 1/đợt 2 trên FE chỉ đặt đồ tươi -> cần 1 đơn đồ khô riêng.
 *   - Mọi thao tác GVCN / bếp / phát suất chỉ làm được cho "hôm nay".
 * ============================================================================
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../config/prisma";
import { convertQuantity } from "../modules/kitchen/kitchen.service";

// ---------------------------------------------------------------------------
// CẤU HÌNH (dữ liệu seed)
// ---------------------------------------------------------------------------
const CONFIG = {
  schoolCode: "FP-SCHOOL-01",
  /** freshSupplier: tên NCC đồ tươi cho khối; null = tự chọn NCC có nhiều món phù hợp nhất. */
  grades: [
    { gradeName: "Khối lớp 1-3", freshSupplier: null as string | null },
    { gradeName: "Khối lớp 4-5", freshSupplier: null as string | null },
  ],
  /** Mỗi suất = 1 món, chọn trong các danh mục món của trường (SchoolDishCategory.name). */
  slots: {
    LUNCH: [["Món cơm"], ["Món mặn"], ["Món canh"], ["Món rau", "Món xào"]],
    AFTERNOON: [
      [
        "Món cháo",
        "Món súp",
        "Bún – phở – mì – miến",
        "Món nui",
        "Bánh bao – bánh hấp",
        "Bánh mặn",
      ],
      ["Sữa chua và chế phẩm từ sữa", "Sữa", "Trái cây", "Món tráng miệng"],
    ],
  } as Record<"LUNCH" | "AFTERNOON", string[][]>,
  /** Số suất điểm danh = suất đăng ký × tỉ lệ (1 = y đúc 100%). */
  attendanceRatio: 1,
  titlePrefix: "[SEED]",
  namespace: "foodprint-seed-week:v1",
};

type Tx = Prisma.TransactionClient;
type MealType = "LUNCH" | "AFTERNOON";
const MEALS: MealType[] = ["LUNCH", "AFTERNOON"];

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const APPLY = flag("--apply");

function seedId(...parts: string[]) {
  const v = createHash("sha256")
    .update([CONFIG.namespace, ...parts].join(":"))
    .digest("hex");
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-4${v.slice(13, 16)}-8${v.slice(17, 20)}-${v.slice(20, 32)}`;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (s: string) => s.split("-").reverse().join("/");
const utcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const vnToday = () =>
  new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
function monday(s: string) {
  const d = utcDate(s);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return iso(d);
}
function addDays(s: string, n: number) {
  const d = utcDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
const log = (msg: string) => console.log(msg);

function assertWriteTarget() {
  const url = process.env.DATABASE_URL ?? "";
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL không hợp lệ");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  log(`DB: ${host}${local ? " (local)" : " (REMOTE)"}`);
  if (APPLY && !local && !flag("--remote-ok"))
    throw new Error(
      "DB không phải localhost. Thêm --remote-ok nếu chắc chắn muốn ghi lên DB dùng chung.",
    );
}

// ---------------------------------------------------------------------------
// Đọc dữ liệu nền của trường
// ---------------------------------------------------------------------------
async function loadSchool(db: Tx | typeof prisma) {
  const school = await db.school.findFirst({
    where: { code: CONFIG.schoolCode },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`Không tìm thấy trường ${CONFIG.schoolCode}`);
  const [grades, years, users, homeroom] = await Promise.all([
    db.schoolGrade.findMany({
      where: { schoolId: school.id },
      select: { id: true, name: true },
    }),
    db.schoolAcademicYear.findMany({
      where: { schoolId: school.id },
      select: {
        academicYear: true,
        startDate: true,
        endDate: true,
        holidays: true,
      },
    }),
    db.user.findMany({
      where: {
        schoolId: school.id,
        status: "ACTIVE",
        roleCode: {
          in: ["SCHOOL_NUTRITION_OFFICER", "SCHOOL_MANAGEMENT_BOARD"],
        },
      },
      select: { id: true, roleCode: true },
    }),
    db.classHomeroomAssignment.findMany({
      where: { endedAt: null, Class: { schoolId: school.id } },
      select: { classId: true, Class: { select: { name: true } } },
    }),
  ]);
  const officer = users.find((u) => u.roleCode === "SCHOOL_NUTRITION_OFFICER");
  const board = users.find((u) => u.roleCode === "SCHOOL_MANAGEMENT_BOARD");
  if (!officer || !board)
    throw new Error(
      "Trường cần tài khoản cán bộ dinh dưỡng và BGH đang hoạt động",
    );
  return { school, grades, years, officer, board, homeroom };
}
type SchoolCtx = Awaited<ReturnType<typeof loadSchool>>;

function dayStatus(ctx: SchoolCtx, day: string) {
  const weekday = utcDate(day).getUTCDay();
  if (weekday === 0 || weekday === 6) return { ok: false, reason: "cuối tuần" };
  const year = ctx.years.find(
    (y) => iso(y.startDate) <= day && iso(y.endDate) >= day,
  );
  if (!year) return { ok: false, reason: "ngoài năm học" };
  const holidays = Array.isArray(year.holidays) ? year.holidays : [];
  const holiday = holidays.find(
    (h) =>
      h &&
      typeof h === "object" &&
      !Array.isArray(h) &&
      (h as { date?: unknown }).date === day,
  ) as { reason?: string } | undefined;
  if (holiday)
    return { ok: false, reason: `ngày nghỉ (${holiday.reason ?? ""})` };
  return { ok: true, reason: "", academicYear: year.academicYear };
}

// ---------------------------------------------------------------------------
// Chọn món theo 1 NCC đồ tươi
// ---------------------------------------------------------------------------
type Line = {
  ingredientRole: string;
  requiredQuantity: Prisma.Decimal;
  unit: string;
  entry: {
    id: string;
    status: string;
    handlingType: string;
    ingredientId: string;
    Ingredient: {
      status: string;
      supplierId: string;
      defaultUnit: string | null;
    };
  };
};
type Candidate = {
  dishId: string;
  name: string;
  mealType: string | null;
  category: string | null;
  lines: Line[];
  fresh: boolean;
};

async function loadCatalog(
  db: typeof prisma,
  ctx: SchoolCtx,
  gradeId: string,
  on: string,
) {
  const contracts = await db.supplierContract.findMany({
    where: {
      schoolId: ctx.school.id,
      status: "ACTIVE",
      relationship: { status: "ACTIVE" },
      supplier: { status: "ACTIVE" },
      OR: [{ startsOn: null }, { startsOn: { lte: utcDate(on) } }],
      AND: [{ OR: [{ endsOn: null }, { endsOn: { gte: utcDate(on) } }] }],
    },
    select: {
      supplierId: true,
      supplier: { select: { name: true } },
      items: { select: { ingredientId: true } },
    },
  });
  const inContract = new Map<string, Set<string>>();
  const supplierNames = new Map<string, string>();
  for (const c of contracts) {
    supplierNames.set(c.supplierId, c.supplier.name);
    const set = inContract.get(c.supplierId) ?? new Set<string>();
    c.items.forEach((i) => set.add(i.ingredientId));
    inContract.set(c.supplierId, set);
  }
  const recipes = await db.dishGradeRecipe.findMany({
    where: { gradeId, schoolId: ctx.school.id, dish: { status: "ACTIVE" } },
    select: {
      dishId: true,
      dish: {
        select: {
          name: true,
          mealType: true,
          schoolCategory: { select: { name: true } },
        },
      },
      lines: {
        select: {
          ingredientRole: true,
          requiredQuantity: true,
          unit: true,
          entry: {
            select: {
              id: true,
              status: true,
              handlingType: true,
              ingredientId: true,
              Ingredient: {
                select: { status: true, supplierId: true, defaultUnit: true },
              },
            },
          },
        },
      },
    },
  });
  const ordered = (l: Line) =>
    inContract.get(l.entry.Ingredient.supplierId)?.has(l.entry.ingredientId) ??
    false;
  /** Món hợp lệ cho NCC đồ tươi S; trả null nếu không dùng được. */
  function candidateFor(supplierId: string) {
    const out: Candidate[] = [];
    for (const r of recipes) {
      const lines = r.lines as Line[];
      if (!lines.some((l) => l.ingredientRole === "MAIN")) continue;
      const valid = lines.every((l) => {
        if (
          l.entry.status !== "ACTIVE" ||
          l.entry.Ingredient.status !== "ACTIVE"
        )
          return false;
        if (l.ingredientRole === "SEASONING")
          return l.entry.handlingType === "DRY_STOCK" && ordered(l);
        if (l.entry.handlingType === "DIRECT_USE")
          return l.entry.Ingredient.supplierId === supplierId && ordered(l);
        return ordered(l);
      });
      if (!valid) continue;
      out.push({
        dishId: r.dishId,
        name: r.dish.name,
        mealType: r.dish.mealType,
        category: r.dish.schoolCategory?.name ?? null,
        lines,
        fresh: lines.some(
          (l) =>
            l.ingredientRole === "MAIN" &&
            l.entry.handlingType === "DIRECT_USE",
        ),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }
  return {
    supplierNames,
    freshSuppliers: [...inContract.keys()],
    candidateFor,
  };
}

const fitsMeal = (c: Candidate, meal: MealType) =>
  c.mealType === null || c.mealType === "BOTH" || c.mealType === meal;

/** Món cho từng suất của bữa; suất không có món hợp lệ thì để trống. */
function slotPools(cands: Candidate[]) {
  const pools = {} as Record<MealType, Candidate[][]>;
  for (const meal of MEALS)
    pools[meal] = CONFIG.slots[meal].map((names) =>
      cands.filter(
        (c) =>
          fitsMeal(c, meal) &&
          c.category !== null &&
          names.includes(c.category),
      ),
    );
  return pools;
}

function pickDishes(cands: Candidate[], seed: number) {
  const pools = slotPools(cands);
  const used = new Set<string>();
  const result = {} as Record<MealType, Candidate[]>;
  for (const [m, meal] of MEALS.entries()) {
    result[meal] = [];
    for (const [i, pool] of pools[meal].entries()) {
      const offset = seed * (i + 3 + m * 7);
      for (let k = 0; k < pool.length; k++) {
        const c = pool[(offset + k) % pool.length];
        if (!used.has(c.dishId)) {
          used.add(c.dishId);
          result[meal].push(c);
          break;
        }
      }
    }
  }
  return result;
}

/** Gia vị chung của bữa: cộng dòng SEASONING của các món, quy về đơn vị mặc định nếu được. */
function mealSeasonings(dishes: Candidate[]) {
  const map = new Map<
    string,
    { qty: Prisma.Decimal; unit: string; target: string | null }
  >();
  for (const d of dishes)
    for (const l of d.lines.filter((x) => x.ingredientRole === "SEASONING")) {
      const cur = map.get(l.entry.id);
      if (!cur)
        map.set(l.entry.id, {
          qty: new Prisma.Decimal(l.requiredQuantity),
          unit: l.unit,
          target: l.entry.Ingredient.defaultUnit,
        });
      else
        cur.qty = cur.qty.add(
          convertQuantity(
            new Prisma.Decimal(l.requiredQuantity),
            l.unit,
            cur.unit,
          ),
        );
    }
  return [...map.entries()].map(([ingredientEntryId, v]) => {
    let qty = v.qty;
    let unit = v.unit;
    if (v.target) {
      try {
        const converted = convertQuantity(v.qty, v.unit, v.target);
        if (converted.decimalPlaces() <= 3) {
          qty = converted;
          unit = v.target;
        }
      } catch {
        /* giữ đơn vị gốc */
      }
    }
    return {
      ingredientEntryId,
      quantityPerPortion: qty.toDecimalPlaces(3),
      unit,
    };
  });
}

// ---------------------------------------------------------------------------
// INSERT
// ---------------------------------------------------------------------------
async function insertWeek(ctx: SchoolCtx, week: string) {
  const today = vnToday();
  log(`\n=== Tuần ${dmy(week)} ===`);
  const stats = { menus: 0, days: 0, dishes: 0, attendance: 0 };
  for (const g of CONFIG.grades) {
    const grade = ctx.grades.find((x) => x.name === g.gradeName);
    if (!grade) {
      log(`  [${g.gradeName}] BỎ QUA: không có khối này trong trường`);
      continue;
    }
    const menuId = seedId(ctx.school.id, week, grade.id);
    const existing = await prisma.weeklyMenuGrade.findUnique({
      where: {
        schoolId_weekStartDate_gradeId: {
          schoolId: ctx.school.id,
          weekStartDate: utcDate(week),
          gradeId: grade.id,
        },
      },
      select: { weeklyMenuId: true },
    });
    if (existing && existing.weeklyMenuId !== menuId) {
      log(
        `  [${grade.name}] BỎ QUA: khối đã có thực đơn thật trong tuần (không đụng vào)`,
      );
      continue;
    }
    const classes = await prisma.class.findMany({
      where: { schoolId: ctx.school.id, gradeId: grade.id, status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        registeredMealPortions: true,
        academicYear: true,
      },
      orderBy: { name: "asc" },
    });
    const homeroomIds = new Set(ctx.homeroom.map((h) => h.classId));
    const days: { day: string; academicYear: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const day = addDays(week, i);
      const st = dayStatus(ctx, day);
      if (day < today) {
        log(`  [${grade.name}] ${dmy(day)}: bỏ qua (đã qua)`);
        continue;
      }
      if (!st.ok) {
        log(`  [${grade.name}] ${dmy(day)}: bỏ qua (${st.reason})`);
        continue;
      }
      const conflict = await prisma.dailyMealPortion.count({
        where: {
          mealDate: utcDate(day),
          classId: { in: classes.map((c) => c.id) },
          OR: [
            { portionGroups: { some: {} } },
            { dailyAllergyPortions: { some: {} } },
          ],
        },
      });
      if (conflict) {
        log(
          `  [${grade.name}] ${dmy(day)}: bỏ qua (${conflict} điểm danh có sẵn đã gắn nhóm suất của thực đơn khác)`,
        );
        continue;
      }
      days.push({ day, academicYear: st.academicYear! });
    }
    if (!days.length) continue;

    const catalog = await loadCatalog(prisma, ctx, grade.id, days[0].day);
    let supplierId: string | undefined;
    if (g.freshSupplier) {
      supplierId = [...catalog.supplierNames].find(
        ([, n]) => n === g.freshSupplier,
      )?.[0];
      if (!supplierId)
        throw new Error(
          `Không có hợp đồng ACTIVE với NCC "${g.freshSupplier}"`,
        );
    } else {
      // NCC phủ được nhiều suất nhất (rồi nhiều món nhất); ưu tiên NCC khác khối trước.
      const taken = new Set(
        CONFIG.grades.map((x) => x.freshSupplier).filter(Boolean),
      );
      const ranked = catalog.freshSuppliers
        .map((id) => {
          const cands = catalog.candidateFor(id);
          const pools = slotPools(cands);
          const covered = MEALS.reduce(
            (n, meal) => n + pools[meal].filter((p) => p.length).length,
            0,
          );
          return { id, covered, n: cands.filter((c) => c.fresh).length };
        })
        .filter((x) => x.n > 0)
        .sort((a, b) => b.covered - a.covered || b.n - a.n);
      const best = ranked[0]?.covered ?? 0;
      ranked.splice(
        0,
        ranked.length,
        ...ranked.filter((r) => r.covered === best),
      );
      supplierId = (
        ranked.find((r) => !taken.has(catalog.supplierNames.get(r.id) ?? "")) ??
        ranked[0]
      )?.id;
      if (supplierId)
        g.freshSupplier = catalog.supplierNames.get(supplierId) ?? null;
    }
    if (!supplierId) {
      log(`  [${grade.name}] BỎ QUA: không có NCC nào đủ món hợp lệ`);
      continue;
    }
    const cands = catalog.candidateFor(supplierId);
    log(
      `  [${grade.name}] NCC đồ tươi: ${catalog.supplierNames.get(supplierId)} (${cands.length} món hợp lệ)`,
    );
    const pools = slotPools(cands);
    const empty = MEALS.flatMap((meal) =>
      CONFIG.slots[meal]
        .filter((_, i) => !pools[meal][i].length)
        .map((names) => `${meal}:${names[0]}`),
    );
    if (empty.length)
      log(
        `  [${grade.name}] Cảnh báo: không có món cho suất ${empty.join(", ")}`,
      );
    if (!MEALS.every((meal) => pools[meal].some((p) => p.length))) {
      log(`  [${grade.name}] BỎ QUA: NCC này không đủ món cho cả 2 bữa`);
      continue;
    }

    const weekOrdinal = Math.floor(utcDate(week).getTime() / (7 * 86400000));
    const plan = days.map(({ day, academicYear }) => {
      const dayIndex = (utcDate(day).getUTCDay() + 6) % 7;
      return {
        day,
        academicYear,
        menuDayId: seedId(menuId, day),
        meals: pickDishes(cands, weekOrdinal * 5 + dayIndex),
      };
    });
    for (const p of plan)
      for (const meal of MEALS)
        log(
          `    ${dmy(p.day)} ${meal === "LUNCH" ? "Trưa" : "Xế  "}: ${p.meals[meal].map((d) => d.name).join(" · ")}`,
        );

    const toAttend: Prisma.DailyMealPortionCreateManyInput[] = [];
    for (const p of plan) {
      const existingRows = await prisma.dailyMealPortion.findMany({
        where: {
          mealDate: utcDate(p.day),
          classId: { in: classes.map((c) => c.id) },
        },
        select: { classId: true, mealType: true },
      });
      for (const c of classes) {
        if (homeroomIds.has(c.id)) continue;
        if (c.academicYear && c.academicYear !== p.academicYear) continue;
        for (const meal of MEALS) {
          if (
            existingRows.some((r) => r.classId === c.id && r.mealType === meal)
          )
            continue;
          toAttend.push({
            id: seedId("attendance", c.id, p.day, meal),
            classId: c.id,
            confirmedByUserId: ctx.officer.id,
            mealDate: utcDate(p.day),
            mealType: meal,
            totalPortions: Math.floor(
              c.registeredMealPortions * CONFIG.attendanceRatio,
            ),
            status: "FINALIZED",
            finalizedAt: new Date(),
          });
        }
      }
    }
    const skipped = ctx.homeroom
      .filter((h) => classes.some((c) => c.id === h.classId))
      .map((h) => h.Class.name);
    log(
      `    Điểm danh mới: ${toAttend.length} bản ghi${skipped.length ? ` (chừa lớp GVCN: ${skipped.join(", ")})` : ""}`,
    );

    if (!APPLY) continue;
    await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        if (!existing) {
          await tx.weeklyMenu.create({
            data: {
              id: menuId,
              schoolId: ctx.school.id,
              createdByUserId: ctx.officer.id,
              weekStartDate: utcDate(week),
              isSchoolWide: false,
              title: `${CONFIG.titlePrefix} Tuần ${dmy(week)} – ${grade.name}`,
              status: "APPROVED",
              submittedAt: now,
              approvedAt: now,
            },
          });
          await tx.weeklyMenuGrade.create({
            data: {
              weeklyMenuId: menuId,
              schoolId: ctx.school.id,
              weekStartDate: utcDate(week),
              gradeId: grade.id,
            },
          });
          stats.menus++;
        }
        for (const p of plan) {
          if (
            await tx.menuDay.findUnique({
              where: { id: p.menuDayId },
              select: { id: true },
            })
          )
            continue;
          await tx.menuDay.create({
            data: {
              id: p.menuDayId,
              weeklyMenuId: menuId,
              menuDate: utcDate(p.day),
              approvalStatus: "APPROVED",
              note: "Dữ liệu seed tự động",
            },
          });
          for (const meal of MEALS) {
            for (const [order, d] of p.meals[meal].entries()) {
              await tx.menuDayDish.create({
                data: {
                  menuDayId: p.menuDayId,
                  dishId: d.dishId,
                  mealType: meal,
                  displayOrder: order + 1,
                },
              });
              const mains = new Map<string, Line>();
              d.lines
                .filter((l) => l.ingredientRole === "MAIN")
                .forEach((l) => mains.set(l.entry.ingredientId, l));
              await tx.menuDayDishIngredient.createMany({
                data: [...mains.values()].map((l) => ({
                  menuDayId: p.menuDayId,
                  dishId: d.dishId,
                  mealType: meal,
                  ingredientId: l.entry.ingredientId,
                  quantityPerPortion: l.requiredQuantity,
                  unit: l.unit,
                })),
              });
              stats.dishes++;
            }
            const seasonings = mealSeasonings(p.meals[meal]);
            if (seasonings.length)
              await tx.menuMealSeasoning.createMany({
                data: seasonings.map((s) => ({
                  menuDayId: p.menuDayId,
                  mealType: meal,
                  ...s,
                })),
              });
          }
          await tx.menuReviewRecord.create({
            data: {
              weeklyMenuId: menuId,
              menuDayId: p.menuDayId,
              reviewerUserId: ctx.board.id,
              decision: "APPROVED",
              feedback: "Duyệt tự động (seed)",
            },
          });
          stats.days++;
        }
        if (toAttend.length)
          stats.attendance += (
            await tx.dailyMealPortion.createMany({
              data: toAttend,
              skipDuplicates: true,
            })
          ).count;
      },
      { timeout: 300000, maxWait: 30000 },
    );
  }
  if (APPLY)
    log(
      `  => ĐÃ GHI: ${stats.menus} thực đơn tuần, ${stats.days} ngày, ${stats.dishes} món, ${stats.attendance} điểm danh`,
    );
}

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
class Refuse extends Error {}

async function deleteWeek(ctx: SchoolCtx, week: string) {
  const gradeFilter = option("--grade");
  const grades = ctx.grades.filter(
    (g) => !gradeFilter || g.name === gradeFilter,
  );
  const menuIds = grades.map((g) => seedId(ctx.school.id, week, g.id));
  log(
    `\n=== XOÁ seed tuần ${dmy(week)}${gradeFilter ? ` – ${gradeFilter}` : ""} ===`,
  );

  const run = async (tx: Tx) => {
    const menus = await tx.weeklyMenu.findMany({
      where: {
        id: { in: menuIds },
        schoolId: ctx.school.id,
        title: { startsWith: CONFIG.titlePrefix },
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        grades: { select: { gradeId: true } },
        menuDays: {
          select: {
            id: true,
            menuDate: true,
            menuDayDishes: {
              select: { ingredients: { select: { ingredientId: true } } },
            },
            mealSeasonings: { select: { ingredientEntryId: true } },
          },
        },
      },
    });
    if (!menus.length) {
      log("  Không có thực đơn seed nào trong tuần này.");
      return null;
    }
    const days = menus.flatMap((m) =>
      m.menuDays.map((d) => ({ ...d, menuCreatedAt: m.createdAt })),
    );
    const dayIds = days.map((d) => d.id);
    const dates = [...new Set(days.map((d) => iso(d.menuDate)))];
    const gradeIds = menus.flatMap((m) => m.grades.map((g) => g.gradeId));
    const classes = await tx.class.findMany({
      where: { schoolId: ctx.school.id, gradeId: { in: gradeIds } },
      select: { id: true },
    });

    // Điểm danh do seed tạo (id tất định)
    const candidateAttendance = classes.flatMap((c) =>
      dates.flatMap((d) => MEALS.map((m) => seedId("attendance", c.id, d, m))),
    );
    const seededAttendance = (
      await tx.dailyMealPortion.findMany({
        where: { id: { in: candidateAttendance } },
        select: { id: true },
      })
    ).map((r) => r.id);

    // Chế biến
    const batches = (
      await tx.cookingBatch.findMany({
        where: { menuDayId: { in: dayIds } },
        select: { id: true },
      })
    ).map((b) => b.id);
    const batchGroups = (
      await tx.cookingBatchGroup.findMany({
        where: { menuDayId: { in: dayIds } },
        select: { id: true },
      })
    ).map((b) => b.id);
    const seasoningLots = (
      await tx.menuMealSeasoningLot.findMany({
        where: { menuDayId: { in: dayIds } },
        select: { id: true },
      })
    ).map((s) => s.id);
    const samples = (
      await tx.retainedFoodSample.findMany({
        where: { cookingBatchId: { in: batches } },
        select: { id: true },
      })
    ).map((s) => s.id);

    // Phân bổ
    const allocations = (
      await tx.mealAllocation.findMany({
        where: {
          OR: [
            {
              mealAllocationBatches: {
                some: { cookingBatchId: { in: batches } },
              },
            },
            { dailyMealPortionId: { in: seededAttendance } },
          ],
        },
        select: { id: true },
      })
    ).map((a) => a.id);

    // Đơn đặt NL sinh từ thực đơn seed
    const ingredientIdsByDate = new Map<string, Set<string>>();
    const entryIdsByDate = new Map<string, Set<string>>();
    for (const d of days) {
      const k = iso(d.menuDate);
      const ing = ingredientIdsByDate.get(k) ?? new Set<string>();
      d.menuDayDishes.forEach((x) =>
        x.ingredients.forEach((i) => ing.add(i.ingredientId)),
      );
      ingredientIdsByDate.set(k, ing);
      const ent = entryIdsByDate.get(k) ?? new Set<string>();
      d.mealSeasonings.forEach((s) => ent.add(s.ingredientEntryId));
      entryIdsByDate.set(k, ent);
    }
    const firstCreated = new Date(
      Math.min(...menus.map((m) => m.createdAt.getTime())),
    );
    const requests = await tx.supplyRequest.findMany({
      where: {
        schoolId: ctx.school.id,
        requestedDeliveryDate: { in: dates.map(utcDate) },
        createdAt: { gte: firstCreated },
      },
      select: {
        id: true,
        requestNo: true,
        requestedDeliveryDate: true,
        supplyRequestItems: {
          select: {
            ingredientEntryId: true,
            IngredientEntry: { select: { ingredientId: true } },
          },
        },
      },
    });
    const ownedRequests: string[] = [];
    for (const r of requests) {
      const k = iso(r.requestedDeliveryDate!);
      const ok =
        r.supplyRequestItems.length > 0 &&
        r.supplyRequestItems.every(
          (i) =>
            ingredientIdsByDate.get(k)?.has(i.IngredientEntry.ingredientId) ||
            entryIdsByDate.get(k)?.has(i.ingredientEntryId),
        );
      if (ok) ownedRequests.push(r.id);
      else log(`  Giữ đơn ${r.requestNo}: có nguyên liệu ngoài thực đơn seed`);
    }
    const deliveries = (
      await tx.delivery.findMany({
        where: { supplyRequestId: { in: ownedRequests } },
        select: { id: true },
      })
    ).map((d) => d.id);
    const lots = (
      await tx.ingredientLot.findMany({
        where: { DeliveryItem: { deliveryId: { in: deliveries } } },
        select: { id: true },
      })
    ).map((l) => l.id);

    // ---- Kiểm tra chặn ----
    const refuse: string[] = [];
    if (
      await tx.foodSafetyIncidentAllocation.count({
        where: { mealAllocationId: { in: allocations } },
      })
    )
      refuse.push("phân bổ đã gắn sự cố ATTP");
    if (
      await tx.foodAnalysisResult.count({
        where: {
          OR: [
            { retainedFoodSampleId: { in: samples } },
            { ingredientLotId: { in: lots } },
          ],
        },
      })
    )
      refuse.push("mẫu/lô đã có kết quả kiểm nghiệm");
    if (
      await tx.mealComplaint.count({
        where: { dailyMealPortionId: { in: seededAttendance } },
      })
    )
      refuse.push("điểm danh seed đã có khiếu nại");
    if (
      await tx.cookingBatchLot.count({
        where: {
          ingredientLotId: { in: lots },
          cookingBatchId: { notIn: batches },
        },
      })
    )
      refuse.push("lô của đơn seed đã được mẻ nấu khác dùng");
    if (
      await tx.menuMealSeasoningLot.count({
        where: { ingredientLotId: { in: lots }, id: { notIn: seasoningLots } },
      })
    )
      refuse.push("lô của đơn seed đã được bữa khác giữ gia vị");
    const foreignUsage = await tx.inventoryTransaction.count({
      where: {
        ingredientLotId: { in: lots },
        movementType: { not: "RECEIPT" },
        NOT: [
          { referenceType: "COOKING_BATCH", referenceId: { in: batches } },
          {
            referenceType: "MENU_MEAL_SEASONING",
            referenceId: { in: seasoningLots },
          },
        ],
      },
    });
    if (foreignUsage)
      refuse.push(`${foreignUsage} phiếu kho khác đã dùng lô của đơn seed`);
    const distributionProofs = await tx.blockchainProof.findMany({
      where: {
        entityType: "MEAL_DISTRIBUTION",
        schoolId: ctx.school.id,
        subjectDate: { in: dates.map(utcDate) },
      },
      select: { id: true, snapshot: true },
    });
    for (const p of distributionProofs) {
      const snap = p.snapshot as {
        allocations?: { mealAllocationId?: string }[];
      } | null;
      const ids = (snap?.allocations ?? []).map((a) => a.mealAllocationId);
      if (ids.some((id) => !id || !allocations.includes(id)))
        refuse.push("bằng chứng phát suất của ngày có lớp ngoài seed");
    }
    if (refuse.length)
      throw new Refuse(`TỪ CHỐI XOÁ: ${[...new Set(refuse)].join("; ")}`);

    const proofs = (
      await tx.blockchainProof.findMany({
        where: {
          OR: [
            { cookingBatchId: { in: batches } },
            { retainedFoodSampleId: { in: samples } },
            { deliveryId: { in: deliveries } },
            { id: { in: distributionProofs.map((p) => p.id) } },
          ],
        },
        select: { id: true },
      })
    ).map((p) => p.id);
    const usage = await tx.inventoryTransaction.findMany({
      where: {
        movementType: "COOKING_USAGE",
        OR: [
          { referenceType: "COOKING_BATCH", referenceId: { in: batches } },
          {
            referenceType: "MENU_MEAL_SEASONING",
            referenceId: { in: seasoningLots },
          },
        ],
      },
      select: { id: true, ingredientLotId: true, quantity: true },
    });
    const restore = usage.filter((u) => !lots.includes(u.ingredientLotId));

    const summary = {
      "thực đơn tuần": menus.length,
      "ngày thực đơn": dayIds.length,
      "điểm danh seed": seededAttendance.length,
      "nhóm mẻ / mẻ nấu": `${batchGroups.length} / ${batches.length}`,
      "gia vị đã giữ": seasoningLots.length,
      "mẫu lưu": samples.length,
      "phân bổ suất": allocations.length,
      "đơn đặt NL": ownedRequests.length,
      "chuyến giao": deliveries.length,
      "lô NL": lots.length,
      "bằng chứng blockchain": proofs.length,
      "phiếu kho hoàn lại tồn (lô ngoài seed)": restore.length,
    };
    console.table(summary);
    if (!APPLY) return summary;

    // ---- Xoá theo thứ tự khoá ngoại ----
    for (const u of restore) {
      const lot = await tx.ingredientLot.findUniqueOrThrow({
        where: { id: u.ingredientLotId },
        select: { status: true },
      });
      await tx.ingredientLot.update({
        where: { id: u.ingredientLotId },
        data: {
          availableQuantity: { increment: u.quantity },
          ...(lot.status === "DEPLETED" ? { status: "AVAILABLE" } : {}),
        },
      });
    }
    await tx.inventoryTransaction.deleteMany({
      where: { id: { in: usage.map((u) => u.id) } },
    });
    await tx.blockchainProof.updateMany({
      where: { id: { in: proofs } },
      data: { previousProofId: null },
    });
    await tx.blockchainProof.deleteMany({ where: { id: { in: proofs } } });
    await tx.mealAllocation.deleteMany({ where: { id: { in: allocations } } });
    await tx.retainedFoodSample.deleteMany({ where: { id: { in: samples } } });
    await tx.menuMealSeasoningLot.deleteMany({
      where: { id: { in: seasoningLots } },
    });
    await tx.cookingBatch.deleteMany({ where: { id: { in: batches } } });
    await tx.cookingBatchGroup.deleteMany({
      where: { id: { in: batchGroups } },
    });
    await tx.ingredientQualityFeedback.deleteMany({
      where: {
        OR: [
          { deliveryId: { in: deliveries } },
          { ingredientLotId: { in: lots } },
        ],
      },
    });
    await tx.inventoryTransaction.deleteMany({
      where: { ingredientLotId: { in: lots } },
    });
    await tx.ingredientLot.deleteMany({ where: { id: { in: lots } } });
    await tx.delivery.deleteMany({ where: { id: { in: deliveries } } });
    await tx.supplyRequest.deleteMany({ where: { id: { in: ownedRequests } } });
    await tx.dailyMealPortionGroup.deleteMany({
      where: { portionGroup: { menuDayId: { in: dayIds } } },
    });
    await tx.dailyMealPortion.deleteMany({
      where: { id: { in: seededAttendance } },
    });
    await tx.weeklyMenu.deleteMany({
      where: { id: { in: menus.map((m) => m.id) } },
    });
    return summary;
  };

  try {
    await prisma.$transaction(run, { timeout: 300000, maxWait: 30000 });
    log(APPLY ? "  => ĐÃ XOÁ." : "  (xem trước – thêm --apply để xoá thật)");
  } catch (e) {
    if (e instanceof Refuse) {
      log(`  ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
async function main() {
  if (command !== "insert" && command !== "delete") {
    log(
      "Cách dùng: npm run seed:week -- <insert|delete> [--week YYYY-MM-DD] [--grade <tên khối>] [--apply] [--remote-ok]",
    );
    process.exitCode = 1;
    return;
  }
  assertWriteTarget();
  log(APPLY ? "Chế độ: GHI THẬT" : "Chế độ: XEM TRƯỚC (thêm --apply để ghi)");
  const ctx = await loadSchool(prisma);
  log(
    `Trường: ${ctx.school.name} (${CONFIG.schoolCode}) – hôm nay ${dmy(vnToday())}`,
  );
  const weekArg = option("--week");
  if (command === "delete") {
    if (!weekArg) throw new Error("delete cần --week YYYY-MM-DD");
    await deleteWeek(ctx, monday(weekArg));
    return;
  }
  const weeks = weekArg
    ? [monday(weekArg)]
    : [monday(vnToday()), addDays(monday(vnToday()), 7)];
  for (const w of weeks) await insertWeek(ctx, w);
  if (!APPLY) log("\n(xem trước – thêm --apply để ghi thật)");
}

main()
  .catch((e: unknown) => {
    console.error("LỖI:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
