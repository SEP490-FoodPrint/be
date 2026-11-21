import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_PERMISSIONS,
  INITIAL_ROLES,
  INITIAL_ROLE_PERMISSIONS,
} from "../src/constants/permission-catalog";
import { systemComplaintTitle } from "../src/modules/complaint-ticket/complaint-ticket.lifecycle";
import { createSystemComplaintRepository } from "../src/modules/system-complaint/system-complaint.repository";
import { createSystemComplaintService } from "../src/modules/system-complaint/system-complaint.service";
import {
  validateCreateSystemComplaint,
  validateSystemComplaintListQuery,
  validateSystemComplaintReopen,
} from "../src/modules/system-complaint/system-complaint.validation";
import type { AuthPrincipal } from "../src/types/auth";
import {
  BUSINESS_CODE_TYPES,
  formatBusinessCode,
} from "../src/utils/business-code";
import { listScopes } from "../src/utils/resource-access";

const principal = (overrides: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  id: "20000000-0000-4000-8000-000000000001",
  username: "kitchen",
  fullName: "Nhân viên bếp",
  roleId: "20000000-0000-4000-8000-000000000002",
  role: "SCHOOL_KITCHEN_STAFF",
  orgType: "SCHOOL",
  schoolId: "20000000-0000-4000-8000-000000000003",
  supplierId: null,
  communeFoodSafetyUnitId: null,
  permissions: ["system_complaint.submit"],
  ...overrides,
});
const admin = (overrides: Partial<AuthPrincipal> = {}) =>
  principal({
    id: "20000000-0000-4000-8000-000000000009",
    role: "SYSTEM_ADMIN",
    orgType: "SYSTEM",
    schoolId: null,
    permissions: ["system_complaint.view", "system_complaint.respond"],
    ...overrides,
  });

void test("đăng ký mã SC và tiêu đề tự sinh theo phân loại", () => {
  assert.equal(BUSINESS_CODE_TYPES.SC, "khiếu nại gửi hệ thống");
  assert.equal(formatBusinessCode("SC", 4821), "FP-SC-04821");
  assert.equal(
    systemComplaintTitle("TECHNICAL"),
    "Khiếu nại hệ thống - Lỗi kỹ thuật",
  );
  assert.equal(
    systemComplaintTitle("ACCOUNT"),
    "Khiếu nại hệ thống - Tài khoản và đăng nhập",
  );
});

void test("catalog: submit cho mọi vai trò trừ System Admin; view/respond chỉ cho System Admin", () => {
  const codes = INITIAL_PERMISSIONS.map((permission) => permission.code);
  for (const code of [
    "system_complaint.submit",
    "system_complaint.view",
    "system_complaint.respond",
  ])
    assert.ok(codes.includes(code as (typeof codes)[number]), code);
  const grants: readonly (readonly [string, string])[] =
    INITIAL_ROLE_PERMISSIONS;
  const holders = (permission: string) =>
    grants
      .filter(([, code]) => code === permission)
      .map(([role]) => role)
      .sort();
  assert.deepEqual(
    holders("system_complaint.submit"),
    INITIAL_ROLES.map((role) => role.code)
      .filter((code) => code !== "SYSTEM_ADMIN")
      .sort(),
  );
  assert.deepEqual(holders("system_complaint.view"), ["SYSTEM_ADMIN"]);
  assert.deepEqual(holders("system_complaint.respond"), ["SYSTEM_ADMIN"]);
});

void test("phạm vi đọc: admin thấy mọi đơn SYSTEM, người gửi chỉ thấy đơn của mình", () => {
  assert.deepEqual(listScopes["system-complaint"](admin()), {
    kind: "SYSTEM",
  });
  const sender = principal({ orgType: "SUPPLIER", supplierId: "s1" });
  assert.deepEqual(listScopes["system-complaint"](sender), {
    kind: "SYSTEM",
    senderUserId: sender.id,
  });
  assert.throws(
    () =>
      listScopes["system-complaint"](
        admin({ permissions: ["system_complaint.respond"] }),
      ),
    { statusCode: 403 },
  );
  assert.throws(
    () =>
      listScopes["system-complaint"](
        principal({ permissions: ["system_complaint.view"] }),
      ),
    { statusCode: 403 },
  );
  assert.throws(
    () => listScopes["system-complaint"](principal({ permissions: [] })),
    { statusCode: 403 },
  );
});

void test("validation: chỉ nhận category + description 10–2000 ký tự sau trim", () => {
  const valid = { category: "DATA", description: "  Số liệu tồn kho sai.  " };
  assert.deepEqual(validateCreateSystemComplaint(valid), {
    category: "DATA",
    description: "Số liệu tồn kho sai.",
  });
  assert.deepEqual(
    validateCreateSystemComplaint({
      category: "OTHER",
      description: "ạ".repeat(2000),
    }).description.length,
    2000,
  );
  for (const body of [
    { ...valid, title: "Tự đặt" },
    { ...valid, status: "RESOLVED" },
    { ...valid, code: "FP-SC-00001" },
    { ...valid, senderUserId: principal().id },
    { ...valid, category: "BILLING" },
    { category: "DATA", description: "   ngắn   " },
    { category: "DATA", description: "x".repeat(2001) },
    { description: "Thiếu phân loại đơn" },
  ])
    assert.throws(() => validateCreateSystemComplaint(body), {
      statusCode: 400,
    });
  assert.deepEqual(validateSystemComplaintReopen(undefined), {});
});

