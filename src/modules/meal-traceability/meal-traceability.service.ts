import type {
  GetMealTraceabilityRequestDto,
  PublicSchoolClassesParamsDto,
} from "./meal-traceability.request.dto";
import type {
  MealTraceabilityResponseDto,
  DishTraceDto,
  BatchTraceDto,
  IngredientTraceDto,
  SourceFacilityDto,
  PublicSchoolClassDto,
} from "./meal-traceability.response.dto";
import {
  mealTraceabilityRepository,
  type MealAllocationTraceRecord,
} from "./meal-traceability.repository";
import { blockchainProofService } from "../blockchain-proof/blockchain-proof.service";
import { recordPhotoUrl } from "../../utils/record-photo";
import { HttpError } from "../../utils/http-error";

type BatchLot =
  MealAllocationTraceRecord["mealAllocationBatches"][number]["CookingBatch"]["cookingBatchLots"][number];

const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;
/** `@db.Date` được lưu tại 00:00 UTC. */
const day = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : null;

function photoUrl(publicId: string | null): string | null {
  try {
    return recordPhotoUrl(publicId);
  } catch {
    return null;
  }
}

/** Cơ sở của lô, nếu không có thì của dòng giao hàng; cơ sở bị ẩn không công khai. */
function sourceFacilityOf(
  lot: BatchLot["IngredientLot"],
): SourceFacilityDto | null {
  const item = lot.DeliveryItem;
  const facility = lot.SourceFacility ?? item.SourceFacility;
  if (facility)
    return facility.isVisible
      ? {
          id: facility.id,
          name: facility.name,
          facilityCode: facility.facilityCode,
          address: facility.address,
        }
      : null;
  if (item.sourceFacilityNameSnapshot)
    return {
      id: null,
      name: item.sourceFacilityNameSnapshot,
      facilityCode: item.sourceFacilityCodeSnapshot,
      address: null,
    };
  return null;
}

function ingredientOf(entry: BatchLot, mealDate: Date): IngredientTraceDto {
  const lot = entry.IngredientLot;
  const item = lot.DeliveryItem;
  const delivery = item.Delivery;
  const supplier = delivery.Supplier;
  return {
    ingredientLotId: lot.id,
    lotCode: lot.lotCode,
    ingredientName: item.ingredientNameSnapshot ?? item.Ingredient.name,
    quantityUsed: Number(entry.quantityUsed),
    unit: entry.unit,
    manufactureDate: day(lot.manufactureDate),
    expiryDate: day(lot.expiryDate),
    sourceFacility: sourceFacilityOf(lot),
    delivery: {
      id: delivery.id,
      deliveryNo: delivery.deliveryNo,
      status: delivery.status,
      vehiclePlate: delivery.vehiclePlate,
      expectedArrivalAt: iso(delivery.expectedArrivalAt),
      arrivedAt: iso(delivery.arrivedAt),
      receivedAt: iso(delivery.receivedAt),
      supplierName: supplier.name,
      taxCode: supplier.taxCode,
      supplierAddress: supplier.address,
      // Chỉ chứng nhận còn hiệu lực vào ngày phục vụ bữa ăn.
      certifications: supplier.supplierCertifications
        .filter((c) => !c.expiryDate || c.expiryDate >= mealDate)
        .map((c) => ({
          certificationType: c.certificationType,
          certificateNo: c.certificateNo,
          issuedDate: day(c.issuedDate),
          expiryDate: day(c.expiryDate),
        })),
      approvals: delivery.deliveryApprovals.map((approval) => ({
        roleCode: approval.Role.code,
        roleName: approval.Role.name,
        decision: approval.decision,
        reason: approval.reason,
        decidedAt: approval.decidedAt.toISOString(),
        photoUrl: photoUrl(approval.photoPublicId),
        photoHash: approval.photoHash,
      })),
    },
  };
}

