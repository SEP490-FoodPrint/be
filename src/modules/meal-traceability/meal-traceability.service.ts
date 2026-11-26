import type { GetGradeMealTraceabilityRequestDto } from "./meal-traceability.request.dto";
import type {
  IngredientTraceDto,
  SourceFacilityDto,
  GradeMealTraceabilityResponseDto,
  GradeDishTraceDto,
  GradeSupplierDto,
  GradeDeliveryDto,
  GradeBatchDto,
  RetainedSampleDto,
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

type CookingBatchDish =
  MealAllocationTraceRecord["mealAllocationBatches"][number]["CookingBatch"]["dishes"][number];

function retainedSampleOf(cbd: CookingBatchDish): RetainedSampleDto | null {
  // Một mẫu lưu cho mỗi (mẻ, món) — unique trong schema.
  const sample = cbd.retainedFoodSamples[0];
  if (!sample) return null;
  return {
    id: sample.id,
    status: sample.status,
    quantity: sample.quantity === null ? null : Number(sample.quantity),
    unit: sample.unit,
    storageLocation: sample.storageLocation,
    storageUnit: sample.storageUnit,
    photoUrl: photoUrl(sample.photoPublicId),
    photoHash: sample.photoHash,
    sampledAt: sample.sampledAt.toISOString(),
    disposedAt: iso(sample.disposedAt),
  };
}

const earliestOf = (values: (Date | null | undefined)[]) =>
  values
    .filter((v): v is Date => Boolean(v))
    .reduce<Date | null>((min, v) => (!min || v < min ? v : min), null);
const latestOf = (values: (Date | null | undefined)[]) =>
  values
    .filter((v): v is Date => Boolean(v))
    .reduce<Date | null>((max, v) => (!max || v > max ? v : max), null);
const byTime = (a: string | null, b: string | null) =>
  (a ?? "9999").localeCompare(b ?? "9999");

/** Món của cả khối: gộp mẻ nấu trùng giữa các lớp rồi gom theo nhà cung cấp. */
function gradeDishesOf(
  records: MealAllocationTraceRecord[],
  mealDate: Date,
): GradeDishTraceDto[] {
  type DishAcc = {
    dishId: string;
    dishName: string;
    dishCategory: string | null;
    batches: Map<
      string,
      {
        cb: MealAllocationTraceRecord["mealAllocationBatches"][number]["CookingBatch"];
        cbd: CookingBatchDish;
      }
    >;
    allocations: Map<string, MealAllocationTraceRecord>;
  };
  const dishes = new Map<string, DishAcc>();

  for (const record of records)
    for (const mab of record.mealAllocationBatches) {
      const cb = mab.CookingBatch;
      const cbd = cb.dishes.find((d) => d.dishId === mab.dishId);
      const dish = cbd?.Dish;
      if (!cbd || !dish) continue;
      let acc = dishes.get(dish.id);
      if (!acc) {
        acc = {
          dishId: dish.id,
          dishName: dish.name,
          dishCategory: dish.schoolCategory?.name ?? null,
          batches: new Map(),
          allocations: new Map(),
        };
        dishes.set(dish.id, acc);
      }
      acc.batches.set(cb.id, { cb, cbd });
      acc.allocations.set(record.id, record);
    }

  return Array.from(dishes.values()).map((acc) => {
    const batchList = Array.from(acc.batches.values());
    const suppliers = new Map<string, GradeSupplierDto>();
    const deliveries = new Map<string, GradeDeliveryDto>();

    for (const { cb } of batchList)
      for (const entry of cb.cookingBatchLots) {
        if (entry.dishId !== acc.dishId) continue;
        const ingredient = ingredientOf(entry, mealDate);
        const lot = entry.IngredientLot;
        const supplier = lot.DeliveryItem.Delivery.Supplier;
        const del = ingredient.delivery;

        let supplierDto = suppliers.get(supplier.id);
        if (!supplierDto) {
          supplierDto = {
            id: supplier.id,
            name: del.supplierName,
            taxCode: del.taxCode,
            address: del.supplierAddress,
            certifications: del.certifications,
            deliveries: [],
          };
          suppliers.set(supplier.id, supplierDto);
        }

        let deliveryDto = deliveries.get(del.id);
        if (!deliveryDto) {
          deliveryDto = {
            id: del.id,
            deliveryNo: del.deliveryNo,
            status: del.status,
            vehiclePlate: del.vehiclePlate,
            expectedArrivalAt: del.expectedArrivalAt,
            arrivedAt: del.arrivedAt,
            receivedAt: del.receivedAt,
            approvals: del.approvals,
            lots: [],
          };
          deliveries.set(del.id, deliveryDto);
          supplierDto.deliveries.push(deliveryDto);
        }

        if (
          !deliveryDto.lots.some(
            (l) => l.ingredientLotId === ingredient.ingredientLotId,
          )
        )
          deliveryDto.lots.push({
            ingredientLotId: ingredient.ingredientLotId,
            lotCode: ingredient.lotCode,
            ingredientName: ingredient.ingredientName,
            manufactureDate: ingredient.manufactureDate,
            expiryDate: ingredient.expiryDate,
            sourceFacility: ingredient.sourceFacility,
          });
      }

    const supplierList = Array.from(suppliers.values())
      .map((s) => ({
        ...s,
        deliveries: [...s.deliveries].sort((a, b) =>
          byTime(a.receivedAt, b.receivedAt),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));

    const batches: GradeBatchDto[] = batchList
      .map(({ cb, cbd }) => ({
        cookingBatchId: cb.id,
        batchCode: cb.batchCode,
        status: cb.status,
        confirmedAt: iso(cb.confirmedAt),
        completedAt: iso(cb.completedAt),
        retainedSample: retainedSampleOf(cbd),
      }))
      .sort((a, b) => a.batchCode.localeCompare(b.batchCode));

    const allocations = Array.from(acc.allocations.values());
    const samples = batches
      .map((b) => b.retainedSample)
      .filter((s): s is RetainedSampleDto => Boolean(s));

    return {
      dishId: acc.dishId,
      dishName: acc.dishName,
      dishCategory: acc.dishCategory,
      process: {
        receive: Array.from(deliveries.values())
          .map((d) => ({
            deliveryId: d.id,
            deliveryNo: d.deliveryNo,
            supplierName:
              supplierList.find((s) => s.deliveries.some((x) => x.id === d.id))
                ?.name ?? "",
            vehiclePlate: d.vehiclePlate,
            arrivedAt: d.arrivedAt,
            receivedAt: d.receivedAt,
          }))
          .sort((a, b) =>
            byTime(a.arrivedAt ?? a.receivedAt, b.arrivedAt ?? b.receivedAt),
          ),
        prepare: {
          startedAt: iso(earliestOf(batchList.map(({ cb }) => cb.confirmedAt))),
          completedAt: iso(latestOf(batchList.map(({ cb }) => cb.completedAt))),
          batchCount: batchList.length,
        },
        sample: {
          sampledAt: samples.map((s) => s.sampledAt).sort(byTime)[0] ?? null,
          sampleCount: samples.length,
        },
        deliver: {
          allocatedAt: iso(earliestOf(allocations.map((a) => a.allocatedAt))),
          firstDistributedAt: iso(
            earliestOf(allocations.map((a) => a.distributedAt)),
          ),
          lastDistributedAt: iso(
            latestOf(allocations.map((a) => a.distributedAt)),
          ),
          distributed:
            allocations.length > 0 &&
            allocations.every((a) => Boolean(a.distributedAt)),
        },
      },
      suppliers: supplierList,
      batches,
    };
  });
}

export const mealTraceabilityService = {
  /**
   * Truy xuất chung một bữa của cả khối: món nào, nguyên liệu do nhà cung cấp
   * nào giao, các mốc phục vụ và chuỗi bằng chứng blockchain của khối.
   * Không trả số suất của lớp hay khối.
   */
  async getGradeMealTraceability(
    query: GetGradeMealTraceabilityRequestDto,
  ): Promise<GradeMealTraceabilityResponseDto | null> {
    const records = await mealTraceabilityRepository.findGradeAllocationRecords(
      {
        gradeId: query.gradeId,
        date: query.date,
        mealType: query.mealType,
        schoolCode: query.schoolCode,
      },
    );
    const first = records[0];
    if (!first) return null;

    const klass = first.DailyMealPortion.Class;
    const school = klass.School;

    let blockchainProof = null;
    let blockchainProofError: string | null = null;
    try {
      blockchainProof = await blockchainProofService.publicGradeMealChain(
        {
          schoolId: school.id,
          gradeId: query.gradeId,
          date: query.date,
          mealType: query.mealType,
        },
        Boolean(query.verify),
      );
    } catch (error) {
      blockchainProofError =
        error instanceof HttpError
          ? error.message
          : "Không tải được chuỗi bằng chứng blockchain";
    }

    return {
      school: {
        id: school.id,
        name: school.name,
        code: school.code,
        address: school.address,
      },
      grade: { id: query.gradeId, name: klass.grade?.name ?? null },
      meal: { mealDate: query.date, mealType: query.mealType },
      dishes: gradeDishesOf(records, first.DailyMealPortion.mealDate),
      blockchainProof,
      blockchainProofError,
    };
  },
};
