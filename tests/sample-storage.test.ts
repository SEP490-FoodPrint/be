import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import express, { type RequestHandler } from "express";
import { Prisma, type SampleStorageUnit } from "../src/generated/prisma/client";
import { SampleStorageService } from "../src/modules/sample-storage/sample-storage.service";
import { createSampleStorageRouter } from "../src/modules/sample-storage/sample-storage.routes";
import { validateSampleStorageWrite } from "../src/modules/sample-storage/sample-storage.validation";
import { testStaff } from "./helpers/authorization";
import { startHttp } from "./helpers/http";
import type { SampleStorageRepository } from "../src/modules/sample-storage/sample-storage.repository";
import type { SampleStorageWriteInput } from "../src/modules/sample-storage/sample-storage.validation";

void test("importing application routes defers Prisma initialization until database selection", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      'require("./src/app.ts"); if (require.cache[require.resolve("./src/config/prisma.ts")]) throw new Error("Prisma initialized while importing routes"); process.stdout.write("database-client-deferred");',
    ],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: "invalid-unselected-test-target",
        NODE_ENV: "test",
        JWT_SECRET: "foodprint-import-test-only-secret",
      },
      timeout: 30_000,
    },
  );
  assert.match(stdout, /database-client-deferred$/);
});

function storedUnit(
  overrides: Partial<SampleStorageUnit> = {},
): SampleStorageUnit {
  return {
    id: "unit-1",
    schoolId: testStaff.schoolId!,
    code: "TU-LM-99",
    name: "Storage unit",
    location: "Kitchen",
    temperatureRange: "2–8°C",
    currentTemperature: new Prisma.Decimal(4),
    capacity: 40,
    currentUsage: 0,
    compartmentCount: 3,
    status: "ACTIVE",
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function writeUnit(
  schoolId: string,
  data: SampleStorageWriteInput,
): SampleStorageUnit {
  return storedUnit({
    ...data,
    schoolId,
    code: data.code ?? "TU-LM-99",
    currentTemperature:
      data.currentTemperature == null
        ? null
        : new Prisma.Decimal(data.currentTemperature),
    description: data.description ?? null,
  });
}

const kitchenStaff = {
  ...testStaff,
  permissions: [
    "retained_sample.view",
    "retained_sample.create",
    "retained_sample.update",
  ],
};

void test("validateSampleStorageWrite enforces required fields, code uppercase, and valid capacity", () => {
  const valid = validateSampleStorageWrite({
    code: "tu-lm-01",
    name: "Tủ lưu mẫu Bếp chính",
    location: "Khu kiểm thực 3 bước",
    capacity: 48,
    compartmentCount: 4,
    status: "ACTIVE",
    currentTemperature: 4.2,
  });

  assert.equal(valid.code, "TU-LM-01");
  assert.equal(valid.name, "Tủ lưu mẫu Bếp chính");
  assert.equal(valid.capacity, 48);
  assert.equal(valid.compartmentCount, 4);
  assert.equal(valid.currentTemperature, 4.2);
  assert.equal(valid.temperatureRange, "2°C - 8°C");

  // Invalid: missing name
  assert.throws(() => {
    validateSampleStorageWrite({
      name: "",
      location: "Bếp",
    });
  });

  // Invalid: capacity 0 or negative
  assert.throws(() => {
    validateSampleStorageWrite({
      code: "TU-01",
      name: "Tủ test",
      location: "Bếp",
      capacity: 0,
    });
  });

  // Invalid: temperature out of range
  assert.throws(() => {
    validateSampleStorageWrite({
      code: "TU-01",
      name: "Tủ test",
      location: "Bếp",
      currentTemperature: 100,
    });
  });
});

void test("SampleStorageService.list calculates accurate stats and occupancy rates", async () => {
  const mockUnits = [
    {
      id: "unit-1",
      schoolId: kitchenStaff.schoolId!,
      code: "TU-01",
      name: "Tủ A1",
      location: "Khu 1",
      temperatureRange: "2°C - 8°C",
      currentTemperature: new Prisma.Decimal(4),
      capacity: 40,
      currentUsage: 8,
      compartmentCount: 4,
      status: "ACTIVE",
      description: "Tủ 1",
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { retainedSamples: 8 },
    },
    {
      id: "unit-2",
      schoolId: kitchenStaff.schoolId!,
      code: "TU-02",
      name: "Tủ B1",
      location: "Khu 2",
      temperatureRange: "2°C - 8°C",
      currentTemperature: new Prisma.Decimal(5),
      capacity: 30,
      currentUsage: 0,
      compartmentCount: 3,
      status: "MAINTENANCE",
      description: "Tủ 2",
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { retainedSamples: 0 },
    },
  ];

  const mockRepo: Partial<SampleStorageRepository> = {
    list: (schoolId) => {
      assert.equal(schoolId, kitchenStaff.schoolId);
      return Promise.resolve(mockUnits);
    },
  };

  const service = new SampleStorageService(mockRepo as SampleStorageRepository);
  const result = await service.list(kitchenStaff, {});

  assert.equal(result.stats.totalUnits, 2);
  assert.equal(result.stats.activeUnits, 1);
  assert.equal(result.stats.maintenanceUnits, 1);
  assert.equal(result.stats.totalCapacity, 70);
  assert.equal(result.stats.totalStoredSamples, 8);
  assert.equal(result.items[0].occupancyRate, 20); // 8 / 40 = 20%
});

void test("SampleStorageService.create prevents duplicate codes within school", async () => {
  const mockRepo: Partial<SampleStorageRepository> = {
    findByCode: (schoolId, code) => {
      if (code === "TU-EXISTS") {
        return Promise.resolve(
          storedUnit({ id: "existing-id", schoolId, code }),
        );
      }
      return Promise.resolve(null);
    },
    create: (schoolId, data) => {
      return Promise.resolve(writeUnit(schoolId, data));
    },
  };

  const service = new SampleStorageService(mockRepo as SampleStorageRepository);

  // Duplicate code should throw 409
  await assert.rejects(
    () =>
      service.create(kitchenStaff, {
        code: "TU-EXISTS",
        name: "Trùng mã",
        location: "Bếp",
        temperatureRange: "2°C - 8°C",
        capacity: 40,
        compartmentCount: 3,
        status: "ACTIVE",
      }),
    { statusCode: 409 },
  );

  // New code succeeds
  const created = await service.create(kitchenStaff, {
    code: "TU-NEW",
    name: "Tủ mới",
    location: "Bếp",
    temperatureRange: "2°C - 8°C",
    capacity: 40,
    compartmentCount: 3,
    status: "ACTIVE",
  });
  assert.equal(created.code, "TU-NEW");
});

void test("SampleStorageService.delete guards against deleting storage unit containing active samples", async () => {
  const mockRepo: Partial<SampleStorageRepository> = {
    findById: (id, schoolId) =>
      Promise.resolve({
        ...storedUnit({ id, schoolId, code: "TU-BUSY" }),
        retainedSamples: [],
      }),
    countActiveStoredSamples: () => Promise.resolve(3),
    delete: (id) => Promise.resolve(storedUnit({ id })),
  };

  const service = new SampleStorageService(mockRepo as SampleStorageRepository);

  // Should reject deletion with 400
  await assert.rejects(() => service.delete(kitchenStaff, "unit-busy-id"), {
    statusCode: 400,
    message: /Không thể xóa/,
  });
});

void test("SampleStorage router handles HTTP CRUD endpoints with authentications", async () => {
  const dummyUnit = {
    id: "00000000-0000-4000-8000-000000000010",
    schoolId: kitchenStaff.schoolId!,
    code: "TU-LM-99",
    name: "Tủ kiểm thử",
    location: "Khu vực test",
    temperatureRange: "2°C - 8°C",
    currentTemperature: new Prisma.Decimal(4.1),
    capacity: 40,
    currentUsage: 0,
    compartmentCount: 3,
    status: "ACTIVE",
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { retainedSamples: 0 },
    retainedSamples: [],
  };

  const mockRepo: Partial<SampleStorageRepository> = {
    list: () => Promise.resolve([dummyUnit]),
    findById: () => Promise.resolve(dummyUnit),
    findByCode: () => Promise.resolve(null),
    create: (schoolId, data) => Promise.resolve(writeUnit(schoolId, data)),
    update: (_id, data) => Promise.resolve(writeUnit(dummyUnit.schoolId, data)),
    countActiveStoredSamples: () => Promise.resolve(0),
    delete: (id) => Promise.resolve(storedUnit({ id })),
  };

  const service = new SampleStorageService(mockRepo as SampleStorageRepository);
  const authMiddleware: RequestHandler = (req, _res, next) => {
    req.auth = kitchenStaff;
    next();
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/v1/sample-storage-units",
    createSampleStorageRouter(service, authMiddleware),
  );

  const http = await startHttp(app);
  try {
    // 1. GET /
    const listRes = await http.request("/v1/sample-storage-units");
    assert.equal(listRes.status, 200);
    const listBody = listRes.body as {
      success: boolean;
      data: Awaited<ReturnType<SampleStorageService["list"]>>;
    };
    assert.equal(listBody.success, true);
    assert.equal(listBody.data.items.length, 1);
    assert.equal(listBody.data.items[0].code, "TU-LM-99");

    // 2. GET /:id
    const detailRes = await http.request(
      `/v1/sample-storage-units/${dummyUnit.id}`,
    );
    assert.equal(detailRes.status, 200);
    const detailBody = detailRes.body as {
      data: Awaited<ReturnType<SampleStorageService["getById"]>>;
    };
    assert.equal(detailBody.data.code, "TU-LM-99");

    // 3. POST /
    const createRes = await http.request("/v1/sample-storage-units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "tu-lm-88",
        name: "Tủ tạo mới",
        location: "Bếp phụ",
        capacity: 30,
        compartmentCount: 2,
        status: "ACTIVE",
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = createRes.body as { data: SampleStorageUnit };
    assert.equal(createBody.data.code, "TU-LM-88");

    // 4. PUT /:id
    const updateRes = await http.request(
      `/v1/sample-storage-units/${dummyUnit.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "TU-LM-99",
          name: "Tủ đã sửa",
          location: "Bếp mới",
          capacity: 50,
          compartmentCount: 4,
          status: "MAINTENANCE",
        }),
      },
    );
    assert.equal(updateRes.status, 200);
    const updateBody = updateRes.body as { data: SampleStorageUnit };
    assert.equal(updateBody.data.name, "Tủ đã sửa");

    // 5. DELETE /:id
    const deleteRes = await http.request(
      `/v1/sample-storage-units/${dummyUnit.id}`,
      {
        method: "DELETE",
      },
    );
    assert.equal(deleteRes.status, 200);
    const deleteBody = deleteRes.body as { success: boolean };
    assert.equal(deleteBody.success, true);
  } finally {
    await http.close();
  }
});
