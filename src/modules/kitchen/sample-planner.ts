/**
 * supply-round-sample-planning — các hàm tính toán thuần cho phần lưu mẫu và lập mẻ theo đợt giao.
 * Không truy vấn DB; service ghép dữ liệu rồi gọi các hàm này. Xem specs/supply-round-sample-planning/spec.md.
 */
import { Prisma } from "../../generated/prisma/client";
import { isScaledUnit } from "../../utils/dish-portion";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../../utils/quantity-conversion";
import { grossFromNet } from "../../utils/waste-rate";

const Decimal = Prisma.Decimal;
type DecimalValue = Prisma.Decimal;
type DecimalInput = Prisma.Decimal | string | number;

/** D8, D24: mặc định khi trường chưa lưu cấu hình; cũng là mức tối thiểu theo QĐ 1246/QĐ-BYT. */
export const DEFAULT_SAMPLE_POLICY = {
  sampleGrams: "100",
  sampleMilliliters: "150",
} as const;

export type SampleUnit = "g" | "ml";

export interface SamplePolicyValues {
  sampleGrams: DecimalInput;
  sampleMilliliters: DecimalInput;
}

/** Làm tròn LÊN 3 chữ số thập phân (D12): tồn lô lưu numeric(14,3). */
export function ceilToThree(value: DecimalInput): DecimalValue {
  return new Decimal(value).toDecimalPlaces(3, Decimal.ROUND_UP);
}

function positiveDecimal(value: DecimalInput, message: string): DecimalValue {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || !decimal.gt(0)) throw new HttpError(409, message);
  return decimal;
}

function normalizeUnit(unit: string): string {
  return unit.normalize("NFC").trim().toLowerCase();
}

/** Lượng mẫu M theo đơn vị mốc chuẩn của món (D8). Không quy đổi g ↔ ml. */
export function sampleAmountFor(
  standardUnit: string,
  policy: SamplePolicyValues | null,
): { amount: DecimalValue; unit: SampleUnit } {
  const unit = normalizeUnit(standardUnit);
  const values = policy ?? DEFAULT_SAMPLE_POLICY;
  if (unit === "g")
    return {
      amount: positiveDecimal(
        values.sampleGrams,
        "Lượng mẫu (g) phải lớn hơn 0",
      ),
      unit,
    };
  if (unit === "ml")
    return {
      amount: positiveDecimal(
        values.sampleMilliliters,
        "Lượng mẫu (ml) phải lớn hơn 0",
      ),
      unit,
    };
  throw new HttpError(
    409,
    `Đơn vị mốc chuẩn của món phải là g hoặc ml (nhận “${standardUnit}”)`,
  );
}

/** Cảnh báo (không chặn) khi cấu hình thấp hơn mức tối thiểu của QĐ 1246 (D8). */
export function samplePolicyWarnings(policy: SamplePolicyValues): string[] {
  const warnings: string[] = [];
  if (new Decimal(policy.sampleGrams).lt(DEFAULT_SAMPLE_POLICY.sampleGrams))
    warnings.push(
      `Thấp hơn mức tối thiểu ${DEFAULT_SAMPLE_POLICY.sampleGrams} g theo QĐ 1246/QĐ-BYT`,
    );
  if (
    new Decimal(policy.sampleMilliliters).lt(
      DEFAULT_SAMPLE_POLICY.sampleMilliliters,
    )
  )
    warnings.push(
      `Thấp hơn mức tối thiểu ${DEFAULT_SAMPLE_POLICY.sampleMilliliters} ml theo QĐ 1246/QĐ-BYT`,
    );
  return warnings;
}

export interface SampleRatio {
  /** r₀ = M / S. */
  baseRatio: DecimalValue;
  /** r sau khi làm tròn đơn vị đếm (≥ r₀), 9 chữ số thập phân làm tròn lên. */
  ratio: DecimalValue;
  /** M* = làm tròn lên 3 chữ số của r × S, đơn vị = đơn vị mốc chuẩn. */
  sampleQuantity: DecimalValue;
  /** Có dòng đơn vị đếm làm r tăng so với r₀. */
  roundedUp: boolean;
}

/**
 * Tỉ lệ mẫu của món (spec 7.3, D9, D10). Dòng đơn vị đếm (không phải g/mg/kg/ml/l) làm tròn lên số nguyên;
 * khi phải làm tròn, cả món dùng tỉ lệ mới nên dòng g/ml và M* tăng tỉ lệ thuận.
 */
