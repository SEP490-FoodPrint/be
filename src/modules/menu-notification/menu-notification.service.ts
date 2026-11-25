import type { PrismaClient } from "../../generated/prisma/client";
import { readEmailConfig } from "../../config/email";
import { readPublicTraceOrigin } from "../../config/env";
import { getPrisma } from "../../utils/database";
import {
  calculateAcademicWeekNumber,
  getSchoolMonday,
} from "../../utils/date-time";
import { expandMenuHolidays } from "../../utils/menu-week";
import { sendMail, type MailOptions } from "../../utils/mailer";
import {
  readEmailLogoUrl,
  renderLetterEmail,
  type LetterEmail,
} from "../../utils/branded-email";

/**
 * Thông báo email về thực đơn cho nhân viên dinh dưỡng (người có quyền tạo thực đơn của trường):
 * - BGH duyệt thực đơn tuần / yêu cầu chỉnh sửa (gửi ngay sau khi BGH quyết định);
 * - Nhắc tạo thực đơn tuần tới còn thiếu khối, nhắc hoàn thành và gửi duyệt (Thứ Sáu → Chủ nhật).
 * Gửi email không bao giờ làm hỏng nghiệp vụ: lỗi chỉ được ghi log.
 */

type Sender = (mail: MailOptions) => Promise<{ id: string }>;
type Logger = (message: string) => void;

const DAY_MS = 86400000;
const dmy = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * DAY_MS);
/** Ngày hôm nay theo giờ Việt Nam (00:00 UTC của ngày đó). */
const vietnamDay = (now: Date) =>
  new Date(`${isoDate(new Date(now.getTime() + 7 * 3600000))}T00:00:00Z`);

/** Email đã cấu hình chưa (API key thật + địa chỉ gửi đã xác minh). */
export function emailConfigured(): boolean {
  try {
    readEmailConfig();
    return true;
  } catch {
    return false;
  }
}

function appLink(path: string): string | undefined {
  try {
    return `${readPublicTraceOrigin()}${path}`;
  } catch {
    return undefined;
  }
}

/** Người nhận: tài khoản đang hoạt động của trường có quyền tạo thực đơn, cộng người tạo thực đơn. */
export async function menuRecipients(
  db: PrismaClient,
  schoolId: string,
  extraUserIds: string[] = [],
) {
  const users = await db.user.findMany({
    where: {
      schoolId,
      status: "ACTIVE",
      OR: [
        {
          Role: {
            rolePermissions: {
              some: { permission: { code: "menu.create", isActive: true } },
            },
          },
        },
        ...(extraUserIds.length ? [{ id: { in: extraUserIds } }] : []),
      ],
    },
    select: { id: true, email: true, fullName: true },
  });
  const seen = new Set<string>();
  return users.flatMap((user) => {
    const email = user.email;
    const key = email?.trim().toLowerCase();
    if (!email || !key || seen.has(key)) return [];
    seen.add(key);
    return [{ id: user.id, email, fullName: user.fullName }];
  });
}

async function sendToEach(
  recipients: { email: string; fullName: string }[],
  subject: string,
  build: (fullName: string) => LetterEmail,
  idempotencyKey: (email: string) => string,
  sender: Sender,
  log: Logger,
) {
  const logoUrl = readEmailLogoUrl();
  let sent = 0;
  for (const recipient of recipients) {
    const { html, text } = renderLetterEmail(build(recipient.fullName), {
      logoUrl,
    });
    try {
      await sender({
        to: recipient.email,
        subject,
        html,
        text,
        idempotencyKey: idempotencyKey(recipient.email.toLowerCase()),
      });
      sent++;
    } catch {
      // Không ghi địa chỉ email vào log.
      log(`Chưa gửi được email "${subject}" tới một người nhận.`);
    }
  }
  return sent;
}

function menuScope(menu: {
  isSchoolWide: boolean;
  grades: { grade: { name: string } }[];
}) {
  if (menu.isSchoolWide) return "Toàn trường";
  return menu.grades.map((row) => row.grade.name).join(", ") || "Chưa gán khối";
}

