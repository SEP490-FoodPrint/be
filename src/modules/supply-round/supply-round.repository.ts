import { addPortion } from "../../utils/portions";
import { Prisma } from "../../generated/prisma/client";
import { convertQuantity } from "../../utils/quantity-conversion";
import { HttpError } from "../../utils/http-error";
import { kitchenDetailSelect } from "../kitchen/kitchen.repository";

type Tx = Prisma.TransactionClient;
export type RoundKey = {
  schoolId: string;
  deliveryDate: Date;
  batchNo: number;
};
export type RoundMeal = { menuDayId: string; mealType: "LUNCH" | "AFTERNOON" };

const activeRequest = { notIn: ["DRAFT", "CANCELLED"] } as const;
const lotSelect = {
  id: true,
  lotCode: true,
  DeliveryItem: {
    select: {
      ingredientEntryId: true,
      ingredientNameSnapshot: true,
      sourceFacilityNameSnapshot: true,
      IngredientEntry: { select: { Ingredient: { select: { name: true } } } },
      Delivery: {
        select: { id: true, Supplier: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.IngredientLotSelect;

export const supplyRoundRepository = {
  readyBatches(tx: Tx, roundIds: string[]) {
    return tx.cookingBatch.findMany({
      where: {
        BatchGroup: { supplyRoundId: { in: roundIds } },
        status: { notIn: ["CANCELLED", "COMPLETED", "CONFIRMED"] },
      },
      select: kitchenDetailSelect,
      orderBy: { id: "asc" },
    });
  },
  parts(tx: Tx, batchIds: string[]) {
    return tx.cookingBatchRoundPart.findMany({
      where: {
        cookingBatchId: { in: batchIds },
        status: { in: ["PENDING_APPROVAL", "APPROVED"] },
      },
      include: { lots: true },
      orderBy: { id: "asc" },
    });
  },
  async mergePart(
    tx: Tx,
    part: Awaited<
      ReturnType<typeof tx.cookingBatchRoundPart.findMany>
    >[number] & {
      lots: {
        ingredientLotId: string;
        quantityUsed: Prisma.Decimal;
        sampleQuantity: Prisma.Decimal;
        unit: string;
      }[];
    },
    at: Date,
  ) {
    const dish = { cookingBatchId: part.cookingBatchId, dishId: part.dishId };
    // Nấu chung: phần mẫu đặt ở Đợt 2 đi theo dòng lô của phần gộp (TASK-10 v8, V14).
    await tx.cookingBatchDish.update({
      where: { cookingBatchId_dishId: dish },
      data: { plannedPortions: { increment: part.plannedPortions } },
    });
    await tx.cookingBatch.update({
      where: { id: part.cookingBatchId },
      data: { plannedPortions: { increment: part.plannedPortions } },
    });
    for (const lot of part.lots) {
      const { ingredientLotId, quantityUsed, unit } = lot;
      const sampleQuantity = lot.sampleQuantity ?? new Prisma.Decimal(0);
      const key = { ...dish, ingredientLotId };
      const where = { cookingBatchId_dishId_ingredientLotId: key };
      const existing = await tx.cookingBatchLot.findUnique({
        where,
        select: { unit: true },
      });
      const increment = existing
        ? convertQuantity(quantityUsed, unit, existing.unit)
        : quantityUsed;
      const sampleIncrement = existing
        ? convertQuantity(sampleQuantity, unit, existing.unit)
        : sampleQuantity;
      if (increment.decimalPlaces() > 3 || sampleIncrement.decimalPlaces() > 3)
        throw new HttpError(409, "Lượng Đợt 2 quá lẻ. Kiểm tra lại.");
      await tx.cookingBatchLot.upsert({
        where,
        create: { ...key, quantityUsed, sampleQuantity, unit },
        update: {
          quantityUsed: { increment },
          sampleQuantity: { increment: sampleIncrement },
        },
      });
    }
    await tx.cookingBatchRoundPart.update({
      where: { id: part.id },
      data: { status: "MERGED", mergedAt: at },
    });
  },
  confirmBatches(tx: Tx, ids: string[], at: Date) {
    return tx.cookingBatch.updateMany({
      where: {
        id: { in: ids },
        status: { in: ["ROUND1_APPROVED", "ROUND2_APPROVED"] },
      },
      data: { status: "CONFIRMED", confirmedAt: at },
    });
  },
  declaration(tx: Tx, id: string) {
    return tx.delivery.findFirst({
      where: {
        id,
        creationMode: "REQUEST",
        preparationStage: { not: null },
        status: { notIn: ["REJECTED", "CANCELLED"] },
      },
      select: {
        createdByUserId: true,
        SupplyRequest: {
          select: {
            schoolId: true,
            batchNo: true,
            orderType: true,
            requestedDeliveryDate: true,
          },
        },
      },
    });
  },
  lock(tx: Tx, key: RoundKey) {
    const lockKey = `${key.schoolId}:${key.deliveryDate.toISOString().slice(0, 10)}:${key.batchNo}`;
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  },
  beginDish(tx: Tx) {
    return tx.$executeRaw`SAVEPOINT supply_round_dish`;
  },
  rollbackDish(tx: Tx) {
    return tx.$executeRaw`ROLLBACK TO SAVEPOINT supply_round_dish`;
  },
  releaseDish(tx: Tx) {
    return tx.$executeRaw`RELEASE SAVEPOINT supply_round_dish`;
  },
  async lockMenus(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw`SELECT id FROM foodprint.menu_days WHERE id::text IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  },
  findByKey(tx: Tx, { schoolId, deliveryDate, batchNo }: RoundKey) {
    return tx.supplyRound.findUnique({
      where: {
        schoolId_deliveryDate_batchNo: { schoolId, deliveryDate, batchNo },
      },
    });
  },
  findById(tx: Tx, schoolId: string, id: string) {
    return tx.supplyRound.findFirst({ where: { id, schoolId } });
  },
  create(tx: Tx, key: RoundKey) {
    return tx.supplyRound.create({ data: key });
  },
  requests(tx: Tx, { schoolId, deliveryDate, batchNo }: RoundKey) {
    return tx.supplyRequest.findMany({
      where: {
        schoolId,
        batchNo,
        requestedDeliveryDate: deliveryDate,
        orderType: "DIRECT_USE",
        status: { notIn: [...activeRequest.notIn] },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        status: true,
        supplierId: true,
        Supplier: { select: { name: true } },
        supplyRequestItems: {
          select: {
            ingredientEntryId: true,
            IngredientEntry: { select: { handlingType: true } },
          },
        },
        deliveries: {
          where: {
            creationMode: "REQUEST",
            status: { notIn: ["REJECTED", "CANCELLED"] },
          },
          select: {
            id: true,
            status: true,
            preparationStage: true,
            createdByUserId: true,
          },
        },
      },
    });
  },
  occurrences(tx: Tx, { schoolId, deliveryDate }: RoundKey) {
    return tx.menuDayDish.findMany({
      where: {
        mealType: { in: ["LUNCH", "AFTERNOON"] },
        MenuDay: {
          menuDate: deliveryDate,
          approvalStatus: "APPROVED",
          WeeklyMenu: { schoolId },
        },
        Dish: { schoolId, status: "ACTIVE" },
      },
      orderBy: [
        { displayOrder: "asc" },
        { dishId: "asc" },
        { mealType: "asc" },
        { menuDayId: "asc" },
      ],
      select: {
        dishId: true,
        menuDayId: true,
        mealType: true,
        Dish: {
          select: {
            name: true,
            standardQuantity: true,
            standardUnit: true,
            dishIngredientEntries: {
              orderBy: { ingredientEntryId: "asc" },
              select: {
                ingredientEntryId: true,
                ingredientRole: true,
                requiredQuantity: true,
                unit: true,
                IngredientEntry: {
                  select: {
                    schoolId: true,
                    wasteRate: true,
                    Ingredient: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  },
  gradePortions(tx: Tx, { schoolId, deliveryDate }: RoundKey) {
    return tx.supplyBatch1GradePortion.findMany({
      where: { schoolId, deliveryDate },
      select: { gradeId: true, portions: true },
    });
  },
  async ensurePlans(tx: Tx, supplyRoundId: string, dishIds: string[]) {
    if (dishIds.length)
      await tx.supplyRoundDishPlan.createMany({
        data: dishIds.map((dishId) => ({ supplyRoundId, dishId })),
        skipDuplicates: true,
      });
  },
  plans(tx: Tx, supplyRoundId: string) {
    return tx.supplyRoundDishPlan.findMany({
      where: { supplyRoundId },
      select: {
        dishId: true,
        status: true,
        planVersion: true,
        failureMessage: true,
        dish: { select: { name: true } },
      },
    });
  },
  updatePlan(
    tx: Tx,
    supplyRoundId: string,
    dishId: string,
    data: Pick<
      Prisma.SupplyRoundDishPlanUncheckedUpdateInput,
      | "status"
      | "planVersion"
      | "failureMessage"
      | "approvedByUserId"
      | "approvedAt"
    >,
  ) {
    return tx.supplyRoundDishPlan.update({
      where: { supplyRoundId_dishId: { supplyRoundId, dishId } },
      data,
    });
  },
  approveBatches(
    tx: Tx,
    supplyRoundId: string,
    dishId: string,
    targetStatus: "ROUND1_APPROVED" | "ROUND2_APPROVED" = "ROUND1_APPROVED",
  ) {
    return tx.cookingBatch.updateMany({
      where: {
        BatchGroup: { supplyRoundId },
        dishId,
        status: "PENDING_APPROVAL",
      },
      data: { status: targetStatus },
    });
  },
  approveParts(
    tx: Tx,
    supplyRoundId: string,
    dishId: string,
    approvedByUserId: string,
  ) {
    return tx.cookingBatchRoundPart.updateMany({
      where: {
        supplyRoundId,
        dishId,
        status: "PENDING_APPROVAL",
      },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByUserId,
      },
    });
  },
  markNotNeeded(tx: Tx, key: RoundKey, at: Date) {
    return tx.supplyRound.upsert({
      where: { schoolId_deliveryDate_batchNo: key },
      create: { ...key, status: "NOT_NEEDED", notNeededAt: at },
      update: { status: "NOT_NEEDED", notNeededAt: at },
    });
  },
  async actualGradePortions(tx: Tx, schoolId: string, deliveryDate: Date) {
    const classes = await tx.class.findMany({
      where: { schoolId, status: "ACTIVE", registeredMealPortions: { gt: 0 } },
      select: {
        gradeId: true,
        dailyMealPortions: {
          where: {
            mealDate: deliveryDate,
            mealType: "LUNCH",
            status: "FINALIZED",
          },
          select: { totalPortions: true },
        },
      },
    });
    const byGrade = new Map<string, number>();
    for (const c of classes) {
      if (!c.gradeId) continue;
      byGrade.set(
        c.gradeId,
        (byGrade.get(c.gradeId) ?? 0) +
          c.dailyMealPortions.reduce((sum, row) => sum + row.totalPortions, 0),
      );
    }
    return byGrade;
  },
  round1BatchesForMealDish(tx: Tx, meal: RoundMeal, dishId: string) {
    return tx.cookingBatch.findMany({
      where: {
        ...meal,
        dishId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
        BatchGroup: { SupplyRound: { batchNo: 1 } },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        dishId: true,
        status: true,
        cookingBatchLots: {
          select: {
            ingredientLotId: true,
            IngredientLot: {
              select: {
                sourceFacilityId: true,
                DeliveryItem: { select: { ingredientEntryId: true } },
              },
            },
          },
        },
      },
    });
  },
  async createRoundPart(
    tx: Tx,
    input: {
      supplyRoundId: string;
      cookingBatchId: string;
      dishId: string;
      plannedPortions: number | string | Prisma.Decimal;
    },
    lots: {
      ingredientLotId: string;
      quantityUsed: string;
      sampleQuantity?: string;
      unit: string;
    }[],
    approvedByUserId: string | null = null,
  ) {
    const part = await tx.cookingBatchRoundPart.create({
      data: {
        ...input,
        ...(approvedByUserId
          ? { status: "APPROVED", approvedByUserId, approvedAt: new Date() }
          : { status: "PENDING_APPROVAL" }),
      },
      select: { id: true },
    });
    if (lots.length) {
      await tx.cookingBatchRoundPartLot.createMany({
        data: lots.map((lot) => ({ ...lot, roundPartId: part.id })),
      });
    }
    return part;
  },
  updateRoundStatus(
    tx: Tx,
    id: string,
    status: "COLLECTING" | "IN_REVIEW" | "READY",
  ) {
    return tx.supplyRound.update({ where: { id }, data: { status } });
  },
  setStage(
    tx: Tx,
    id: string,
    preparationStage:
      "PENDING_WAREHOUSE" | "TOP_UP_PENDING" | "READY_TO_DISPATCH",
  ) {
    return tx.delivery.updateMany({
      where: {
        id,
        status: "PREPARING",
        preparationStage: { in: ["LOTS_DECLARED", "PENDING_WAREHOUSE"] },
      },
      data: { preparationStage },
    });
  },
  batchSamples(tx: Tx, supplyRoundId: string) {
    return tx.cookingBatchLot.findMany({
      where: {
        sampleQuantity: { gt: 0 },
        CookingBatch: {
          BatchGroup: { supplyRoundId },
          status: { not: "CANCELLED" },
        },
      },
      orderBy: [{ ingredientLotId: "asc" }, { cookingBatchId: "asc" }],
      select: {
        sampleQuantity: true,
        unit: true,
        IngredientLot: { select: lotSelect },
        CookingBatch: {
          select: {
            batchCode: true,
            mealType: true,
            dishes: {
              select: {
                dishId: true,
                sampleQuantity: true,
                sampleUnit: true,
                Dish: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  },
  seasoningLots(tx: Tx, meal: RoundMeal) {
    return tx.menuMealSeasoningLot.findMany({
      where: { ...meal, usedAt: null },
      orderBy: { id: "asc" },
    });
  },
  seasoningSamples(tx: Tx, occurrences: RoundMeal[]) {
    return tx.menuMealSeasoningLot.findMany({
      where: { OR: occurrences, sampleQuantity: { gt: 0 } },
      select: {
        sampleQuantity: true,
        unit: true,
        mealType: true,
        ingredientLot: { select: lotSelect },
      },
    });
  },
  addSeasoningSample(tx: Tx, id: string, quantity: Prisma.Decimal) {
    return tx.menuMealSeasoningLot.update({
      where: { id },
      data: { sampleQuantity: { increment: quantity } },
    });
  },
  async survivingPortionsForMealDish(
    tx: Tx,
    supplyRoundId: string,
    meal: RoundMeal,
    dishId: string,
  ) {
    const [batches, parts] = await Promise.all([
      tx.cookingBatch.findMany({
        where: {
          ...meal,
          dishId,
          status: { not: "CANCELLED" },
          BatchGroup: { supplyRoundId },
        },
        select: { plannedPortions: true },
      }),
      tx.cookingBatchRoundPart.findMany({
        where: {
          supplyRoundId,
          dishId,
          cookingBatchDish: {
            CookingBatch: { ...meal, status: { not: "CANCELLED" } },
          },
        },
        select: { plannedPortions: true },
      }),
    ]);
    return [...batches, ...parts].reduce(
      (sum, row) => addPortion(sum, row.plannedPortions),
      0,
    );
  },
  async hasReplanRequiredRound2(tx: Tx, schoolId: string, deliveryDate: Date) {
    const round2 = await tx.supplyRound.findUnique({
      where: {
        schoolId_deliveryDate_batchNo: { schoolId, deliveryDate, batchNo: 2 },
      },
      select: {
        status: true,
        dishPlans: {
          where: { status: "REPLAN_REQUIRED" },
          select: { dishId: true },
          take: 1,
        },
      },
    });
    return Boolean(
      round2 &&
      round2.status !== "NOT_NEEDED" &&
      round2.status !== "CLOSED" &&
      round2.dishPlans.length > 0,
    );
  },
  async cleanupRejectedDelivery(
    tx: Tx,
    deliveryId: string,
    cancelWaitingBatches: boolean,
  ) {
    if (!tx.cookingBatchRoundPart?.findMany || !tx.cookingBatch?.findMany)
      return;
    const directParts = await tx.cookingBatchRoundPart.findMany({
      where: {
        status: { not: "MERGED" },
        lots: {
          some: { ingredientLot: { DeliveryItem: { deliveryId } } },
        },
      },
      select: { id: true, supplyRoundId: true, dishId: true },
    });
    const directBatches = await tx.cookingBatch.findMany({
      where: {
        status: {
          in: ["PENDING_APPROVAL", "ROUND1_APPROVED", "ROUND2_APPROVED"],
        },
        cookingBatchLots: {
          some: { IngredientLot: { DeliveryItem: { deliveryId } } },
        },
      },
      select: {
        id: true,
        dishId: true,
        batchCode: true,
        batchGroupId: true,
        BatchGroup: { select: { supplyRoundId: true } },
      },
    });
    const batchIds = directBatches.map((b) => b.id);
    const attachedParts = batchIds.length
      ? await tx.cookingBatchRoundPart.findMany({
          where: {
            cookingBatchId: { in: batchIds },
            status: { not: "MERGED" },
          },
          select: { id: true, supplyRoundId: true, dishId: true },
        })
      : [];
    const allParts = [...directParts, ...attachedParts];
    const partIds = [...new Set(allParts.map((p) => p.id))];

    if (partIds.length) {
      await tx.cookingBatchRoundPart.deleteMany({
        where: { id: { in: partIds } },
      });
    }

    if (cancelWaitingBatches) {
      if (batchIds.length) {
        await tx.cookingBatch.updateMany({
          where: { id: { in: batchIds } },
          data: { status: "CANCELLED" },
        });
      }
      return;
    }

    if (batchIds.length) {
      const deletedCbSeq = directBatches
        .map((b) => /^FP-CB-(\d+)$/.exec(b.batchCode ?? ""))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .reduce((max, m) => Math.max(max, Number(m[1])), 0);
      if (deletedCbSeq > 0 && tx.$executeRaw) {
        await tx.$executeRaw`INSERT INTO foodprint.business_code_counters (code_type, last_sequence)
          VALUES ('CB', ${deletedCbSeq})
          ON CONFLICT (code_type) DO UPDATE
          SET last_sequence = GREATEST(foodprint.business_code_counters.last_sequence, EXCLUDED.last_sequence)`;
      }
      await tx.cookingBatchLot.deleteMany({
        where: { cookingBatchId: { in: batchIds } },
      });
      await tx.cookingBatchDish.deleteMany({
        where: { cookingBatchId: { in: batchIds } },
      });
      await tx.cookingBatch.deleteMany({
        where: { id: { in: batchIds } },
      });
      const groupIds = [
        ...new Set(
          directBatches
            .map((b) => b.batchGroupId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (groupIds.length) {
        await tx.cookingBatchGroup.deleteMany({
          where: { id: { in: groupIds }, cookingBatches: { none: {} } },
        });
      }
    }

    const affectedPlans = new Map<
      string,
      { supplyRoundId: string; dishId: string }
    >();
    for (const p of allParts) {
      affectedPlans.set(`${p.supplyRoundId}:${p.dishId}`, {
        supplyRoundId: p.supplyRoundId,
        dishId: p.dishId,
      });
    }
    for (const b of directBatches) {
      const roundId = b.BatchGroup?.supplyRoundId;
      if (roundId && b.dishId) {
        affectedPlans.set(`${roundId}:${b.dishId}`, {
          supplyRoundId: roundId,
          dishId: b.dishId,
        });
      }
    }
    for (const { supplyRoundId, dishId } of affectedPlans.values()) {
      await tx.supplyRoundDishPlan.updateMany({
        where: { supplyRoundId, dishId },
        data: {
          status: "REPLAN_REQUIRED",
          planVersion: null,
          failureMessage: null,
        },
      });
    }
  },
};

export const roundSampleRepository = {
  /** Lô của các chuyến thuộc đợt (đồ tươi theo đợt), kể cả lô đã khai báo chưa nhận (Đợt 2 nấu riêng). */
  async roundLots(tx: Tx, key: RoundKey, entryIds: string[]) {
    if (!entryIds.length) return [];
    const rows = await tx.ingredientLot.findMany({
      where: {
        OR: [
          { status: "AVAILABLE", availableQuantity: { gt: 0 } },
          { status: "BLOCKED", receivedQuantity: { gt: 0 } },
        ],
        DeliveryItem: {
          OR: [
            { ingredientEntryId: { in: entryIds } },
            { SupplyRequestItem: { ingredientEntryId: { in: entryIds } } },
          ],
          Delivery: {
            schoolId: key.schoolId,
            creationMode: "REQUEST",
            status: { notIn: ["REJECTED", "CANCELLED"] },
            SupplyRequest: {
              orderType: "DIRECT_USE",
              requestedDeliveryDate: key.deliveryDate,
              batchNo: key.batchNo,
              status: { notIn: ["DRAFT", "CANCELLED"] },
            },
          },
        },
      },
      orderBy: [
        { expiryDate: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        unit: true,
        status: true,
        availableQuantity: true,
        receivedQuantity: true,
        sourceFacilityId: true,
        DeliveryItem: {
          select: {
            ingredientEntryId: true,
            sourceFacilityId: true,
            SupplyRequestItem: { select: { ingredientEntryId: true } },
            Delivery: { select: { status: true } },
          },
        },
      },
    });
    return rows.flatMap((row) => {
      const ingredientEntryId =
        row.DeliveryItem.ingredientEntryId ??
        row.DeliveryItem.SupplyRequestItem?.ingredientEntryId;
      if (!ingredientEntryId) return [];
      const incoming = row.status === "BLOCKED";
      // Lô bị khóa của chuyến đã nhận là lô từ chối/khóa kho: bỏ qua.
      if (incoming && row.DeliveryItem.Delivery.status === "RECEIVED")
        return [];
      return [
        {
          id: row.id,
          ingredientEntryId,
          unit: row.unit,
          incoming,
          quantity: incoming ? row.receivedQuantity : row.availableQuantity,
          sourceFacilityId:
            row.sourceFacilityId ?? row.DeliveryItem.sourceFacilityId ?? null,
        },
      ];
    });
  },
  activeLeftovers(tx: Tx, round1Id: string, meal: RoundMeal, dishId: string) {
    return tx.supplyRoundLeftover.findMany({
      where: { supplyRoundId: round1Id, ...meal, dishId, releasedAt: null },
      orderBy: { id: "asc" },
      select: {
        id: true,
        ingredientLotId: true,
        quantity: true,
        unit: true,
        ingredientLot: {
          select: {
            sourceFacilityId: true,
            DeliveryItem: {
              select: {
                ingredientEntryId: true,
                sourceFacilityId: true,
                SupplyRequestItem: { select: { ingredientEntryId: true } },
              },
            },
          },
        },
      },
    });
  },
  /**
   * Lượng nguyên liệu tươi mỗi người dùng (bữa × món) đã thực nhận ở Đợt 1, theo đơn vị lô:
   * lô của mẻ Đợt 1 (đã trừ mẫu cắt) trừ phần Đợt 2 đã gộp vào, cộng phần dư Đợt 1 (V35).
   * Dùng để chia phần bù của lô Đợt 2 đúng theo phần còn thiếu của từng người dùng.
   */
  async round1Supply(tx: Tx, round1Id: string) {
    const lotSelect = {
      DeliveryItem: {
        select: {
          ingredientEntryId: true,
          SupplyRequestItem: { select: { ingredientEntryId: true } },
        },
      },
    } as const;
    const entryOf = (lot: {
      DeliveryItem: {
        ingredientEntryId: string | null;
        SupplyRequestItem: { ingredientEntryId: string } | null;
      };
    }) =>
      lot.DeliveryItem.ingredientEntryId ??
      lot.DeliveryItem.SupplyRequestItem?.ingredientEntryId ??
      null;
    const lots = await tx.cookingBatchLot.findMany({
      where: {
        CookingBatch: {
          BatchGroup: { supplyRoundId: round1Id },
          status: { not: "CANCELLED" },
        },
      },
      select: {
        cookingBatchId: true,
        dishId: true,
        ingredientLotId: true,
        quantityUsed: true,
        unit: true,
        CookingBatch: { select: { menuDayId: true, mealType: true } },
        IngredientLot: { select: lotSelect },
      },
    });
    const merged = lots.length
      ? await tx.cookingBatchRoundPartLot.findMany({
          where: {
            roundPart: {
              status: "MERGED",
              cookingBatchId: {
                in: [...new Set(lots.map((lot) => lot.cookingBatchId))],
              },
            },
          },
          select: {
            ingredientLotId: true,
            quantityUsed: true,
            roundPart: { select: { cookingBatchId: true, dishId: true } },
          },
        })
      : [];
    const leftovers = await tx.supplyRoundLeftover.findMany({
      where: { supplyRoundId: round1Id },
      select: {
        menuDayId: true,
        mealType: true,
        dishId: true,
        quantity: true,
        unit: true,
        ingredientLot: { select: lotSelect },
      },
    });
    const rows: {
      menuDayId: string;
      mealType: string;
      dishId: string;
      ingredientEntryId: string;
      quantity: Prisma.Decimal;
      unit: string;
    }[] = [];
    for (const lot of lots) {
      const ingredientEntryId = entryOf(lot.IngredientLot);
      if (!ingredientEntryId) continue;
      const fromRound2 = merged
        .filter(
          (part) =>
            part.roundPart.cookingBatchId === lot.cookingBatchId &&
            part.roundPart.dishId === lot.dishId &&
            part.ingredientLotId === lot.ingredientLotId,
        )
        .reduce(
          (sum, part) => sum.add(part.quantityUsed),
          new Prisma.Decimal(0),
        );
      rows.push({
        menuDayId: lot.CookingBatch.menuDayId,
        mealType: lot.CookingBatch.mealType,
        dishId: lot.dishId,
        ingredientEntryId,
        quantity: Prisma.Decimal.max(0, lot.quantityUsed.sub(fromRound2)),
        unit: lot.unit,
      });
    }
    for (const row of leftovers) {
      const ingredientEntryId = entryOf(row.ingredientLot);
      if (ingredientEntryId)
        rows.push({
          menuDayId: row.menuDayId,
          mealType: row.mealType,
          dishId: row.dishId,
          ingredientEntryId,
          quantity: row.quantity,
          unit: row.unit,
        });
    }
    return rows;
  },
  createLeftovers(
    tx: Tx,
    rows: {
      supplyRoundId: string;
      menuDayId: string;
      mealType: "LUNCH" | "AFTERNOON";
      dishId: string;
      ingredientLotId: string;
      quantity: Prisma.Decimal;
      unit: string;
    }[],
  ) {
    return rows.length
      ? tx.supplyRoundLeftover.createMany({ data: rows })
      : Promise.resolve({ count: 0 });
  },
  releaseLeftovers(tx: Tx, ids: string[], at: Date) {
    return ids.length
      ? tx.supplyRoundLeftover.updateMany({
          where: { id: { in: ids }, releasedAt: null },
          data: { releasedAt: at },
        })
      : Promise.resolve({ count: 0 });
  },
  releaseRoundLeftovers(tx: Tx, round1Id: string, at: Date) {
    return tx.supplyRoundLeftover.updateMany({
      where: { supplyRoundId: round1Id, releasedAt: null },
      data: { releasedAt: at },
    });
  },
  /** Phần dư Đợt 1 (dùng khi Đợt 2 không cần: hiển thị thừa, V37). */
  leftoversOfRound(tx: Tx, round1Id: string) {
    return tx.supplyRoundLeftover.findMany({
      where: { supplyRoundId: round1Id },
      orderBy: { id: "asc" },
      select: {
        quantity: true,
        unit: true,
        mealType: true,
        releasedAt: true,
        dish: { select: { name: true } },
        ingredientLot: {
          select: {
            lotCode: true,
            DeliveryItem: {
              select: {
                ingredientNameSnapshot: true,
                sourceFacilityNameSnapshot: true,
              },
            },
          },
        },
      },
    });
  },
  async replaceCompensations(
    tx: Tx,
    supplyRoundId: string,
    rows: {
      ingredientEntryId: string;
      kind: "FRESH" | "STOCK";
      sampleQuantity: Prisma.Decimal;
      unit: string;
    }[],
  ) {
    await tx.supplyRoundCompensation.deleteMany({ where: { supplyRoundId } });
    const data = rows.filter((row) => row.sampleQuantity.gt(0));
    if (data.length)
      await tx.supplyRoundCompensation.createMany({
        data: data.map((row) => ({ ...row, supplyRoundId })),
      });
  },
  compensations(tx: Tx, supplyRoundId: string) {
    return tx.supplyRoundCompensation.findMany({
      where: { supplyRoundId },
      select: {
        ingredientEntryId: true,
        kind: true,
        sampleQuantity: true,
        unit: true,
      },
    });
  },
  /** Mẻ Đợt 1 đã cắt mẫu: dòng lô có phần mẫu, kèm loại xử lý của nguyên liệu. */
  cutSampleRows(tx: Tx, supplyRoundId: string) {
    return tx.cookingBatchLot.findMany({
      where: {
        sampleQuantity: { gt: 0 },
        CookingBatch: {
          BatchGroup: { supplyRoundId },
          sampleStrategy: "CUT",
          status: { notIn: ["CANCELLED", "COMPLETED"] },
        },
      },
      select: {
        cookingBatchId: true,
        dishId: true,
        ingredientLotId: true,
        sampleQuantity: true,
        unit: true,
        IngredientLot: {
          select: {
            DeliveryItem: {
              select: {
                ingredientEntryId: true,
                SupplyRequestItem: { select: { ingredientEntryId: true } },
              },
            },
          },
        },
      },
    });
  },
  entryKinds(tx: Tx, ids: string[]) {
    return tx.ingredientEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, handlingType: true },
    });
  },
  /** Còn lớp đăng ký suất ăn chưa chốt điểm danh bữa trưa của ngày. */
  attendancePending(tx: Tx, schoolId: string, deliveryDate: Date) {
    return tx.class.count({
      where: {
        schoolId,
        status: "ACTIVE",
        registeredMealPortions: { gt: 0 },
        NOT: {
          dailyMealPortions: {
            some: {
              mealDate: deliveryDate,
              mealType: "LUNCH",
              status: "FINALIZED",
            },
          },
        },
      },
    });
  },
  cookingMode(tx: Tx, schoolId: string) {
    return tx.school
      .findUnique({ where: { id: schoolId }, select: { cookingMode: true } })
      .then((row) => row?.cookingMode ?? null);
  },
  /** Đợt 2 nấu riêng lập lại một món: xóa phần/mẻ Đợt 2 còn lại của món và trả phần dư Đợt 1 (V35). */
  async resetRound2Dish(
    tx: Tx,
    round2Id: string,
    round1Id: string | null,
    dishId: string,
  ) {
    await tx.cookingBatchRoundPart.deleteMany({
      where: { supplyRoundId: round2Id, dishId, status: { not: "MERGED" } },
    });
    const batches = await tx.cookingBatch.findMany({
      where: {
        dishId,
        BatchGroup: { supplyRoundId: round2Id },
        status: { in: ["PENDING_APPROVAL", "ROUND2_APPROVED"] },
      },
      select: { id: true, batchGroupId: true },
    });
    const ids = batches.map(({ id }) => id);
    if (ids.length) {
      await tx.cookingBatchLot.deleteMany({
        where: { cookingBatchId: { in: ids } },
      });
      await tx.cookingBatchDish.deleteMany({
        where: { cookingBatchId: { in: ids } },
      });
      await tx.cookingBatch.deleteMany({ where: { id: { in: ids } } });
      const groups = [
        ...new Set(
          batches
            .map(({ batchGroupId }) => batchGroupId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (groups.length)
        await tx.cookingBatchGroup.deleteMany({
          where: { id: { in: groups }, cookingBatches: { none: {} } },
        });
    }
    if (round1Id)
      await tx.supplyRoundLeftover.updateMany({
        where: { supplyRoundId: round1Id, dishId, releasedAt: { not: null } },
        data: { releasedAt: null },
      });
  },
  markRoundBatchesStatus(
    tx: Tx,
    supplyRoundId: string,
    dishId: string,
    from: "PENDING_APPROVAL",
    to: "ROUND1_APPROVED" | "ROUND2_APPROVED",
  ) {
    return tx.cookingBatch.updateMany({
      where: { BatchGroup: { supplyRoundId }, dishId, status: from },
      data: { status: to },
    });
  },
};

type Repository = typeof supplyRoundRepository;
export type RoundOccurrence = Awaited<
  ReturnType<Repository["occurrences"]>
>[number];
export type RoundRequest = Awaited<ReturnType<Repository["requests"]>>[number];
