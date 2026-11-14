import { id } from "ethers";
import type { Prisma } from "../../generated/prisma/client";
import { getPrisma } from "../../utils/database";
import { readHashFromChain } from "../../utils/blockchain";
import { computeCanonicalHash } from "../../utils/canonical-hash";

interface IngredientTraceItem {
  lotId: string;
  lotCode: string;
  ingredientName: string;
  quantityUsed: number;
  unit: string;
  manufactureDate: Date | null;
  expiryDate: Date | null;
  supplierName: string;
  sourceFacility: string | null;
}

interface DeliveryTraceItem {
  deliveryId: string;
  deliveryNo: string;
  supplierName: string;
  vehiclePlate: string | null;
  status: string;
  arrivedAt: Date | null;
  receivedAt: Date | null;
}

export async function searchTraceableAllocations(
  keyword?: string,
  dateStr?: string,
  limit = 10,
) {
  const prisma = await getPrisma();

  const where: Prisma.MealAllocationWhereInput = {};

  if (dateStr || keyword) {
    where.DailyMealPortion = {
      ...(dateStr ? { mealDate: new Date(dateStr) } : {}),
      ...(keyword
        ? {
            Class: {
              name: { contains: keyword, mode: "insensitive" },
            },
          }
        : {}),
    };
  }

  const items = await prisma.mealAllocation.findMany({
    where,
    include: {
      DailyMealPortion: {
        include: {
          Class: { select: { id: true, name: true, schoolId: true } },
        },
      },
      traceabilityAnchors: true,
      mealAllocationBatches: {
        select: { allocatedPortions: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return items.map((item) => ({
    mealAllocationId: item.id,
    className: item.DailyMealPortion.Class.name,
    mealDate: item.DailyMealPortion.mealDate.toISOString().slice(0, 10),
    mealType: item.DailyMealPortion.mealType,
    totalPortions: item.DailyMealPortion.totalPortions,
    status: item.status,
    distributedAt: item.distributedAt,
    anchorsCount: item.traceabilityAnchors.length,
    latestTxHash: item.traceabilityAnchors[0]?.transactionHash || null,
  }));
}

export async function traceFromAllocation(mealAllocationId: string) {
  const prisma = await getPrisma();

  const allocation = await prisma.mealAllocation.findUnique({
    where: { id: mealAllocationId },
    include: {
      DailyMealPortion: {
        include: {
          Class: { select: { id: true, name: true, schoolId: true } },
        },
      },
      traceabilityAnchors: {
        orderBy: { createdAt: "desc" },
      },
      mealAllocationBatches: {
        include: {
          CookingBatch: {
            include: {
              dishes: {
                include: {
                  Dish: { select: { id: true, name: true } },
                  retainedFoodSamples: {
                    select: {
                      id: true,
                      status: true,
                      sampledAt: true,
                      storageLocation: true,
                    },
                  },
                },
              },
              cookingBatchLots: {
                include: {
                  IngredientLot: {
                    include: {
                      DeliveryItem: {
                        include: {
                          Delivery: {
                            include: {
                              Supplier: {
                                select: { id: true, name: true, phone: true },
                              },
                            },
                          },
                          SupplyRequestItem: {
                            include: {
                              IngredientEntry: {
                                include: {
                                  Ingredient: {
                                    select: { id: true, name: true },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                      SourceFacility: {
                        select: {
                          id: true,
                          name: true,
                          address: true,
                          facilityCode: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!allocation) {
    throw new Error(
      `Không tìm thấy đợt phân bổ suất ăn với ID: ${mealAllocationId}`,
    );
  }

  // 1. Class & Allocation stage
  const allocationStage = {
    id: allocation.id,
    className: allocation.DailyMealPortion.Class.name,
    schoolId: allocation.DailyMealPortion.Class.schoolId,
    mealType: allocation.DailyMealPortion.mealType,
    mealDate: allocation.DailyMealPortion.mealDate.toISOString().slice(0, 10),
    totalPortions: allocation.DailyMealPortion.totalPortions,
    status: allocation.status,
    allocatedAt: allocation.allocatedAt,
    distributedAt: allocation.distributedAt,
  };

  // 2. Cooking Batches stage
  const cookingBatches = allocation.mealAllocationBatches.map((mab) => {
    const cb = mab.CookingBatch;
    return {
      cookingBatchId: cb.id,
      batchCode: cb.batchCode,
      mealType: cb.mealType,
      status: cb.status,
      plannedPortions: cb.plannedPortions,
      completedAt: cb.completedAt,
      allocatedToThisClass: mab.allocatedPortions,
      dishes: cb.dishes.map((cbd) => ({
        dishId: cbd.dishId,
        dishName: cbd.Dish?.name || "Món ăn",
        retainedSample: cbd.retainedFoodSamples[0]
          ? {
              id: cbd.retainedFoodSamples[0].id,
              status: cbd.retainedFoodSamples[0].status,
              storageLocation: cbd.retainedFoodSamples[0].storageLocation,
              sampledAt: cbd.retainedFoodSamples[0].sampledAt,
            }
          : null,
      })),
    };
  });

  // 3. Ingredients & Lots stage
  const ingredientsMap = new Map<string, IngredientTraceItem>();
  const deliveriesMap = new Map<string, DeliveryTraceItem>();

  for (const mab of allocation.mealAllocationBatches) {
    for (const lotEntry of mab.CookingBatch.cookingBatchLots) {
      const lot = lotEntry.IngredientLot;
      if (!ingredientsMap.has(lot.id)) {
        const deliveryItem = lot.DeliveryItem;
        const delivery = deliveryItem?.Delivery;
        const supplier = delivery?.Supplier;
        const ingredient =
          deliveryItem?.SupplyRequestItem?.IngredientEntry?.Ingredient;

        ingredientsMap.set(lot.id, {
          lotId: lot.id,
          lotCode: lot.lotCode,
          ingredientName: ingredient?.name || "Nguyên liệu",
          quantityUsed: Number(lotEntry.quantityUsed),
          unit: lotEntry.unit,
          manufactureDate: lot.manufactureDate,
          expiryDate: lot.expiryDate,
          supplierName: supplier?.name || "Nhà cung cấp",
          sourceFacility: lot.SourceFacility
            ? `${lot.SourceFacility.name} (${lot.SourceFacility.address || lot.SourceFacility.facilityCode || ""})`
            : null,
        });

        if (delivery && !deliveriesMap.has(delivery.id)) {
          deliveriesMap.set(delivery.id, {
            deliveryId: delivery.id,
            deliveryNo: delivery.deliveryNo,
            supplierName: supplier?.name || "Nhà cung cấp",
            vehiclePlate: delivery.vehiclePlate,
            status: delivery.status,
            arrivedAt: delivery.arrivedAt,
            receivedAt: delivery.receivedAt,
          });
        }
      }
    }
  }

  // 4. Blockchain Anchors
  const anchors = allocation.traceabilityAnchors.map((anchor) => ({
    id: anchor.id,
    payloadHash: anchor.payloadHash,
    hashAlgorithm: anchor.hashAlgorithm,
    networkName: anchor.networkName,
    contractAddress: anchor.contractAddress,
    transactionHash: anchor.transactionHash,
    blockNumber: anchor.blockNumber ? anchor.blockNumber.toString() : null,
    anchorStatus: anchor.anchorStatus,
    verificationStatus: anchor.verificationStatus,
    verifiedAt: anchor.verifiedAt,
    snapshot: anchor.verificationResult
      ? (JSON.parse(anchor.verificationResult) as Record<string, unknown>)
      : null,
  }));

  return {
    allocation: allocationStage,
    cookingBatches,
    ingredients: Array.from(ingredientsMap.values()),
    deliveries: Array.from(deliveriesMap.values()),
    anchors,
  };
}

export async function verifyAnchor(
  anchorId: string,
  testModifiedPayload?: string,
) {
  const prisma = await getPrisma();

  const anchor = await prisma.traceabilityAnchor.findUnique({
    where: { id: anchorId },
    include: {
      MealAllocation: {
        include: {
          DailyMealPortion: {
            include: {
              Class: { select: { schoolId: true } },
            },
          },
        },
      },
    },
  });

  if (!anchor) {
    throw new Error(
      `Không tìm thấy mốc truy xuất (Traceability Anchor) ID: ${anchorId}`,
    );
  }

  let hashToVerify = anchor.payloadHash;
  if (testModifiedPayload) {
    // If user provided a modified payload for demonstration of tampering check
    hashToVerify = computeCanonicalHash(testModifiedPayload);
  }

  // Derive recordId
  let recordId: string;
  if (anchor.MealAllocation) {
    const schoolId = anchor.MealAllocation.DailyMealPortion.Class.schoolId;
    const dateStr = anchor.MealAllocation.DailyMealPortion.mealDate
      .toISOString()
      .slice(0, 10);
    recordId = id(`foodprint:meal-allocation:${schoolId}:${dateStr}`);
  } else {
    recordId = id(`foodprint:anchor:${anchor.id}`);
  }

  const { onChainHash, deployment } = await readHashFromChain(recordId);

  const matches =
    onChainHash !== null &&
    onChainHash.toLowerCase() === hashToVerify.toLowerCase();

  const verificationStatus = matches ? "VERIFIED" : "MISMATCH";

  // Persist verification result
  await prisma.traceabilityAnchor.update({
    where: { id: anchor.id },
    data: {
      verificationStatus,
      verifiedAt: new Date(),
    },
  });

  return {
    anchorId: anchor.id,
    recordId,
    testedHash: hashToVerify,
    originalStoredHash: anchor.payloadHash,
    onChainHash,
    matches,
    verificationStatus,
    networkName:
      deployment.chainId === 31337 ? "Hardhat Local" : "Polygon Amoy",
    contractAddress: deployment.address,
    transactionHash: anchor.transactionHash,
    blockNumber: anchor.blockNumber ? anchor.blockNumber.toString() : null,
  };
}