/** Gửi email khi BGH duyệt hoặc yêu cầu chỉnh sửa thực đơn tuần. */
export async function notifyMenuDecision(
  weeklyMenuId: string,
  decision: {
    status: "APPROVED" | "REVISION_REQUIRED";
    feedback?: string | null;
    reviewerName?: string | null;
    reviewedAt: Date;
  },
  dependencies: { db?: PrismaClient; sender?: Sender; log?: Logger } = {},
): Promise<number> {
  const log = dependencies.log ?? console.warn;
  if (!dependencies.sender && !emailConfigured()) {
    log("Bỏ qua email thông báo duyệt thực đơn: chưa cấu hình Resend.");
    return 0;
  }
  const db = dependencies.db ?? (await getPrisma());
  const menu = await db.weeklyMenu.findUnique({
    where: { id: weeklyMenuId },
    select: {
      id: true,
      title: true,
      schoolId: true,
      weekStartDate: true,
      isSchoolWide: true,
      createdByUserId: true,
      School: { select: { name: true } },
      grades: { select: { grade: { select: { name: true } } } },
    },
  });
  if (!menu) return 0;
  const recipients = await menuRecipients(db, menu.schoolId, [
    menu.createdByUserId,
  ]);
  const week = `${dmy(menu.weekStartDate)} – ${dmy(addDays(menu.weekStartDate, 4))}`;
  const approved = decision.status === "APPROVED";
  const title = menu.title || "Thực đơn tuần";
  const subject = approved
    ? `[FoodPrint] Thực đơn đã được duyệt: ${title}`
    : `[FoodPrint] Ban Giám hiệu yêu cầu chỉnh sửa: ${title}`;
  const link = appLink(
    `/school/menu-planning?week=${isoDate(menu.weekStartDate)}`,
  );
  const reviewedAt = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(decision.reviewedAt);
  const details = [
    { label: "Thực đơn", value: title },
    { label: "Tuần", value: week },
    { label: "Áp dụng", value: menuScope(menu) },
    { label: "Trường", value: menu.School.name },
    { label: "Người duyệt", value: decision.reviewerName || "Ban Giám hiệu" },
    { label: "Thời gian", value: reviewedAt },
  ];
  return sendToEach(
    recipients,
    subject,
    (fullName) =>
      approved
        ? {
            title: subject,
            preheader: `${title} (${week}) đã được Ban Giám hiệu duyệt.`,
            greeting: `Kính gửi ${fullName},`,
            intro: ["Ban Giám hiệu đã duyệt thực đơn tuần sau:"],
            fields: [
              ...details,
              ...(decision.feedback
                ? [
                    {
                      label: "Ghi chú của Ban Giám hiệu",
                      value: decision.feedback,
                      block: true,
                    },
                  ]
                : []),
            ],
            outro: [
              "Nhà bếp có thể bắt đầu lên kế hoạch nguyên liệu và chế biến theo thực đơn này.",
            ],
            ...(link ? { action: { label: "Xem thực đơn", url: link } } : {}),
          }
        : {
            title: subject,
            preheader: `${title} (${week}) cần chỉnh sửa theo nhận xét của Ban Giám hiệu.`,
            greeting: `Kính gửi ${fullName},`,
            intro: ["Thực đơn tuần sau chưa được Ban Giám hiệu duyệt:"],
            fields: [
              ...details,
              {
                label: "Nhận xét của Ban Giám hiệu",
                value:
                  decision.feedback || "Ban Giám hiệu không ghi lý do cụ thể.",
                block: true,
              },
            ],
            outro: [
              "Vui lòng chỉnh sửa theo nhận xét rồi gửi duyệt lại trước hạn chót.",
            ],
            ...(link ? { action: { label: "Sửa thực đơn", url: link } } : {}),
          },
    (email) =>
      `menu-decision/${menu.id}/${decision.reviewedAt.getTime()}/${email}`,
    dependencies.sender ?? sendMail,
    log,
  );
}

/**
 * Nhắc thực đơn tuần tới (hạn chót hết Chủ nhật): khối chưa có thực đơn -> nhắc tạo;
 * thực đơn còn là bản nháp / cần chỉnh sửa -> nhắc hoàn thành và gửi duyệt.
 * Chỉ chạy Thứ Sáu, Thứ Bảy, Chủ nhật; mỗi người nhận một email mỗi ngày (idempotency theo ngày).
 */
