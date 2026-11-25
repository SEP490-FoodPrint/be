import { Prisma } from "../../generated/prisma/client";
import { HttpError } from "../../utils/http-error";
import { convertQuantity } from "../../utils/quantity-conversion";
import { isScaledUnit } from "../../utils/dish-portion";

/**
 * Chia mẻ theo nguyên liệu (TASK-10 v8, V23–V30, V35–V36).
 *
 * - Mẻ không cần chia hết theo suất: dùng HẾT lượng lô của đợt, ghép các nhóm nguồn
 *   của các nguyên liệu trong món thành ít mẻ nhất (ghép nhóm bằng nhau trước, rồi quét song song).
 * - "Suất tương đương" = lượng ÷ định lượng 1 suất, chỉ dùng để so sánh, không làm tròn.
 * - Số suất của mẻ chia theo tỉ lệ suất tương đương, làm tròn 0,01 theo phần dư lớn nhất (V26).
 * - Nguyên liệu tồn kho (đồ khô) không tách mẻ: mỗi mẻ lấy đúng `suất × định lượng` từ lô FEFO.
 */

const Decimal = Prisma.Decimal;
type D = Prisma.Decimal;

/** Sai số so sánh suất tương đương. */
const EPS = new Decimal("0.0005");

export interface SupplyLot {
  id: string;
  ingredientEntryId: string;
  /** Lượng của lô dành cho lần lập này (đơn vị lô). */
  quantity: D;
  unit: string;
  sourceFacilityId: string | null;
}

export interface FreshLine {
  ingredientEntryId: string;
  ingredientName?: string;
  /** Định lượng sống 1 suất (đơn vị `unit`). */
  perPortion: D;
  unit: string;
  lots: readonly SupplyLot[];
}

export interface StockLine {
  ingredientEntryId: string;
  ingredientName?: string;
  perPortion: D;
  unit: string;
  /** Lô tồn kho theo FEFO với lượng còn trống (đơn vị lô). */
  lots: readonly SupplyLot[];
}

export interface PlannedLot {
  ingredientEntryId: string;
  ingredientLotId: string;
  /** Đơn vị lô, 3 chữ số thập phân. */
  quantity: D;
  unit: string;
}

export interface PlannedBatch {
  /** Suất tương đương của mẻ (theo nguyên liệu tươi). */
  equivalent: D;
  /** Số suất của mẻ, 2 chữ số thập phân. */
  plannedPortions: D;
  lots: PlannedLot[];
  /** Khóa nhóm nguồn theo nguyên liệu tươi. */
  groups: Map<string, string>;
}

export interface LotPlanResult {
  batches: PlannedBatch[];
  /** Phần lô tươi không ghép được (lệch tỉ lệ). */
  leftovers: PlannedLot[];
}

export interface LotPlanInput {
  portions: D;
  mode: "SEPARATE_BY_LOT" | "COMBINE_LOTS";
  fresh: readonly FreshLine[];
  stock: readonly StockLine[];
  /**
   * Lượng tối thiểu của từng nguyên liệu tươi trong một mẻ (đơn vị dòng), vd. phần mẫu cần cắt.
   * Mẻ nhỏ hơn được gộp vào mẻ có chung nhóm nguồn (V28, V36).
   */
  minimumPerBatch?: ReadonlyMap<string, D>;
  /** true: phần dư lệch tỉ lệ cộng vào mẻ cuối cùng nhóm nguồn thay vì trả về `leftovers`. */
  absorbLeftovers?: boolean;
}

export function groupKeyOf(lot: {
  id: string;
  sourceFacilityId: string | null;
}) {
  return lot.sourceFacilityId ? `src:${lot.sourceFacilityId}` : `lot:${lot.id}`;
}

