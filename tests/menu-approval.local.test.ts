import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { requireDatabaseUrl } from "../src/config/env";
import { getPrisma } from "../src/utils/database";
import { menuService } from "../src/modules/menu/menu.service";
import { HttpError } from "../src/utils/http-error";

void test("local DB: isolated day/week decisions, reload, revision and concurrent requests", async () => {
  const target = new URL(requireDatabaseUrl());
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  const prisma = await getPrisma();
  const menuId = randomUUID();
  const schoolId = "10000000-0000-4000-8000-000000000001";
  const adminId = "20000000-0000-4000-8000-000000000003";
  const healthId = "20000000-0000-4000-8000-000000000001";
  const dayIds = [randomUUID(), randomUUID(), randomUUID()];
  const healthNote = "Nhận xét y tế độc lập";
  try {
    await prisma.weeklyMenu.create({
      data: {
        id: menuId,
        schoolId,
        createdByUserId: adminId,
        weekStartDate: new Date("2099-01-05T00:00:00Z"),
        status: "PENDING_APPROVAL",
        title: "Temporary approval integration test",
        menuDays: {
          create: dayIds.map((id, index) => ({
            id,
            menuDate: new Date(Date.UTC(2099, 0, 5 + index)),
            approvalStatus: "PENDING_APPROVAL",
          })),
        },
        menuReviewRecords: {
          create: {
            reviewerUserId: healthId,
            decision: "APPROVED",
            feedback: healthNote,
          },
        },
      },
    });
    await menuService.approveMenu(menuId, undefined, "Duyệt T2", dayIds[0]);
    let detail = await menuService.getApprovalDetail(menuId);
    assert.equal(detail?.status, "PENDING_APPROVAL");
    assert.deepEqual(
      detail?.days.map((day) => day.status),
      ["APPROVED", "PENDING_APPROVAL", "PENDING_APPROVAL"],
    );
    await assert.rejects(
      menuService.approveMenu(menuId, undefined, "", dayIds[0]),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 409,
    );
    await assert.rejects(
      menuService.approveMenu(menuId, undefined, "", randomUUID()),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 404,
    );
    await menuService.requestRevision(
      menuId,
      undefined,
      "Cần thay món",
      dayIds[1],
    );
    detail = await menuService.getApprovalDetail(menuId);
    assert.equal(detail?.days[1]?.status, "REVISION_REQUIRED");
    assert.equal(detail?.medicalReview.note, healthNote);
    assert.equal(detail?.medicalReview.reviewer, "BS. Nguyễn Mai Lan");
    assert.equal(detail?.days[1]?.approval.note, "Cần thay món");
    assert.notEqual(detail?.approval.approver, detail?.medicalReview.reviewer);
    const all = await menuService.approveMenu(
      menuId,
      undefined,
      "Duyệt phần còn chờ",
    );
    assert.deepEqual(
      all?.days.map((day) => day.id),
      [dayIds[2]],
    );
    detail = await menuService.getApprovalDetail(menuId);
    assert.equal(detail?.status, "REVISION_REQUIRED");
    assert.equal(detail?.canDecide, false);
    assert.deepEqual(
      detail?.days.map((day) => day.status),
      ["APPROVED", "REVISION_REQUIRED", "APPROVED"],
    );
    // Simulate a revised proposal re-submitted by the kitchen, only in this fixture.
    await prisma.menuDay.update({
      where: { id: dayIds[1] },
      data: { approvalStatus: "PENDING_APPROVAL" },
    });
    const concurrent = await Promise.allSettled([
      menuService.approveMenu(menuId, undefined, "Duyệt", dayIds[1]),
      menuService.requestRevision(menuId, undefined, "Yêu cầu sửa", dayIds[1]),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      concurrent.filter((result) => result.status === "rejected").length,
      1,
    );
    const reviews = await prisma.menuReviewRecord.count({
      where: { weeklyMenuId: menuId, menuDayId: dayIds[1] },
    });
    assert.equal(reviews, 2);
    // Whole-week approval from a fresh pending proposal approves every day.
    await prisma.menuDay.updateMany({
      where: { weeklyMenuId: menuId },
      data: { approvalStatus: "PENDING_APPROVAL" },
    });
    const wholeWeek = await menuService.approveMenu(
      menuId,
      undefined,
      "Duyệt cả tuần",
    );
    assert.equal(wholeWeek?.days.length, 3);
    detail = await menuService.getApprovalDetail(menuId);
    assert.equal(detail?.status, "APPROVED");
    assert.equal(detail?.canDecide, false);
    assert.ok(detail?.days.every((day) => day.status === "APPROVED"));
    const saved = await prisma.weeklyMenu.findUnique({ where: { id: menuId } });
    assert.ok(saved?.approvedAt);
    await assert.rejects(
      menuService.requestRevision(menuId, undefined, "Gửi lặp"),
      (error: unknown) =>
        error instanceof HttpError && error.statusCode === 409,
    );
  } finally {
    await prisma.weeklyMenu.deleteMany({ where: { id: menuId } });
    await prisma.$disconnect();
  }
});