export function sampleRatio(
  standardQuantity: DecimalInput,
  sampleAmount: DecimalInput,
  lines: readonly { requiredQuantity: DecimalInput; unit: string }[],
): SampleRatio {
  const standard = positiveDecimal(
    standardQuantity,
    "Mốc chuẩn của món phải lớn hơn 0",
  );
  const amount = positiveDecimal(sampleAmount, "Lượng mẫu phải lớn hơn 0");
  const baseRatio = amount.div(standard);
  let ratio = baseRatio;
  for (const line of lines) {
    if (isScaledUnit(line.unit)) continue;
    const required = new Decimal(line.requiredQuantity);
    if (!required.gt(0)) continue;
    const whole = required.mul(baseRatio).ceil();
    const candidate = whole.div(required);
    if (candidate.gt(ratio)) ratio = candidate;
  }
  const stored = ratio.toDecimalPlaces(9, Decimal.ROUND_UP);
  return {
    baseRatio,
    ratio: stored,
    sampleQuantity: ceilToThree(stored.mul(standard)),
    roundedUp: ratio.gt(baseRatio),
  };
}

export interface SampleRecipeLine {
  ingredientEntryId: string;
  ingredientName?: string;
  /** "MAIN" | "SEASONING" — chỉ nguyên liệu chính áp hao hụt (D11, N2). */
  ingredientRole: string | null;
  /** Lượng thành phẩm trong mốc chuẩn của món. */
  requiredQuantity: DecimalInput;
  unit: string;
  wasteRate: DecimalInput | null;
}

export interface SampleLine {
  ingredientEntryId: string;
  ingredientName?: string;
  /** Lượng thành phẩm cho mẫu. */
  net: DecimalValue;
  /** Lượng sống cho mẫu (chưa đổi sang đơn vị lô, chưa làm tròn 3 chữ số). */
  gross: DecimalValue;
  unit: string;
}

/** Lượng thành phẩm và lượng sống của từng dòng công thức cho mẫu của một mẻ (spec 7.3). */
export function sampleLines(
  lines: readonly SampleRecipeLine[],
  ratio: DecimalInput,
): SampleLine[] {
  const r = positiveDecimal(ratio, "Tỉ lệ mẫu phải lớn hơn 0");
  return lines.map((line) => {
    const required = new Decimal(line.requiredQuantity);
    const net = isScaledUnit(line.unit)
      ? required.mul(r)
      : required.mul(r).ceil();
    const gross =
      line.ingredientRole === "SEASONING"
        ? net
        : grossFromNet(net, line.wasteRate);
    return {
      ingredientEntryId: line.ingredientEntryId,
      ingredientName: line.ingredientName,
      net,
      gross,
      unit: line.unit,
    };
  });
}

/** need(b, i): lượng sống đổi sang đơn vị lô, làm tròn lên 3 chữ số (D12). */
export function sampleNeedInLotUnit(
  gross: DecimalValue,
  lineUnit: string,
  lotUnit: string,
): DecimalValue {
  return ceilToThree(convertQuantity(gross, lineUnit, lotUnit));
}

export type SampleCookingMode = "SEPARATE_BY_LOT" | "COMBINE_LOTS";

export interface SampleStockLot {
  id: string;
  ingredientEntryId: string;
  unit: string;
  /** Lượng còn trống sau mọi phần đang giữ (kể cả pha A của lần lập này). Chỉ dùng cho lô đã AVAILABLE. */
  free: DecimalInput;
  /** Lô khai báo của đợt hiện tại, chưa nhận hàng: phần mẫu thành phần NCC lấy thêm. */
  incoming: boolean;
  sourceFacilityId: string | null;
}

export interface SampleBatchInput {
  /** Định danh mẻ trong lần lập (chưa có mã FP-CB-). */
  batchKey: string;
  /** Nhãn hiển thị trong thông báo lỗi. */
  label: string;
  dishId: string;
  lines: readonly SampleLine[];
  /** Lô mẻ đã dùng ở pha A, theo thứ tự hạn dùng. */
  usedLots: readonly { ingredientEntryId: string; ingredientLotId: string }[];
}

export interface SampleAllocation {
  batchKey: string;
  dishId: string;
  ingredientEntryId: string;
  ingredientLotId: string;
  sampleQuantity: DecimalValue;
  unit: string;
  /** true: NCC lấy thêm; false: giữ từ tồn kho. */
  topUp: boolean;
}

export interface SampleAssignment {
  allocations: SampleAllocation[];
  /** Phần NCC phải lấy thêm theo lô (đơn vị lô). */
  topUps: Map<string, DecimalValue>;
  /** Phần mẫu giữ từ tồn kho theo lô (đơn vị lô). */
  fromStock: Map<string, DecimalValue>;
}

/**
 * Pha B (spec 7.3): mỗi cặp (mẻ, nguyên liệu) gán đúng một lô theo thứ tự ưu tiên
 * 1) lô incoming mẻ đã dùng; 2) lô AVAILABLE mẻ đã dùng còn đủ chỗ; 3) SEPARATE_BY_LOT: lô incoming cùng nhóm nguồn;
 * 4) COMBINE_LOTS: lô incoming bất kỳ cùng nguyên liệu; 5) lỗi 409.
 * Gia vị dùng chung của bữa không đi qua hàm này (xem `seasoningSampleNeeds`).
 */
