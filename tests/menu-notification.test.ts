import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { renderBrandedEmail } from "../src/utils/branded-email";
import {
  notifyMenuDecision,
  runMenuDeadlineReminders,
} from "../src/modules/menu-notification/menu-notification.service";
import type { MailOptions } from "../src/utils/mailer";

const SCHOOL = "11111111-1111-4111-8111-111111111111";
const MENU = "22222222-2222-4222-8222-222222222222";

function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    weeklyMenu: {
      findUnique: () =>
        Promise.resolve({
          id: MENU,
          title: "Thực đơn dinh dưỡng tuần 12",
          schoolId: SCHOOL,
          weekStartDate: new Date("2026-11-23T00:00:00Z"),
          isSchoolWide: false,
          createdByUserId: "creator",
          School: { name: "Trường Tiểu học Minh Khai" },
          grades: [{ grade: { name: "Khối 3" } }],
        }),
      findMany: () => Promise.resolve([]),
    },
    user: {
      findMany: () =>
        Promise.resolve([
          {
            id: "u1",
            email: "dinhduong@example.com",
            fullName: "Nguyễn Văn A",
          },
          { id: "u2", email: "DINHDUONG@example.com", fullName: "Trùng email" },
        ]),
    },
    schoolAcademicYear: {
      findMany: () =>
        Promise.resolve([
          {
            schoolId: SCHOOL,
            startDate: new Date("2026-09-07T00:00:00Z"),
            holidays: [],
          },
        ]),
    },
    schoolGrade: {
      findMany: () =>
        Promise.resolve([
          { id: "g1", name: "Khối 1" },
          { id: "g2", name: "Khối 2" },
        ]),
    },
    school: {
      findUnique: () => Promise.resolve({ name: "Trường Tiểu học Minh Khai" }),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

void test("email thương hiệu có tên dự án, màu xanh và escape nội dung động", () => {
  const { html, text } = renderBrandedEmail({
    tone: "danger",
    heading: "Ban Giám hiệu yêu cầu chỉnh sửa thực đơn",
    preheader: "preheader",
    paragraphs: ["Xin chào"],
    highlight: { title: "Nhận xét", body: "<script>alert(1)</script>\nDòng 2" },
    action: { label: "Sửa thực đơn", url: "javascript:alert(1)" },
  });
  assert.match(html, /FoodPrint/);
  assert.match(html, /#0a8066/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Dòng 2/);
  // Link không an toàn bị bỏ.
  assert.doesNotMatch(html, /javascript:/);
  assert.match(text, /Nhận xét:/);
});

void test("BGH yêu cầu chỉnh sửa: gửi một email cho mỗi người nhận, kèm nhận xét", async () => {
  const sent: MailOptions[] = [];
  const count = await notifyMenuDecision(
    MENU,
    {
      status: "REVISION_REQUIRED",
      feedback: "Thay món có tôm cho học sinh dị ứng.",
      reviewerName: "Hiệu trưởng",
      reviewedAt: new Date("2026-11-20T03:00:00Z"),
    },
    {
      db: fakeDb(),
      sender: (mail) => {
        sent.push(mail);
        return Promise.resolve({ id: "x" });
      },
      log: () => {},
    },
  );
  assert.equal(count, 1, "email trùng (khác hoa thường) chỉ gửi một lần");
  assert.match(sent[0].subject, /yêu cầu chỉnh sửa/);
  assert.match(sent[0].html ?? "", /Thay món có tôm/);
  assert.match(sent[0].html ?? "", /Khối 3/);
  assert.match(sent[0].idempotencyKey ?? "", /^menu-decision\//);
});

void test("BGH duyệt: tiêu đề báo đã duyệt", async () => {
  const sent: MailOptions[] = [];
  await notifyMenuDecision(
    MENU,
    { status: "APPROVED", reviewedAt: new Date("2026-11-20T03:00:00Z") },
    {
      db: fakeDb(),
      sender: (mail) => {
        sent.push(mail);
        return Promise.resolve({ id: "x" });
      },
      log: () => {},
    },
  );
  assert.match(sent[0].subject, /đã được duyệt/);
});

void test("nhắc hạn chỉ chạy Thứ Sáu – Chủ nhật và báo khối chưa tạo thực đơn", async () => {
  const sender = (mail: MailOptions) => {
    sent.push(mail);
    return Promise.resolve({ id: "x" });
  };
  const sent: MailOptions[] = [];
  // Thứ Năm 19/11/2026 (giờ VN): không nhắc.
  assert.equal(
    await runMenuDeadlineReminders(new Date("2026-11-19T03:00:00Z"), {
      db: fakeDb(),
      sender,
      log: () => {},
    }),
    0,
  );
  // Thứ Sáu 20/11/2026: nhắc tạo thực đơn tuần 23/11 vì chưa có thực đơn nào.
  const count = await runMenuDeadlineReminders(
    new Date("2026-11-20T03:00:00Z"),
    { db: fakeDb(), sender, log: () => {} },
  );
  assert.equal(count, 1);
  assert.match(sent[0].subject, /Nhắc tạo thực đơn dinh dưỡng tuần 12/);
  assert.match(sent[0].html ?? "", /22\/11\/2026/);
});

void test("nhắc hoàn thành khi thực đơn tuần tới còn là bản nháp", async () => {
  const sent: MailOptions[] = [];
  const db = fakeDb({
    weeklyMenu: {
      findMany: () =>
        Promise.resolve([
          {
            title: "Thực đơn dinh dưỡng tuần 12",
            status: "DRAFT",
            isSchoolWide: true,
            grades: [],
          },
        ]),
    },
  });
  await runMenuDeadlineReminders(new Date("2026-11-21T03:00:00Z"), {
    db,
    sender: (mail) => {
      sent.push(mail);
      return Promise.resolve({ id: "x" });
    },
    log: () => {},
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Nhắc hoàn thành/);
  assert.match(sent[0].html ?? "", /bản nháp chưa gửi duyệt/);
});