function toThree(value: D) {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/** Đơn vị đếm (hộp, quả…) không chia lẻ: làm tròn tới số nguyên; g/kg/ml/l giữ 3 chữ số. */
function toUnitPrecision(value: D, unit: string) {
  return isScaledUnit(unit)
    ? toThree(value)
    : value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

interface Group {
  key: string;
  ingredientEntryId: string;
  /** Lượng còn lại theo lô (đơn vị lô). */
  slices: { lot: SupplyLot; remaining: D }[];
}

function groupEquivalent(group: Group, line: FreshLine) {
  return group.slices
    .reduce(
      (sum, slice) =>
        sum.add(convertQuantity(slice.remaining, slice.lot.unit, line.unit)),
      new Decimal(0),
    )
    .div(line.perPortion);
}

function buildGroups(line: FreshLine): Group[] {
  const groups = new Map<string, Group>();
  for (const lot of line.lots) {
    if (!lot.quantity.gt(0)) continue;
    const key = groupKeyOf(lot);
    const group = groups.get(key) ?? {
      key,
      ingredientEntryId: line.ingredientEntryId,
      slices: [],
    };
    group.slices.push({ lot, remaining: lot.quantity });
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Lấy `equivalent` suất từ nhóm; `all` = lấy hết phần còn lại (tránh bụi làm tròn). */
function takeFromGroup(
  group: Group,
  line: FreshLine,
  equivalent: D,
  all: boolean,
): PlannedLot[] {
  const taken: PlannedLot[] = [];
  let needed = equivalent.mul(line.perPortion);
  for (const slice of group.slices) {
    if (!slice.remaining.gt(0)) continue;
    if (!all && !needed.gt(0)) break;
    let amount: D;
    if (all) amount = slice.remaining;
    else {
      const available = convertQuantity(
        slice.remaining,
        slice.lot.unit,
        line.unit,
      );
      const part = Decimal.min(available, needed);
      amount = Decimal.min(
        toUnitPrecision(
          convertQuantity(part, line.unit, slice.lot.unit),
          slice.lot.unit,
        ),
        slice.remaining,
      );
      needed = needed.sub(part);
    }
    if (!amount.gt(0)) continue;
    slice.remaining = slice.remaining.sub(amount);
    taken.push({
      ingredientEntryId: line.ingredientEntryId,
      ingredientLotId: slice.lot.id,
      quantity: amount,
      unit: slice.lot.unit,
    });
  }
  return taken;
}

function addLots(target: PlannedLot[], extra: readonly PlannedLot[]) {
  for (const lot of extra) {
    const existing = target.find(
      (row) =>
        row.ingredientLotId === lot.ingredientLotId &&
        row.ingredientEntryId === lot.ingredientEntryId,
    );
    if (existing) existing.quantity = existing.quantity.add(lot.quantity);
    else target.push({ ...lot });
  }
}

/** Chia `total` theo trọng số, 2 chữ số thập phân, phần dư lớn nhất (V26). */
export function distributePortions(total: D, weights: readonly D[]): D[] {
  if (!weights.length) return [];
  const sum = weights.reduce((acc, weight) => acc.add(weight), new Decimal(0));
  const cents = total.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (!sum.gt(0)) {
    const result = weights.map(() => new Decimal(0));
    result[0] = cents.div(100);
    return result;
  }
  const raw = weights.map((weight) => cents.mul(weight).div(sum));
  const floors = raw.map((value) => value.floor());
  let rest = cents.sub(floors.reduce((acc, v) => acc.add(v), new Decimal(0)));
  const order = raw
    .map((value, index) => ({ index, fraction: value.sub(floors[index]) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);
  for (const { index } of order) {
    if (!rest.gt(0)) break;
    floors[index] = floors[index].add(1);
    rest = rest.sub(1);
  }
  return floors.map((value) => value.div(100));
}

function lineQuantity(batch: PlannedBatch, line: FreshLine) {
  return batch.lots
    .filter((lot) => lot.ingredientEntryId === line.ingredientEntryId)
    .reduce(
      (sum, lot) => sum.add(convertQuantity(lot.quantity, lot.unit, line.unit)),
      new Decimal(0),
    );
}

function sharedGroups(left: PlannedBatch, right: PlannedBatch) {
  let count = 0;
  for (const [entry, key] of left.groups)
    if (right.groups.get(entry) === key) count += 1;
  return count;
}

function mergeInto(target: PlannedBatch, source: PlannedBatch) {
  addLots(target.lots, source.lots);
  target.equivalent = target.equivalent.add(source.equivalent);
  for (const [entry, key] of source.groups)
    if (target.groups.get(entry) !== key)
      target.groups.set(entry, `${target.groups.get(entry) ?? ""}+${key}`);
}

/** Gộp mẻ nhỏ hơn mức tối thiểu vào mẻ chung nhóm nguồn (V28, V36). */
function mergeSmallBatches(
  batches: PlannedBatch[],
  fresh: readonly FreshLine[],
  minimum: ReadonlyMap<string, D>,
) {
  const tooSmall = (batch: PlannedBatch) =>
    fresh.some((line) => {
      const need = minimum.get(line.ingredientEntryId);
      return need !== undefined && lineQuantity(batch, line).lt(need);
    });
  for (;;) {
    if (batches.length <= 1) return;
    const index = batches.findIndex(tooSmall);
    if (index < 0) return;
    const [small] = batches.splice(index, 1);
    let best = 0;
    for (let i = 1; i < batches.length; i += 1) {
      const score =
        sharedGroups(small, batches[i]) - sharedGroups(small, batches[best]);
      if (
        score > 0 ||
        (score === 0 && batches[i].equivalent.gt(batches[best].equivalent))
      )
        best = i;
    }
    mergeInto(batches[best], small);
  }
}

function allocateStock(batches: PlannedBatch[], stock: readonly StockLine[]) {
  const free = new Map<string, D>();
  for (const line of stock) {
    for (const lot of line.lots)
      if (!free.has(lot.id)) free.set(lot.id, lot.quantity);
    for (const batch of batches) {
      let needed = batch.plannedPortions.mul(line.perPortion);
      for (const lot of line.lots) {
        if (!needed.gt(0)) break;
        const remaining = free.get(lot.id)!;
        if (!remaining.gt(0)) continue;
        const available = convertQuantity(remaining, lot.unit, line.unit);
        const part = Decimal.min(available, needed);
        const raw = convertQuantity(part, line.unit, lot.unit);
        const amount = Decimal.min(
          raw.toDecimalPlaces(isScaledUnit(lot.unit) ? 3 : 0, Decimal.ROUND_UP),
          remaining,
        );
        if (!amount.gt(0)) continue;
        free.set(lot.id, remaining.sub(amount));
        needed = needed.sub(part);
        addLots(batch.lots, [
          {
            ingredientEntryId: line.ingredientEntryId,
            ingredientLotId: lot.id,
            quantity: amount,
            unit: lot.unit,
          },
        ]);
      }
      if (needed.gt(new Decimal("0.0005")))
        throw new HttpError(
          409,
          `Không đủ nguyên liệu trong kho${line.ingredientName ? `: ${line.ingredientName}` : ""}`,
        );
    }
  }
}

export function planBatchesByLots(input: LotPlanInput): LotPlanResult {
  if (!input.portions.gte(0))
    throw new HttpError(409, "Số suất của món không hợp lệ");
  for (const line of [...input.fresh, ...input.stock])
    if (!line.perPortion.gt(0))
      throw new HttpError(409, "Định lượng nguyên liệu phải lớn hơn 0");
  const fresh = input.fresh.filter((line) =>
    line.lots.some((lot) => lot.quantity.gt(0)),
  );
  for (const line of input.fresh)
    if (!fresh.includes(line))
      throw new HttpError(
        409,
        `Chưa có lô của đợt cho nguyên liệu${line.ingredientName ? ` ${line.ingredientName}` : ""}`,
      );

  const batches: PlannedBatch[] = [];
  let leftovers: PlannedLot[] = [];

  if (!fresh.length) {
    batches.push({
      equivalent: input.portions,
      plannedPortions: input.portions,
      lots: [],
      groups: new Map(),
    });
  } else if (input.mode === "COMBINE_LOTS") {
    const lots: PlannedLot[] = [];
    let equivalent: D | null = null;
    for (const line of fresh) {
      const groups = buildGroups(line);
      const eq = groups.reduce(
        (sum, group) => sum.add(groupEquivalent(group, line)),
        new Decimal(0),
      );
      equivalent = equivalent === null ? eq : Decimal.min(equivalent, eq);
      for (const group of groups)
        lots.push(...takeFromGroup(group, line, eq, true));
    }
    batches.push({
      equivalent: equivalent ?? new Decimal(0),
      plannedPortions: input.portions,
      lots,
      groups: new Map(fresh.map((line) => [line.ingredientEntryId, "all"])),
    });
  } else {
    const groupsByLine = fresh.map((line) => ({
      line,
      groups: buildGroups(line),
    }));
    const live = (group: Group, line: FreshLine) =>
      groupEquivalent(group, line).gt(EPS);

    // 1) Ghép các nhóm nguồn có suất tương đương bằng nhau (V25).
    for (;;) {
      const [first, ...others] = groupsByLine;
      const candidates = first.groups
        .filter((group) => live(group, first.line))
        .map((group) => ({ group, eq: groupEquivalent(group, first.line) }))
        .sort((a, b) => b.eq.comparedTo(a.eq));
      let matched: { group: Group; line: FreshLine }[] | null = null;
      for (const candidate of candidates) {
        const picks: { group: Group; line: FreshLine }[] = [
          { group: candidate.group, line: first.line },
        ];
        for (const other of others) {
          const hit = other.groups.find(
            (group) =>
              live(group, other.line) &&
              groupEquivalent(group, other.line)
                .sub(candidate.eq)
                .abs()
                .lte(EPS),
          );
          if (!hit) break;
          picks.push({ group: hit, line: other.line });
        }
        if (picks.length === groupsByLine.length) {
          matched = picks;
          break;
        }
      }
      if (!matched || groupsByLine.length === 1) break;
      const equivalent = groupEquivalent(matched[0].group, matched[0].line);
      const lots: PlannedLot[] = [];
      const groups = new Map<string, string>();
      for (const { group, line } of matched) {
        lots.push(...takeFromGroup(group, line, equivalent, true));
        groups.set(line.ingredientEntryId, group.key);
      }
      batches.push({
        equivalent,
        plannedPortions: new Decimal(0),
        lots,
        groups,
      });
    }

    // 2) Quét song song phần còn lại, nhóm lớn trước.
    const queues = groupsByLine.map(({ line, groups }) => ({
      line,
      groups: groups
        .filter((group) => live(group, line))
        .sort((a, b) =>
          groupEquivalent(b, line).comparedTo(groupEquivalent(a, line)),
        ),
    }));
    for (;;) {
      for (const queue of queues)
        while (queue.groups.length && !live(queue.groups[0], queue.line))
          queue.groups.shift();
      if (queues.some((queue) => !queue.groups.length)) break;
      const step = Decimal.min(
        ...queues.map((queue) => groupEquivalent(queue.groups[0], queue.line)),
      );
      const lots: PlannedLot[] = [];
      const groups = new Map<string, string>();
      for (const queue of queues) {
        const group = queue.groups[0];
        const exhausts = groupEquivalent(group, queue.line).sub(step).lte(EPS);
        lots.push(...takeFromGroup(group, queue.line, step, exhausts));
        groups.set(queue.line.ingredientEntryId, group.key);
      }
      const last = batches.at(-1);
      // Hai bước liên tiếp cùng tổ hợp nhóm (do bụi làm tròn) thì cộng vào mẻ trước.
      if (
        last &&
        [...groups].every(([entry, key]) => last.groups.get(entry) === key)
      ) {
        addLots(last.lots, lots);
        last.equivalent = last.equivalent.add(step);
      } else
        batches.push({
          equivalent: step,
          plannedPortions: new Decimal(0),
          lots,
          groups,
        });
    }

    // 3) Phần dư do lệch tỉ lệ.
    for (const queue of queues)
      for (const group of queue.groups)
        if (groupEquivalent(group, queue.line).gt(0))
          leftovers.push(
            ...takeFromGroup(group, queue.line, new Decimal(0), true),
          );
    if (input.absorbLeftovers && leftovers.length && batches.length) {
      for (const lot of leftovers) {
        const line = fresh.find(
          (row) => row.ingredientEntryId === lot.ingredientEntryId,
        )!;
        const key = groupKeyOf({
          id: lot.ingredientLotId,
          sourceFacilityId:
            line.lots.find((row) => row.id === lot.ingredientLotId)
              ?.sourceFacilityId ?? null,
        });
        const target =
          [...batches]
            .reverse()
            .find((batch) => batch.groups.get(lot.ingredientEntryId) === key) ??
          batches.at(-1)!;
        addLots(target.lots, [lot]);
      }
      leftovers = [];
    }
    if (!batches.length)
      throw new HttpError(
        409,
        "Không ghép được nguyên liệu của món thành mẻ nấu",
      );
    if (input.minimumPerBatch?.size)
      mergeSmallBatches(batches, fresh, input.minimumPerBatch);
  }

  const portions = distributePortions(
    input.portions,
    batches.map((batch) => batch.equivalent),
  );
  batches.forEach((batch, index) => {
    batch.plannedPortions = portions[index];
  });
  allocateStock(batches, input.stock);
  return { batches, leftovers };
}

/**
 * Chia lượng của một lô cho nhiều người dùng (món × bữa) theo tỉ lệ nhu cầu (V27).
 * Người cuối nhận phần còn lại để tổng khớp đúng lượng lô.
 */
export function splitLotByDemand(
  quantity: D,
  demands: readonly D[],
  unit = "kg",
): D[] {
  const total = demands.reduce((sum, value) => sum.add(value), new Decimal(0));
  if (!demands.length) return [];
  if (!total.gt(0)) {
    const even = demands.map(() => new Decimal(0));
    even[0] = quantity;
    return even;
  }
  let rest = quantity;
  return demands.map((demand, index) => {
    if (index === demands.length - 1) return rest;
    const share = Decimal.min(
      toUnitPrecision(quantity.mul(demand).div(total), unit),
      rest,
    );
    rest = rest.sub(share);
    return share;
  });
}