void test("list query: lọc trạng thái ticket, phân loại và khoảng ngày", () => {
  assert.deepEqual(
    validateSystemComplaintListQuery({
      page: "2",
      limit: "50",
      status: "REOPENED",
      category: "PERMISSION",
    }),
    { page: 2, limit: 50, status: "REOPENED", category: "PERMISSION" },
  );
  assert.throws(() => validateSystemComplaintListQuery({ limit: "101" }));
  assert.throws(() => validateSystemComplaintListQuery({ category: "x" }));
  assert.throws(() =>
    validateSystemComplaintListQuery({ from: "2026-11-10", to: "2026-11-01" }),
  );
});

const NOW = new Date("2026-11-21T03:00:00.000Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  code: "FP-SC-48213",
  title: "Khiếu nại hệ thống - Lỗi kỹ thuật",
  description: "Không tải được báo cáo.",
  status: "IN_PROGRESS",
  senderUserId: principal().id,
  lastResolvedAt: null,
  resolvedCount: 0,
  closeReason: null,
  closedAt: null,
  submittedAt: new Date("2026-11-20T01:00:00Z"),
  updatedAt: new Date("2026-11-20T01:00:00Z"),
  senderUser: { id: principal().id, fullName: "Nhân viên bếp" },
  senderRole: { code: "SCHOOL_KITCHEN_STAFF", name: "School Kitchen Staff" },
  senderSchool: { id: principal().schoolId, name: "Trường A" },
  senderSupplier: null,
  senderCommuneFoodSafetyUnit: null,
  systemComplaint: { category: "TECHNICAL" },
  comments: [{ authorSide: "REQUESTER" }],
  ...overrides,
});
const serviceWith = (repository: Record<string, unknown>) =>
  createSystemComplaintService(
    { ...createSystemComplaintRepository(), ...repository },
    () => Promise.resolve({} as never),
    () => NOW,
  );

void test("hai lớp trạng thái: admin thấy nhãn tin nhắn mới, người gửi thấy Đang xử lý", async () => {
  const service = serviceWith({ list: () => Promise.resolve([row()]) });
  const [forAdmin] = (await service.getAll({ page: 1, limit: 20 }, admin()))
    .items;
  assert.equal(forAdmin.code, "FP-SC-48213");
  assert.equal(forAdmin.category, "TECHNICAL");
  assert.equal(forAdmin.hasNewMessage, true);
  assert.deepEqual(forAdmin.allowedActions, ["COMMENT", "RESOLVE"]);
  assert.deepEqual(forAdmin.senderRole, {
    code: "SCHOOL_KITCHEN_STAFF",
    name: "School Kitchen Staff",
  });
  assert.deepEqual(forAdmin.senderOrganization, {
    type: "SCHOOL",
    id: principal().schoolId,
    name: "Trường A",
  });

  const [forSender] = (
    await service.getAll({ page: 1, limit: 20 }, principal())
  ).items;
  assert.equal(forSender.displayStatus, "IN_PROGRESS");
  assert.equal(forSender.hasNewMessage, false);
  assert.deepEqual(forSender.allowedActions, ["COMMENT"]);

  const [forObserver] = (
    await service.getAll(
      { page: 1, limit: 20 },
      admin({ permissions: ["system_complaint.view"] }),
    )
  ).items;
  assert.deepEqual(forObserver.allowedActions, []);
});

void test("tổ chức người gửi: NCC, ATTP hoặc không có", async () => {
  const detail = (overrides: Record<string, unknown>) =>
    serviceWith({
      findOne: () => Promise.resolve(row({ comments: [], ...overrides })),
    }).getOne("c1", admin());
  assert.deepEqual(
    (
      await detail({
        senderSchool: null,
        senderSupplier: { id: "s1", name: "NCC B" },
      })
    ).senderOrganization,
    { type: "SUPPLIER", id: "s1", name: "NCC B" },
  );
  assert.deepEqual(
    (
      await detail({
        senderSchool: null,
        senderCommuneFoodSafetyUnit: { id: "u1", name: "ATTP xã C" },
      })
    ).senderOrganization,
    { type: "AUTHORITY", id: "u1", name: "ATTP xã C" },
  );
  assert.equal((await detail({ senderSchool: null })).senderOrganization, null);
  await assert.rejects(
    serviceWith({ findOne: () => Promise.resolve(null) }).getOne("c1", admin()),
    { statusCode: 404 },
  );
});

void test("System Admin không được gửi; người gửi không được tiếp nhận/giải quyết", async () => {
  const service = serviceWith({});
  await assert.rejects(
    service.create(
      { category: "OTHER", description: "Admin tự gửi khiếu nại" },
      admin({ permissions: ["system_complaint.submit"] }),
    ),
    { statusCode: 403 },
  );
  await assert.rejects(
    service.create(
      { category: "OTHER", description: "Thiếu tổ chức của tài khoản" },
      principal({ schoolId: null }),
    ),
    { statusCode: 403 },
  );
  await assert.rejects(service.accept("c1", principal()), {
    statusCode: 403,
  });
  await assert.rejects(
    service.resolve("c1", { content: "Đã sửa" }, principal()),
    { statusCode: 403 },
  );
  await assert.rejects(service.satisfy("c1", admin()), { statusCode: 403 });
  await assert.rejects(
    service.accept("c1", admin({ permissions: ["system_complaint.view"] })),
    { statusCode: 403 },
  );
});
