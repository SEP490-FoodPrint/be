import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import type { AuthPrincipal } from "../src/types/auth";
import { globalErrorHandler } from "../src/middlewares/error.middleware";
import { createOrganizationRouter } from "../src/modules/organization/organization.routes";
import {
  createOrganizationService,
  type OrganizationService,
} from "../src/modules/organization/organization.service";
import type { OrganizationRepository } from "../src/modules/organization/organization.repository";
import { HttpError } from "../src/utils/http-error";

const schoolId = "10000000-0000-4000-8000-000000000002";
const admin: AuthPrincipal = {
  id: "10000000-0000-4000-8000-000000000001",
  username: "admin",
  fullName: "Quản trị trường",
  roleId: "role",
  role: "SCHOOL_ADMINISTRATION",
  orgType: "SCHOOL",
  schoolId,
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["school.manage"],
};
const teacher: AuthPrincipal = {
  ...admin,
  role: "HOMEROOM_TEACHER",
  permissions: ["daily_meal_portion.view"],
};
const isHttp = (status: number) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status;

void test("school brand is readable by every member of the school only", async () => {
  let selected = "";
  const service = createOrganizationService({
    findSchoolBrand: (id: string) => {
      selected = id;
      return Promise.resolve({
        id,
        name: "Trường Tiểu học Lê Văn Tám",
        logoUrl: "https://res.cloudinary.com/demo/logo.png",
      });
    },
  } as unknown as OrganizationRepository);

  assert.deepEqual(await service.getSchoolBrand(teacher), {
    schoolId,
    name: "Trường Tiểu học Lê Văn Tám",
    logoUrl: "https://res.cloudinary.com/demo/logo.png",
  });
  assert.equal(selected, schoolId);
  await assert.rejects(
    service.getSchoolBrand({
      ...admin,
      role: "SUPPLIER_ADMIN",
      orgType: "SUPPLIER",
      schoolId: null,
    }),
    isHttp(403),
  );
});

void test("only the school administrator may change the logo, before any upload", async () => {
  let uploads = 0;
  const service = createOrganizationService(
    {} as OrganizationRepository,
    undefined,
    {
      uploadImage: () => {
        uploads += 1;
        return Promise.reject(new Error("must not upload"));
      },
    },
  );
  const file = {
    buffer: Buffer.from("x"),
    size: 1,
    mimeType: "image/png",
    originalName: "logo.png",
  };

  assert.throws(
    () => service.authorizeSchoolLogo({ ...admin, permissions: [] }),
    isHttp(403),
  );
  assert.throws(
    () =>
      service.authorizeSchoolLogo({
        ...admin,
        role: "SCHOOL_MANAGEMENT_BOARD",
      }),
    isHttp(403),
  );
  await assert.rejects(
    service.updateSchoolLogo({ file }, teacher),
    isHttp(403),
  );
  await assert.rejects(service.removeSchoolLogo(teacher), isHttp(403));
  assert.equal(uploads, 0);
  assert.doesNotThrow(() => service.authorizeSchoolLogo(admin));
});

void test("logo routes read the session school and reject unauthorised uploads", async (context) => {
  const calls: string[] = [];
  const service = {
    getSchoolBrand: (principal: AuthPrincipal) =>
      Promise.resolve({
        schoolId: principal.schoolId,
        name: "Trường",
        logoUrl: null,
      }),
    authorizeSchoolLogo: (principal: AuthPrincipal) => {
      if (!principal.permissions.includes("school.manage"))
        throw new HttpError(403, "Không có quyền");
    },
    updateSchoolLogo: (input: { file: { mimeType: string } }) => {
      calls.push(`put:${input.file.mimeType}`);
      return Promise.resolve({ schoolId, name: "Trường", logoUrl: "u" });
    },
    removeSchoolLogo: () => {
      calls.push("delete");
      return Promise.resolve({ schoolId, name: "Trường", logoUrl: null });
    },
  } as unknown as OrganizationService;
  let current = admin;
  const auth: RequestHandler = (req, _res, next) => {
    req.auth = current;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use("/schools", createOrganizationRouter(service, auth));
  app.use(globalErrorHandler);
  const server = app.listen(0);
  context.after(() => server.close());
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/schools/me`;
  const upload = () => {
    const form = new FormData();
    form.append(
      "logo",
      new Blob([Buffer.from("png")], { type: "image/png" }),
      "logo.png",
    );
    return fetch(`${base}/logo`, { method: "PUT", body: form });
  };

  const brand = await fetch(`${base}/brand`);
  assert.equal(brand.status, 200);
  assert.equal(
    ((await brand.json()) as { data: { schoolId: string } }).data.schoolId,
    schoolId,
  );
  assert.equal((await upload()).status, 200);
  assert.equal((await fetch(`${base}/logo`, { method: "DELETE" })).status, 200);
  assert.equal(
    (
      await fetch(`${base}/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );

  current = teacher;
  assert.equal((await fetch(`${base}/brand`)).status, 200);
  assert.equal((await upload()).status, 403);
  assert.equal((await fetch(`${base}/logo`, { method: "DELETE" })).status, 403);
  assert.deepEqual(calls, ["put:image/png", "delete"]);
});