export async function runMenuDeadlineReminders(
  now: Date = new Date(),
  dependencies: { db?: PrismaClient; sender?: Sender; log?: Logger } = {},
): Promise<number> {
  const log = dependencies.log ?? console.warn;
  const today = vietnamDay(now);
  const weekday = today.getUTCDay(); // 0 = Chủ nhật
  if (![5, 6, 0].includes(weekday)) return 0;
  if (!dependencies.sender && !emailConfigured()) {
    log("Bỏ qua email nhắc thực đơn: chưa cấu hình Resend.");
    return 0;
  }
  const db = dependencies.db ?? (await getPrisma());
  const nextMonday = addDays(getSchoolMonday(today), 7);
  const deadline = addDays(nextMonday, -1);
  const daysLeft = Math.round((deadline.getTime() - today.getTime()) / DAY_MS);
  const years = await db.schoolAcademicYear.findMany({
    where: {
      startDate: { lte: addDays(nextMonday, 4) },
      endDate: { gte: nextMonday },
    },
    select: { schoolId: true, startDate: true, holidays: true },
  });
  let sent = 0;
  for (const year of years) {
    const holidays = expandMenuHolidays(
      year.holidays,
      isoDate(nextMonday),
      isoDate(addDays(nextMonday, 4)),
    );
    if (holidays.length >= 5) continue; // Cả tuần nghỉ: không cần thực đơn
    const [grades, menus, school] = await Promise.all([
      db.schoolGrade.findMany({
        where: { schoolId: year.schoolId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.weeklyMenu.findMany({
        where: { schoolId: year.schoolId, weekStartDate: nextMonday },
        select: {
          title: true,
          status: true,
          isSchoolWide: true,
          grades: {
            select: { gradeId: true, grade: { select: { name: true } } },
          },
        },
      }),
      db.school.findUnique({
        where: { id: year.schoolId },
        select: { name: true },
      }),
    ]);
    const covered = new Set(
      menus.flatMap((menu) => menu.grades.map((row) => row.gradeId)),
    );
    const missing = menus.some((menu) => menu.isSchoolWide)
      ? []
      : grades
          .filter((grade) => !covered.has(grade.id))
          .map((grade) => grade.name);
    const unfinished = menus
      .filter(
        (menu) =>
          menu.status === "DRAFT" || menu.status === "REVISION_REQUIRED",
      )
      .map(
        (menu) =>
          `${menu.title || "Thực đơn"} (${menuScope(menu)}) – ${menu.status === "DRAFT" ? "bản nháp chưa gửi duyệt" : "cần chỉnh sửa theo BGH"}`,
      );
    const needCreate = menus.length === 0 || missing.length > 0;
    if (!needCreate && !unfinished.length) continue;

    const weekNumber = calculateAcademicWeekNumber(nextMonday, year.startDate);
    const week = `${dmy(nextMonday)} – ${dmy(addDays(nextMonday, 4))}`;
    const remaining =
      daysLeft <= 0 ? "hôm nay là hạn chót" : `còn ${daysLeft} ngày`;
    const recipients = await menuRecipients(db, year.schoolId);
    const kind = needCreate ? "create" : "complete";
    const subject = needCreate
      ? `[FoodPrint] Nhắc tạo thực đơn dinh dưỡng tuần ${weekNumber} (${remaining})`
      : `[FoodPrint] Nhắc hoàn thành và gửi duyệt thực đơn tuần ${weekNumber} (${remaining})`;
    const bullets = [
      ...(menus.length === 0
        ? ["Chưa có thực đơn nào cho tuần này"]
        : missing.map((name) => `${name}: chưa tạo thực đơn`)),
      ...unfinished,
    ];
    const link = appLink(`/school/menu-planning?week=${isoDate(nextMonday)}`);
    sent += await sendToEach(
      recipients,
      subject,
      (fullName) => ({
        title: subject,
        preheader: `Thực đơn tuần ${week} cần tạo và gửi duyệt trước hết Chủ nhật ${dmy(deadline)}.`,
        greeting: `Kính gửi ${fullName},`,
        intro: [
          needCreate
            ? "Thực đơn của tuần tới chưa được tạo đầy đủ. Vui lòng tạo thực đơn và gửi Ban Giám hiệu duyệt trước hạn chót."
            : "Thực đơn của tuần tới chưa được gửi duyệt. Vui lòng hoàn thành và gửi Ban Giám hiệu duyệt trước hạn chót.",
        ],
        fields: [
          { label: "Tuần", value: `Tuần ${weekNumber} (${week})` },
          { label: "Trường", value: school?.name || "" },
          {
            label: "Hạn chót",
            value: `Hết Chủ nhật ${dmy(deadline)} (${remaining})`,
          },
        ],
        bullets,
        note: "Sau hạn chót, thực đơn tuần sẽ bị khoá chỉnh sửa trừ khi Ban Giám hiệu yêu cầu chỉnh sửa.",
        ...(link
          ? {
              action: {
                label: needCreate ? "Tạo thực đơn" : "Hoàn thành thực đơn",
                url: link,
              },
            }
          : {}),
      }),
      (email) =>
        `menu-reminder/${year.schoolId}/${isoDate(nextMonday)}/${kind}/${isoDate(today)}/${email}`,
      dependencies.sender ?? sendMail,
      log,
    );
  }
  return sent;
}

/** Chạy nhắc hạn mỗi giờ; mỗi ngày gửi một lần sau 8 giờ sáng (giờ Việt Nam). */
export function startMenuReminderScheduler(
  dependencies: { intervalMs?: number; log?: Logger } = {},
) {
  const log = dependencies.log ?? console.warn;
  let lastRunDay = "";
  let running = false;
  const tick = () => {
    const now = new Date();
    const vn = new Date(now.getTime() + 7 * 3600000);
    const day = isoDate(vn);
    if (running || vn.getUTCHours() < 8 || lastRunDay === day) return;
    running = true;
    runMenuDeadlineReminders(now, { log })
      .then(() => {
        lastRunDay = day;
      })
      .catch(() => log("Chưa chạy được nhắc hạn thực đơn, sẽ thử lại sau."))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, dependencies.intervalMs ?? 60 * 60 * 1000);
  tick();
  return () => clearInterval(timer);
}