export function assignSampleLots(
  batches: readonly SampleBatchInput[],
  stock: readonly SampleStockLot[],
  mode: SampleCookingMode,
): SampleAssignment {
  const byId = new Map(stock.map((lot) => [lot.id, lot]));
  const free = new Map(stock.map((lot) => [lot.id, new Decimal(lot.free)]));
  const topUps = new Map<string, DecimalValue>();
  const fromStock = new Map<string, DecimalValue>();
  const allocations: SampleAllocation[] = [];
  const add = (map: Map<string, DecimalValue>, id: string, q: DecimalValue) =>
    map.set(id, (map.get(id) ?? new Decimal(0)).add(q));

  for (const batch of batches) {
    for (const line of batch.lines) {
      if (!line.gross.gt(0)) continue;
      const used = batch.usedLots
        .filter((row) => row.ingredientEntryId === line.ingredientEntryId)
        .map((row) => byId.get(row.ingredientLotId))
        .filter((lot): lot is SampleStockLot => lot !== undefined);
      const need = (lot: SampleStockLot) =>
        sampleNeedInLotUnit(line.gross, line.unit, lot.unit);
      const pick = (lot: SampleStockLot, topUp: boolean) => {
        const quantity = need(lot);
        if (topUp) add(topUps, lot.id, quantity);
        else {
          free.set(lot.id, free.get(lot.id)!.sub(quantity));
          add(fromStock, lot.id, quantity);
        }
        allocations.push({
          batchKey: batch.batchKey,
          dishId: batch.dishId,
          ingredientEntryId: line.ingredientEntryId,
          ingredientLotId: lot.id,
          sampleQuantity: quantity,
          unit: lot.unit,
          topUp,
        });
      };

      const incomingUsed = used.find((lot) => lot.incoming);
      if (incomingUsed) {
        pick(incomingUsed, true);
        continue;
      }
      const availableUsed = used.find(
        (lot) => !lot.incoming && free.get(lot.id)!.gte(need(lot)),
      );
      if (availableUsed) {
        pick(availableUsed, false);
        continue;
      }
      const sources = new Set(
        used
          .map((lot) => lot.sourceFacilityId)
          .filter((id): id is string => id !== null),
      );
      const fallback = stock.find(
        (lot) =>
          lot.incoming &&
          lot.ingredientEntryId === line.ingredientEntryId &&
          (mode === "COMBINE_LOTS" ||
            (lot.sourceFacilityId !== null &&
              sources.has(lot.sourceFacilityId))),
      );
      if (fallback) {
        pick(fallback, true);
        continue;
      }
      throw new HttpError(
        409,
        `Không đủ nguyên liệu lưu mẫu cho mẻ ${batch.label}: ${line.ingredientName ?? line.ingredientEntryId}`,
      );
    }
  }
  return { allocations, topUps, fromStock };
}

/**
 * Phần mẫu của gia vị dùng chung trong bữa (D13): Σ need(b, j) trên mọi mẻ có món chứa j,
 * mỗi need làm tròn lên 3 chữ số theo đơn vị lô gia vị.
 */
export function seasoningSampleNeeds(
  batches: readonly { lines: readonly SampleLine[] }[],
  sharedSeasoningIds: ReadonlySet<string>,
  lotUnitOf: (ingredientEntryId: string) => string,
): Map<string, DecimalValue> {
  const totals = new Map<string, DecimalValue>();
  for (const batch of batches)
    for (const line of batch.lines) {
      if (!sharedSeasoningIds.has(line.ingredientEntryId) || !line.gross.gt(0))
        continue;
      const quantity = sampleNeedInLotUnit(
        line.gross,
        line.unit,
        lotUnitOf(line.ingredientEntryId),
      );
      totals.set(
        line.ingredientEntryId,
        (totals.get(line.ingredientEntryId) ?? new Decimal(0)).add(quantity),
      );
    }
  return totals;
}

/**
 * Khóa nguồn của một kế hoạch mẻ (D5): món + với mỗi nguyên liệu, tập cơ sở nguồn (hoặc id lô khi lô không có cơ sở nguồn).
 * Ở COMBINE_LOTS mỗi món chỉ có một mẻ mỗi bữa nên caller có thể dùng khóa = dishId.
 */
