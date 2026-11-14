import { id } from "ethers";
import { getPrisma } from "../../utils/database";
import { anchorHashOnChain } from "../../utils/blockchain";
import {
  computeCanonicalHash,
  canonicalizeJson,
} from "../../utils/canonical-hash";
import type {
  AnchorManualInput,
  ListAnchorsQueryInput,
} from "./blockchain-distribution.validation";

export async function anchorDistribution(
  allocationIds: string[],
  schoolId: string,
  dateStr: string,
  actorId?: string,
) {
  const prisma = await getPrisma();

  // 1. Fetch meal allocations and their batch distributions
  const allocations = await prisma.mealAllocation.findMany({
    where: {
      id: { in: allocationIds },
    },
    include: {
      mealAllocationBatches: {
        orderBy: [{ cookingBatchId: "asc" }, { dishId: "asc" }],
      },
      DailyMealPortion: {
        select: {
          id: true,
          mealType: true,
          totalPortions: true,
          Class: {
            select: { id: true, name: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  if (!allocations.length) {
    throw new Error(
      "Không tìm thấy bản ghi phân bổ nào để ghi nhận Blockchain.",
    );
  }

  // 2. Build canonical snapshot
  const snapshot = {
    distributionDate: dateStr,
    schoolId,
    totalAllocations: allocations.length,
    allocations: allocations.map((alloc) => ({
      allocationId: alloc.id,
      className: alloc.DailyMealPortion.Class.name,
      dailyMealPortionId: alloc.dailyMealPortionId,
      distributedAt: alloc.distributedAt
        ? alloc.distributedAt.toISOString()
        : null,
      mealType: alloc.DailyMealPortion.mealType,
      status: alloc.status,
      totalPortions: alloc.DailyMealPortion.totalPortions,
      batches: alloc.mealAllocationBatches.map((b) => ({
        allocatedPortions: b.allocatedPortions,
        cookingBatchId: b.cookingBatchId,
        dishId: b.dishId,
      })),
    })),
  };

  const payloadHash = computeCanonicalHash(snapshot);
  const recordId = id(`foodprint:meal-allocation:${schoolId}:${dateStr}`);

  // 3. Perform on-chain anchoring
  const anchorResult = await anchorHashOnChain(recordId, payloadHash);

  // 4. Record evidence in PostgreSQL traceability_anchors for each allocation
  const createdAnchors = [];
  for (const alloc of allocations) {
    // Check if an anchor already exists for this allocation
    const existing = await prisma.traceabilityAnchor.findFirst({
      where: { mealAllocationId: alloc.id },
    });

    if (existing) {
      const updated = await prisma.traceabilityAnchor.update({
        where: { id: existing.id },
        data: {
          payloadHash,
          hashAlgorithm: "Keccak-256",
          networkName: anchorResult.networkName,
          contractAddress: anchorResult.contractAddress,
          transactionHash: anchorResult.txHash,
          blockNumber: BigInt(anchorResult.blockNumber),
          anchorStatus: "CONFIRMED",
          verificationResult: canonicalizeJson(snapshot),
          updatedAt: new Date(),
        },
      });
      createdAnchors.push(updated);
    } else {
      const created = await prisma.traceabilityAnchor.create({
        data: {
          mealAllocationId: alloc.id,
          payloadHash,
          hashAlgorithm: "Keccak-256",
          networkName: anchorResult.networkName,
          contractAddress: anchorResult.contractAddress,
          transactionHash: anchorResult.txHash,
          blockNumber: BigInt(anchorResult.blockNumber),
          anchorStatus: "CONFIRMED",
          verificationResult: canonicalizeJson(snapshot),
          createdByUserId: actorId || null,
        },
      });
      createdAnchors.push(created);
    }
  }

  return {
    recordId,
    payloadHash,
    txHash: anchorResult.txHash,
    blockNumber: anchorResult.blockNumber,
    networkName: anchorResult.networkName,
    contractAddress: anchorResult.contractAddress,
    anchoredAllocationsCount: allocations.length,
    snapshot,
  };
}

export async function getDistributionAnchors(query: ListAnchorsQueryInput) {
  const prisma = await getPrisma();
  const skip = (query.page - 1) * query.limit;

  const whereClause: {
    mealAllocationId: { not: null };
    MealAllocation?: {
      DailyMealPortion?: {
        Class?: { schoolId: string };
        mealDate?: Date;
      };
    };
  } = {
    mealAllocationId: { not: null },
  };

  if (query.schoolId || query.date) {
    whereClause.MealAllocation = {
      DailyMealPortion: {
        ...(query.schoolId ? { Class: { schoolId: query.schoolId } } : {}),
        ...(query.date ? { mealDate: new Date(query.date) } : {}),
      },
    };
  }

  const [items, total] = await Promise.all([
    prisma.traceabilityAnchor.findMany({
      where: whereClause,
      include: {
        MealAllocation: {
          include: {
            DailyMealPortion: {
              include: {
                Class: { select: { id: true, name: true, schoolId: true } },
              },
            },
            mealAllocationBatches: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: query.limit,
    }),
    prisma.traceabilityAnchor.count({ where: whereClause }),
  ]);

  return {
    items: items.map((item) => ({
      id: item.id,
      mealAllocationId: item.mealAllocationId,
      payloadHash: item.payloadHash,
      hashAlgorithm: item.hashAlgorithm,
      networkName: item.networkName,
      contractAddress: item.contractAddress,
      transactionHash: item.transactionHash,
      blockNumber: item.blockNumber ? item.blockNumber.toString() : null,
      anchorStatus: item.anchorStatus,
      createdAt: item.createdAt.toISOString(),
      snapshot: item.verificationResult
        ? (JSON.parse(item.verificationResult) as Record<string, unknown>)
        : null,
      allocation: item.MealAllocation
        ? {
            id: item.MealAllocation.id,
            status: item.MealAllocation.status,
            allocatedAt: item.MealAllocation.allocatedAt,
            distributedAt: item.MealAllocation.distributedAt,
            className: item.MealAllocation.DailyMealPortion.Class.name,
            totalPortions: item.MealAllocation.DailyMealPortion.totalPortions,
            mealType: item.MealAllocation.DailyMealPortion.mealType,
          }
        : null,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      hasNext: skip + items.length < total,
    },
  };
}

export async function anchorManual(input: AnchorManualInput, actorId?: string) {
  const prisma = await getPrisma();
  let allocationIds = input.allocationIds;
  let schoolId = input.schoolId;
  const dateStr =
    input.date ||
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(
      new Date(),
    );

  if (!allocationIds || !allocationIds.length) {
    const where: {
      status: "DISTRIBUTED";
      DailyMealPortion: { mealDate: Date; Class?: { schoolId: string } };
    } = {
      status: "DISTRIBUTED",
      DailyMealPortion: {
        mealDate: new Date(dateStr),
        ...(schoolId ? { Class: { schoolId } } : {}),
      },
    };

    const distributed = await prisma.mealAllocation.findMany({
      where,
      include: {
        DailyMealPortion: {
          include: {
            Class: { select: { schoolId: true } },
          },
        },
      },
      take: 20,
    });

    if (!distributed.length) {
      throw new Error(
        `Không tìm thấy suất ăn nào đã giao (DISTRIBUTED) trong ngày ${dateStr}.`,
      );
    }

    allocationIds = distributed.map((d) => d.id);
    schoolId = distributed[0].DailyMealPortion.Class.schoolId;
  }

  if (!schoolId) {
    throw new Error(
      "Không xác định được trường học (schoolId) cho đợt phân bổ.",
    );
  }

  return anchorDistribution(allocationIds, schoolId, dateStr, actorId);
}
