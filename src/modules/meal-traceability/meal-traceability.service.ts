import type { GetMealTraceabilityRequestDto } from "./meal-traceability.request.dto";
import type {
  MealTraceabilityResponseDto,
  DishTraceDto,
  BatchTraceDto,
  IngredientTraceDto,
} from "./meal-traceability.response.dto";
import {
  mealTraceabilityRepository,
  type MealAllocationTraceRecord,
} from "./meal-traceability.repository";

export const mealTraceabilityService = {
  async getMealTraceability(
    query: GetMealTraceabilityRequestDto,
  ): Promise<MealTraceabilityResponseDto | null> {
    const record: MealAllocationTraceRecord | null =
      await mealTraceabilityRepository.findAllocationRecord({
        mealAllocationId: query.mealAllocationId,
        classId: query.classId,
        date: query.date,
        mealType: query.mealType,
      });

    if (!record) {
      return null;
    }

    const school = {
      id: record.DailyMealPortion.Class.School.id,
      name: record.DailyMealPortion.Class.School.name,
      code: "TH-LVT-001",
      address: record.DailyMealPortion.Class.School.address,
    };

    const classInfo = {
      id: record.DailyMealPortion.Class.id,
      name: record.DailyMealPortion.Class.name,
      academicYear: record.DailyMealPortion.Class.academicYear,
    };

    const allocation = {
      id: record.id,
      status: record.status,
      allocatedAt: record.allocatedAt ? record.allocatedAt.toISOString() : null,
      distributedAt: record.distributedAt
        ? record.distributedAt.toISOString()
        : null,
      totalPortions: record.DailyMealPortion.totalPortions,
      mealDate: record.DailyMealPortion.mealDate.toISOString().slice(0, 10),
      mealType: record.DailyMealPortion.mealType,
    };

    // Map dishes across batches
    const dishesMap = new Map<string, DishTraceDto>();

    for (const mab of record.mealAllocationBatches) {
      const cb = mab.CookingBatch;
      const targetDishId = mab.dishId;

      // Find the dish info
      const cbd = cb.dishes.find((d) => d.dishId === targetDishId);
      const dish = cbd?.Dish;
      if (!dish) continue;

      if (!dishesMap.has(dish.id)) {
        dishesMap.set(dish.id, {
          dishId: dish.id,
          dishName: dish.name,
          dishCategory: dish.schoolCategory?.name || "Món chính",
          batches: [],
        });
      }

      // Retained sample
      const retainedSampleRecord = cbd.retainedFoodSamples?.[0];
      const retainedSample = retainedSampleRecord
        ? {
            id: retainedSampleRecord.id,
            status: retainedSampleRecord.status,
            quantity: retainedSampleRecord.quantity
              ? Number(retainedSampleRecord.quantity)
              : null,
            unit: retainedSampleRecord.unit,
            storageLocation: retainedSampleRecord.storageLocation,
            photoPublicId: retainedSampleRecord.photoPublicId,
            photoHash: retainedSampleRecord.photoHash,
            sampledAt: retainedSampleRecord.sampledAt.toISOString(),
          }
        : null;

      // Ingredients for this batch and dish
      const ingredients: IngredientTraceDto[] = [];
      const relevantLots = cb.cookingBatchLots.filter(
        (l) => l.dishId === targetDishId,
      );

      for (const lotEntry of relevantLots) {
        const lot = lotEntry.IngredientLot;
        const deliveryItem = lot.DeliveryItem;
        const delivery = deliveryItem?.Delivery;
        const supplier = delivery?.Supplier;
        const ingredient =
          deliveryItem?.SupplyRequestItem?.IngredientEntry?.Ingredient;

        const approval = delivery?.deliveryApprovals?.[0];

        ingredients.push({
          ingredientLotId: lot.id,
          lotCode: lot.lotCode,
          ingredientName: ingredient?.name || "Nguyên liệu",
          quantityUsed: Number(lotEntry.quantityUsed),
          unit: lotEntry.unit,
          manufactureDate: lot.manufactureDate
            ? lot.manufactureDate.toISOString().slice(0, 10)
            : null,
          expiryDate: lot.expiryDate
            ? lot.expiryDate.toISOString().slice(0, 10)
            : null,
          sourceFacility: lot.SourceFacility
            ? {
                id: lot.SourceFacility.id,
                name: lot.SourceFacility.name,
                facilityCode: lot.SourceFacility.facilityCode,
                address: lot.SourceFacility.address,
              }
            : null,
          delivery: {
            id: delivery?.id || "",
            deliveryNo: delivery?.deliveryNo || "DEL-001",
            vehiclePlate: delivery?.vehiclePlate || null,
            receivedAt: delivery?.receivedAt
              ? delivery.receivedAt.toISOString()
              : null,
            supplierName: supplier?.name || "Nhà cung cấp",
            taxCode: supplier?.taxCode || null,
            supplierAddress: supplier?.address || null,
            certifications: (supplier?.supplierCertifications || []).map(
              (c) => ({
                certificationType: c.certificationType,
                certificateNo: c.certificateNo,
              }),
            ),
            inspectionApproval: approval
              ? {
                  decision: approval.decision,
                  decidedAt: approval.decidedAt.toISOString(),
                  photoPublicId: approval.photoPublicId,
                }
              : null,
          },
        });
      }

      const batchTrace: BatchTraceDto = {
        cookingBatchId: cb.id,
        batchCode: cb.batchCode,
        allocatedPortions: mab.allocatedPortions,
        status: cb.status,
        confirmedAt: cb.confirmedAt ? cb.confirmedAt.toISOString() : null,
        completedAt: cb.completedAt ? cb.completedAt.toISOString() : null,
        retainedSample,
        ingredients,
      };

      dishesMap.get(dish.id)?.batches.push(batchTrace);
    }

    return {
      school,
      classInfo,
      allocation,
      dishes: Array.from(dishesMap.values()),
      blockchainProof: null, // Tạm thời để trống cho kiểm tra ban đầu
    };
  },
};
