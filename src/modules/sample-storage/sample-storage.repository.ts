import { getPrisma } from "../../utils/database";
import type { Prisma } from "../../generated/prisma/client";
import type { SampleStorageWriteInput } from "./sample-storage.validation";

export class SampleStorageRepository {
  async list(schoolId: string, search?: string, status?: string) {
    const where: Prisma.SampleStorageUnitWhereInput = {
      schoolId,
    };

    if (status && status !== "ALL") {
      where.status = status;
    }

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { code: { contains: term, mode: "insensitive" } },
        { name: { contains: term, mode: "insensitive" } },
        { location: { contains: term, mode: "insensitive" } },
      ];
    }

    return (await getPrisma()).sampleStorageUnit.findMany({
      where,
      include: {
        _count: {
          select: {
            retainedSamples: {
              where: { status: "STORED" },
            },
          },
        },
      },
      orderBy: [{ code: "asc" }, { createdAt: "desc" }],
    });
  }

  async findById(id: string, schoolId?: string) {
    return (await getPrisma()).sampleStorageUnit.findFirst({
      where: {
        id,
        ...(schoolId ? { schoolId } : {}),
      },
      include: {
        retainedSamples: {
          where: { status: "STORED" },
          select: {
            id: true,
            dishId: true,
            sampledAt: true,
            quantity: true,
            unit: true,
            storageLocation: true,
            status: true,
            CookingBatch: {
              select: {
                batchCode: true,
              },
            },
          },
          orderBy: { sampledAt: "desc" },
        },
      },
    });
  }

  async findByCode(schoolId: string, code: string) {
    return (await getPrisma()).sampleStorageUnit.findUnique({
      where: {
        schoolId_code: {
          schoolId,
          code,
        },
      },
    });
  }

  async create(
    schoolId: string,
    data: SampleStorageWriteInput & { code: string },
  ) {
    return (await getPrisma()).sampleStorageUnit.create({
      data: {
        schoolId,
        code: data.code,
        name: data.name,
        location: data.location,
        temperatureRange: data.temperatureRange,
        currentTemperature: data.currentTemperature,
        capacity: data.capacity,
        compartmentCount: data.compartmentCount,
        status: data.status,
        description: data.description,
      },
    });
  }

  async update(id: string, data: SampleStorageWriteInput & { code?: string }) {
    return (await getPrisma()).sampleStorageUnit.update({
      where: { id },
      data: {
        ...(data.code ? { code: data.code } : {}),
        name: data.name,
        location: data.location,
        temperatureRange: data.temperatureRange,
        currentTemperature: data.currentTemperature,
        capacity: data.capacity,
        compartmentCount: data.compartmentCount,
        status: data.status,
        description: data.description,
      },
    });
  }

  async delete(id: string) {
    return (await getPrisma()).sampleStorageUnit.delete({
      where: { id },
    });
  }

  async countActiveStoredSamples(storageUnitId: string) {
    return (await getPrisma()).retainedFoodSample.count({
      where: {
        storageUnitId,
        status: "STORED",
      },
    });
  }
}

export const sampleStorageRepository = new SampleStorageRepository();