export const mealTraceabilityService = {
  async getMealTraceability(
    query: GetMealTraceabilityRequestDto,
  ): Promise<MealTraceabilityResponseDto | null> {
    const record = await mealTraceabilityRepository.findAllocationRecord({
      mealAllocationId: query.mealAllocationId,
      classId: query.classId,
      date: query.date,
      mealType: query.mealType,
      schoolCode: query.schoolCode,
    });

    if (!record) {
      return null;
    }

    const portion = record.DailyMealPortion;
    const klass = portion.Class;

    const dishesMap = new Map<string, DishTraceDto>();

    for (const mab of record.mealAllocationBatches) {
      const cb = mab.CookingBatch;
      const cbd = cb.dishes.find((d) => d.dishId === mab.dishId);
      const dish = cbd?.Dish;
      if (!cbd || !dish) continue;

      if (!dishesMap.has(dish.id)) {
        dishesMap.set(dish.id, {
          dishId: dish.id,
          dishName: dish.name,
          dishCategory: dish.schoolCategory?.name ?? null,
          batches: [],
        });
      }

      // Một mẫu lưu cho mỗi (mẻ, món) — unique trong schema.
      const sample = cbd.retainedFoodSamples[0];

      const batchTrace: BatchTraceDto = {
        cookingBatchId: cb.id,
        batchCode: cb.batchCode,
        allocatedPortions: mab.allocatedPortions,
        plannedPortions: cbd.plannedPortions,
        status: cb.status,
        confirmedAt: iso(cb.confirmedAt),
        completedAt: iso(cb.completedAt),
        completedByName: cb.completedByUser?.fullName ?? null,
        retainedSample: sample
          ? {
              id: sample.id,
              status: sample.status,
              quantity:
                sample.quantity === null ? null : Number(sample.quantity),
              unit: sample.unit,
              storageLocation: sample.storageLocation,
              storageUnit: sample.storageUnit,
              photoUrl: photoUrl(sample.photoPublicId),
              photoHash: sample.photoHash,
              sampledAt: sample.sampledAt.toISOString(),
              disposedAt: iso(sample.disposedAt),
            }
          : null,
        ingredients: cb.cookingBatchLots
          .filter((lot) => lot.dishId === mab.dishId)
          .map((lot) => ingredientOf(lot, portion.mealDate)),
      };

      dishesMap.get(dish.id)?.batches.push(batchTrace);
    }

    let blockchainProof = null;
    let blockchainProofError: string | null = null;
    try {
      blockchainProof = await blockchainProofService.publicMealAllocationChain(
        record.id,
        Boolean(query.verify),
        { showOperational: true },
      );
    } catch (error) {
      blockchainProofError =
        error instanceof HttpError
          ? error.message
          : "Không tải được chuỗi bằng chứng blockchain";
    }

    return {
      school: {
        id: klass.School.id,
        name: klass.School.name,
        code: klass.School.code,
        address: klass.School.address,
      },
      classInfo: {
        id: klass.id,
        name: klass.name,
        academicYear: klass.academicYear,
        gradeId: klass.grade?.id ?? null,
        gradeName: klass.grade?.name ?? null,
      },
      allocation: {
        id: record.id,
        status: record.status,
        allocatedAt: iso(record.allocatedAt),
        distributedAt: iso(record.distributedAt),
        totalPortions: portion.totalPortions,
        mealDate: portion.mealDate.toISOString().slice(0, 10),
        mealType: portion.mealType,
      },
      dishes: Array.from(dishesMap.values()),
      blockchainProof,
      blockchainProofError,
    };
  },

  async listPublicSchoolClasses(
    params: PublicSchoolClassesParamsDto,
  ): Promise<PublicSchoolClassDto[] | null> {
    const rows = await mealTraceabilityRepository.listPublicSchoolClasses(
      params.schoolCode,
    );
    if (!rows) return null;
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        gradeId: row.gradeId,
        gradeName: row.grade?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi", { numeric: true }));
  },
};