export function sourceKey(
  dishId: string,
  lots: readonly { ingredientEntryId: string; ingredientLotId: string }[],
  sourceOf: (ingredientLotId: string) => string | null,
): string {
  const groups = new Map<string, Set<string>>();
  for (const lot of lots) {
    const set = groups.get(lot.ingredientEntryId) ?? new Set<string>();
    const source = sourceOf(lot.ingredientLotId);
    set.add(source === null ? `lot:${lot.ingredientLotId}` : `src:${source}`);
    groups.set(lot.ingredientEntryId, set);
  }
  const parts = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entry, set]) => `${entry}=${[...set].sort().join("+")}`);
  return `${dishId}|${parts.join(";")}`;
}

export interface Round2Plan<L> {
  dishId: string;
  key: string;
  plannedPortions: number;
  lots: readonly L[];
}

export interface Round1Batch {
  cookingBatchId: string;
  dishId: string;
  key: string;
  status: string;
}

export interface Round2Split<L> {
  /** Phần Đợt 2 gộp vào mẻ Đợt 1 (không có phần mẫu). Nhiều kế hoạch cùng khóa được cộng dồn. */
  parts: {
    cookingBatchId: string;
    dishId: string;
    plannedPortions: number;
    lots: L[];
  }[];
  /** Kế hoạch không trùng mẻ Đợt 1: thành mẻ mới (chạy pha B). */
  newBatches: Round2Plan<L>[];
}

const NOT_MERGEABLE = new Set(["COMPLETED", "CANCELLED"]);

/** Tách kế hoạch Đợt 2 thành phần gộp vào mẻ Đợt 1 hoặc mẻ mới (spec 8.2, D4, D15). */
export function splitRound2<L>(
  plans: readonly Round2Plan<L>[],
  round1: readonly Round1Batch[],
): Round2Split<L> {
  const targets = new Map<string, Round1Batch>();
  for (const batch of round1)
    if (!NOT_MERGEABLE.has(batch.status) && !targets.has(batch.key))
      targets.set(batch.key, batch);
  const parts = new Map<
    string,
    {
      cookingBatchId: string;
      dishId: string;
      plannedPortions: number;
      lots: L[];
    }
  >();
  const newBatches: Round2Plan<L>[] = [];
  for (const plan of plans) {
    const target = targets.get(plan.key);
    if (!target || target.dishId !== plan.dishId) {
      newBatches.push(plan);
      continue;
    }
    const part = parts.get(target.cookingBatchId) ?? {
      cookingBatchId: target.cookingBatchId,
      dishId: target.dishId,
      plannedPortions: 0,
      lots: [],
    };
    part.plannedPortions += plan.plannedPortions;
    part.lots.push(...plan.lots);
    parts.set(target.cookingBatchId, part);
  }
  return { parts: [...parts.values()], newBatches };
}

export interface Batch2GradeInput {
  gradeId: string;
  gradeName: string;
  batch1Portions: number;
  actualPortions: number;
}

export interface Batch2IngredientInput {
  ingredientEntryId: string;
  name: string;
  unit: string;
  /** Lượng cần cho sĩ số thực tế của cả trường, không cộng phần lẻ (đơn vị đặt hàng). */
  needed: DecimalInput;
  /** Σ lượng đã đặt ở Đợt 1 còn hiệu lực, không tính phần lưu mẫu. */
  ordered: DecimalInput;
}

export interface Batch2Decision {
  notNeeded: boolean;
  /** Có khối mà sĩ số thực tế vượt mốc Đợt 1. */
  gradeShortage: boolean;
  surplusByGrade: { gradeId: string; gradeName: string; surplus: number }[];
  shortages: {
    ingredientEntryId: string;
    name: string;
    unit: string;
    missing: DecimalValue;
  }[];
}

/**
 * Đợt 2 có thể bỏ qua không (D30, N22): mọi khối thừa hoặc vừa đủ suất VÀ mọi nguyên liệu Đợt 1 đã đặt
 * (đã làm tròn xuống) đủ cho sĩ số thực tế của cả trường. Khi đó phần lẻ chuyển từ Đợt 1 bị bỏ qua.
 */
export function batch2Decision(
  grades: readonly Batch2GradeInput[],
  ingredients: readonly Batch2IngredientInput[],
): Batch2Decision {
  const gradeShortage = grades.some(
    (grade) => grade.actualPortions > grade.batch1Portions,
  );
  const surplusByGrade = grades.map((grade) => ({
    gradeId: grade.gradeId,
    gradeName: grade.gradeName,
    surplus: Math.max(0, grade.batch1Portions - grade.actualPortions),
  }));
  const shortages = ingredients
    .map((row) => ({
      ingredientEntryId: row.ingredientEntryId,
      name: row.name,
      unit: row.unit,
      missing: new Decimal(row.needed).sub(new Decimal(row.ordered)),
    }))
    .filter((row) => row.missing.gt(0));
  return {
    notNeeded: grades.length > 0 && !gradeShortage && shortages.length === 0,
    gradeShortage,
    surplusByGrade,
    shortages,
  };
}
