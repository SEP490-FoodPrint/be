import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import type { ComplaintEmailRecipientRow } from "../src/modules/complaint-ticket/complaint-ticket.repository";
import { queueRequesterEmail } from "../src/modules/complaint-ticket/complaint-ticket.service";
import { renderLetterEmail } from "../src/utils/branded-email";
import { buildComplaintEmail } from "../src/utils/complaint-email";

const tx = {} as Prisma.TransactionClient;
const complaintId = "11111111-1111-4111-8111-111111111111";

void test("renderLetterEmail: logo căn giữa, trường in đậm, nút rộng toàn khung, lời ký (HTML + text)", () => {
  const { html, text } = renderLetterEmail({
    title: "T",
    preheader: "P",
    greeting: "Kính gửi <A>,",
    intro: ["Mở đầu"],
    fields: [
      { label: "Tiêu đề", value: "X & Y" },
      { label: "Nội dung", value: "dòng 1\ndòng 2", block: true },
    ],
    note: "Ghi chú",
    action: { label: "Theo dõi", url: "https://foodprint.example/" },
  });
  assert.match(html, /src="cid:foodprint-logo"/);
  assert.match(html, /Kính gửi &lt;A&gt;,/);
  assert.match(html, /<strong>Tiêu đề:<\/strong> X &amp; Y/);
  assert.match(html, /<strong>Nội dung:<\/strong><br \/>dòng 1<br \/>dòng 2/);
  assert.match(html, /display:block;[^"]*text-align:center;">Theo dõi<\/a>/);
  assert.match(html, /Trân trọng,<br \/>FoodPrint\./);
  assert.match(
    text,
    /^Kính gửi <A>,\n\nMở đầu\n\nTiêu đề: X & Y\n\nNội dung:\ndòng 1\ndòng 2\n\nGhi chú\n\nTheo dõi: https:\/\/foodprint\.example\/\n\nTrân trọng,\nFoodPrint\./,
  );
  // Không có URL hợp lệ thì không có nút.
  assert.doesNotMatch(
    renderLetterEmail({
      title: "T",
      preheader: "P",
      greeting: "G",
      intro: [],
      action: { label: "Theo dõi", url: "javascript:alert(1)" },
    }).html,
    /Theo dõi/,
  );
});

void test("renderLetterEmail: khung rộng 343px, cao theo nội dung, có khối mã OTP và danh sách", () => {
  const { html, text } = renderLetterEmail({
    title: "T",
    preheader: "P",
    greeting: "Kính gửi Quý khách,",
    intro: [],
    code: { label: "Mã xác minh", value: "482913", note: "10 phút" },
    bullets: ["Khối <1>"],
  });
  assert.match(html, /width="343"[^>]*max-width:343px;/);
  // Không cố định chiều cao: chỉ ảnh logo có height.
  assert.doesNotMatch(html, /max-height|min-height/);
  assert.deepEqual(html.match(/height="\d+"/g), ['height="40"']);
  assert.match(html, />482913</);
  assert.match(html, /<li>Khối &lt;1&gt;<\/li>/);
  assert.match(text, /Mã xác minh: 482913\n10 phút/);
  assert.match(text, /- Khối <1>/);
});

void test("CREATED: nội dung đơn, bên xử lý theo loại, nút theo dõi; escape giá trị động", () => {
  const email = buildComplaintEmail({
    event: "CREATED",
    kind: "MEAL",
    code: "FP-MC-48213",
    title: "Khiếu nại <b>suất ăn</b>",
    description: "Cơm bị sống\nCanh bị nguội",
    recipientName: "Phụ huynh & con",
    appUrl: "https://foodprint.example/",
  });
  assert.equal(email.subject, "[FoodPrint] Đã ghi nhận đơn FP-MC-48213");
  assert.match(email.html, /Khiếu nại &lt;b&gt;suất ăn&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>suất ăn<\/b>/);
  assert.match(email.html, /Kính gửi Phụ huynh &amp; con,/);
  assert.match(email.html, /href="https:\/\/foodprint\.example\/"/);
  assert.match(email.text, /Mã đơn: FP-MC-48213/);
  assert.match(email.text, /Nội dung:\nCơm bị sống\nCanh bị nguội/);
  assert.match(email.text, /chuyển tới Ban Giám hiệu nhà trường/);
  assert.match(email.text, /Theo dõi & trao đổi tại đây: https/);
  assert.doesNotMatch(email.text, /48 giờ/);
});

void test("HANDLER_COMMENT: trường Phản hồi kèm người viết và thời gian; không có nút khi thiếu appUrl", () => {
  const email = buildComplaintEmail({
    event: "HANDLER_COMMENT",
    kind: "AUTHORITY",
    code: "FP-AC-00001",
    title: "Khiếu nại chuyển ATTP từ đơn FP-MC-00001",
    description: "Không tải được báo cáo",
    recipientName: "A",
    comment: {
      authorName: "Trần Cán Bộ",
      createdAt: new Date("2026-11-23T02:00:00.000Z"),
      content: "Vui lòng gửi ảnh <script>",
    },
  });
  assert.equal(
    email.subject,
    "[FoodPrint] Có phản hồi mới cho đơn FP-AC-00001",
  );
  assert.match(email.html, /Vui lòng gửi ảnh &lt;script&gt;/);
  assert.doesNotMatch(email.html, /Xem &amp; trả lời phản hồi/);
  assert.match(
    email.text,
    /^Kính gửi A,\n\nĐơn vị ATTP phường\/xã vừa phản hồi/,
  );
  assert.match(
    email.text,
    /Phản hồi \(Trần Cán Bộ · 09:00 23\/11\/2026\):\nVui lòng gửi ảnh <script>/,
  );
  assert.doesNotMatch(email.text, /Không tải được báo cáo/);
});

void test("RESOLVED: kết quả xử lý và dòng nhắc tự đóng sau 48 giờ, không có hướng dẫn lựa chọn", () => {
  const email = buildComplaintEmail({
    event: "RESOLVED",
    kind: "MEAL",
    code: "FP-MC-00002",
    title: "Khiếu nại suất ăn",
    description: "Cơm bị sống",
    recipientName: "B",
    comment: {
      authorName: "Cô Hiệu trưởng",
      createdAt: new Date("2026-11-23T03:00:00.000Z"),
      content: "Đã đổi nhà cung cấp rau",
    },
    appUrl: "https://foodprint.example/",
  });
  assert.equal(email.subject, "[FoodPrint] Đơn FP-MC-00002 đã được xử lý");
  assert.match(
    email.text,
    /Kết quả xử lý \(Cô Hiệu trưởng · 10:00 23\/11\/2026\):\nĐã đổi nhà cung cấp rau/,
  );
  assert.match(
    email.text,
    /Đơn sẽ tự đóng sau 48 giờ nếu bạn không phản hồi\./,
  );
  assert.match(email.text, /Xem kết quả xử lý: https/);
  assert.doesNotMatch(email.text, /Hạn đánh giá|Hài lòng|Chuyển ATTP/);
});

void test("queueRequesterEmail: dùng bình luận mới nhất của bên xử lý, bỏ qua tài khoản không ACTIVE", async () => {
  const queued: { event: string; recipientEmail: string; text: string }[] = [];
  const row = (status: string): ComplaintEmailRecipientRow => ({
    kind: "MEAL",
    code: "FP-MC-00003",
    title: "Khiếu nại suất ăn",
    description: "Cơm bị sống",
    senderUser: {
      email: "sender@example.test",
      fullName: "Người gửi",
      status,
    },
    comments: [
      {
        content: "Đã xử lý xong",
        createdAt: new Date("2026-11-23T03:00:00.000Z"),
        authorUser: { fullName: "Cô Hiệu trưởng" },
      },
    ],
  });
  const tickets = (value: ComplaintEmailRecipientRow | null) => ({
    findEmailRecipient: () => Promise.resolve(value),
    queueEmail: (
      _tx: Prisma.TransactionClient,
      input: { event: string; recipientEmail: string; text: string },
    ) => {
      queued.push({
        event: input.event,
        recipientEmail: input.recipientEmail,
        text: input.text,
      });
      return Promise.resolve({});
    },
  });
  await queueRequesterEmail(
    tx,
    tickets(row("ACTIVE")),
    complaintId,
    "RESOLVED",
  );
  await queueRequesterEmail(tx, tickets(row("LOCKED")), complaintId, "CREATED");
  await queueRequesterEmail(tx, tickets(null), complaintId, "CREATED");
  await queueRequesterEmail(tx, tickets(row("ACTIVE")), complaintId, "CREATED");
  assert.deepEqual(
    queued.map((item) => item.event),
    ["RESOLVED", "CREATED"],
  );
  assert.equal(queued[0].recipientEmail, "sender@example.test");
  assert.match(queued[0].text, /Đã xử lý xong/);
  // Email "đã ghi nhận" trích nội dung đơn, không trích bình luận.
  assert.match(queued[1].text, /Nội dung:\nCơm bị sống/);
  assert.doesNotMatch(queued[1].text, /Đã xử lý xong/);
});
