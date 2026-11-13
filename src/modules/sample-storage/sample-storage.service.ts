import { HttpError } from "../../utils/http-error";
import type { AuthPrincipal } from "../../types/auth";
import {
  sampleStorageRepository,
  type SampleStorageRepository,
} from "./sample-storage.repository";
import type {
  SampleStorageQueryInput,
  SampleStorageWriteInput,
} from "./sample-storage.validation";

export class SampleStorageService {
  constructor(
    private readonly repository: SampleStorageRepository = sampleStorageRepository,
  ) {}

  private resolveSchoolId(
    principal: AuthPrincipal,
    targetSchoolId?: string,
  ): string {
    if (principal.orgType === "SYSTEM") {
      if (targetSchoolId) return targetSchoolId;
      throw new HttpError(400, "Vui lòng chỉ định trường học (schoolId)");
    }
    if (principal.orgType === "SCHOOL" && principal.schoolId) {
      return principal.schoolId;
    }
    throw new HttpError(
      403,
      "Chỉ tài khoản thuộc phân hệ trường học mới có quyền truy cập dữ liệu tủ lưu mẫu",
    );
  }

  async list(principal: AuthPrincipal, query: SampleStorageQueryInput) {
    const schoolId = this.resolveSchoolId(principal, query.schoolId);
    const rawUnits = await this.repository.list(
      schoolId,
      query.search,
      query.status,
    );

    let totalCapacity = 0;
    let totalStoredSamples = 0;
    let activeUnits = 0;
    let maintenanceUnits = 0;
    let inactiveUnits = 0;

    const items = rawUnits.map((u) => {
      const activeSamples = u._count.retainedSamples;
      const effectiveUsage = Math.max(u.currentUsage, activeSamples);
      const occupancyRate =
        u.capacity > 0
          ? Math.min(100, Math.round((effectiveUsage / u.capacity) * 100))
          : 0;

      totalCapacity += u.capacity;
      totalStoredSamples += effectiveUsage;

      if (u.status === "ACTIVE") activeUnits++;
      else if (u.status === "MAINTENANCE") maintenanceUnits++;
      else if (u.status === "INACTIVE") inactiveUnits++;

      return {
        id: u.id,
        schoolId: u.schoolId,
        code: u.code,
        name: u.name,
        location: u.location,
        temperatureRange: u.temperatureRange,
        currentTemperature: u.currentTemperature
          ? Number(u.currentTemperature)
          : null,
        capacity: u.capacity,
        currentUsage: effectiveUsage,
        occupancyRate,
        compartmentCount: u.compartmentCount,
        status: u.status,
        description: u.description || null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      };
    });

    return {
      stats: {
        totalUnits: items.length,
        activeUnits,
        maintenanceUnits,
        inactiveUnits,
        totalCapacity,
        totalStoredSamples,
      },
      items,
    };
  }

  async getById(principal: AuthPrincipal, id: string) {
    const schoolId = this.resolveSchoolId(principal);
    const unit = await this.repository.findById(id, schoolId);
    if (!unit) {
      throw new HttpError(404, "Không tìm thấy tủ lưu mẫu yêu cầu");
    }

    const activeSamples = unit.retainedSamples.length;
    const effectiveUsage = Math.max(unit.currentUsage, activeSamples);
    const occupancyRate =
      unit.capacity > 0
        ? Math.min(100, Math.round((effectiveUsage / unit.capacity) * 100))
        : 0;

    return {
      id: unit.id,
      schoolId: unit.schoolId,
      code: unit.code,
      name: unit.name,
      location: unit.location,
      temperatureRange: unit.temperatureRange,
      currentTemperature: unit.currentTemperature
        ? Number(unit.currentTemperature)
        : null,
      capacity: unit.capacity,
      currentUsage: effectiveUsage,
      occupancyRate,
      compartmentCount: unit.compartmentCount,
      status: unit.status,
      description: unit.description || null,
      retainedSamples: unit.retainedSamples.map((s) => ({
        id: s.id,
        dishId: s.dishId,
        batchCode: s.CookingBatch?.batchCode || null,
        sampledAt: s.sampledAt,
        quantity: s.quantity ? Number(s.quantity) : null,
        unit: s.unit || null,
        storageLocation: s.storageLocation || null,
        status: s.status,
      })),
      createdAt: unit.createdAt,
      updatedAt: unit.updatedAt,
    };
  }

  async create(principal: AuthPrincipal, input: SampleStorageWriteInput) {
    const schoolId = this.resolveSchoolId(principal);

    let code = input.code;
    if (!code) {
      const existingUnits = await this.repository.list(schoolId);
      const numbers = existingUnits
        .map((u) => {
          const match = u.code.match(/TU-LM-(\d+)/i) || u.code.match(/(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter((n) => !isNaN(n));
      const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
      code = `TU-LM-${String(maxNum + 1).padStart(2, "0")}`;
    } else {
      const existing = await this.repository.findByCode(schoolId, code);
      if (existing) {
        throw new HttpError(
          409,
          `Mã tủ lưu mẫu '${code}' đã tồn tại trong trường. Vui lòng chọn mã khác.`,
        );
      }
    }

    return this.repository.create(schoolId, { ...input, code });
  }

  async update(
    principal: AuthPrincipal,
    id: string,
    input: SampleStorageWriteInput,
  ) {
    const schoolId = this.resolveSchoolId(principal);

    const current = await this.repository.findById(id, schoolId);
    if (!current) {
      throw new HttpError(404, "Không tìm thấy tủ lưu mẫu cần cập nhật");
    }

    const code = input.code || current.code;
    if (code !== current.code) {
      const duplicate = await this.repository.findByCode(schoolId, code);
      if (duplicate && duplicate.id !== id) {
        throw new HttpError(
          409,
          `Mã tủ lưu mẫu '${code}' đã được sử dụng bởi tủ khác.`,
        );
      }
    }

    return this.repository.update(id, { ...input, code });
  }

  async delete(principal: AuthPrincipal, id: string) {
    const schoolId = this.resolveSchoolId(principal);

    const current = await this.repository.findById(id, schoolId);
    if (!current) {
      throw new HttpError(404, "Không tìm thấy tủ lưu mẫu cần xóa");
    }

    const activeStoredSamples =
      await this.repository.countActiveStoredSamples(id);
    if (activeStoredSamples > 0) {
      throw new HttpError(
        400,
        `Không thể xóa tủ đang chứa ${activeStoredSamples} mẫu thức ăn lưu trữ. Vui lòng chuyển vị trí lưu hoặc hủy mẫu trước khi xóa tủ.`,
      );
    }

    await this.repository.delete(id);
    return {
      id,
      code: current.code,
      message: `Đã xóa tủ lưu mẫu '${current.name}' (${current.code}) thành công`,
    };
  }
}

export const sampleStorageService = new SampleStorageService();
