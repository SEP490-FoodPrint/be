import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  expectedReviewVersion,
  reviewVersion,
  type ReviewRow,
} from "../src/modules/auth/registration-review";
import {
  reviewEmail,
  submissionEmail,
} from "../src/modules/auth/registration-review-email";

const row = {
  registrationNumber: 1n,
  id: randomUUID(),
  applicantUserId: randomUUID(),
  requestType: "SCHOOL",
  status: "PENDING",
  profileData: { name: "Trường <A> & B", code: "A01" },
  supportingDocuments: [],
  submittedAt: new Date("2026-11-01T00:00:00Z"),
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  reviewedAt: null,
  reviewedByUserId: null,
  reviewedByUser: null,
  rejectionReason: null,
  applicantUser: {
    id: randomUUID(),
    username: "applicant",
    fullName: "Người <đăng ký>",
    email: "person@example.test",
    phone: "0901234567",
    status: "UNVERIFIED",
    emailVerifiedAt: new Date("2026-11-01T00:00:00Z"),
  },
} as ReviewRow;

void test("review version is stable across object key order and changes with applicant contact, profile and documents", () => {
  const base = reviewVersion(row);
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.equal(
    reviewVersion({
      ...row,
      profileData: { code: "A01", name: "Trường <A> & B" },
    }),
    base,
  );
  assert.notEqual(
    reviewVersion({
      ...row,
      applicantUser: { ...row.applicantUser, phone: "0909999999" },
    }),
    base,
  );
  assert.notEqual(
    reviewVersion({
      ...row,
      applicantUser: { ...row.applicantUser, fullName: "Người đại diện khác" },
    }),
    base,
  );
  assert.notEqual(
    reviewVersion({ ...row, profileData: { name: "Trường khác" } }),
    base,
  );
  assert.notEqual(
    reviewVersion({ ...row, supportingDocuments: [{ id: randomUUID() }] }),
    base,
  );
  assert.equal(expectedReviewVersion(base), base);
  assert.throws(() => expectedReviewVersion("old"));
});

void test("review email uses the applicant address, escapes HTML and includes rejection guidance", () => {
  const rejected = reviewEmail(row, "Thiếu <giấy phép> & số thuế");
  assert.equal(rejected.recipientEmail, row.applicantUser.email);
  assert.match(rejected.text, /Thiếu <giấy phép> & số thuế/);
  assert.match(rejected.html, /&lt;giấy phép&gt; &amp; số thuế/);
  assert(!rejected.html.includes("<giấy phép>"));
  assert.match(rejected.html, /sửa hồ sơ và nộp lại/);
  const approved = reviewEmail(row);
  assert.match(approved.text, /kích hoạt/);
  assert(!approved.text.includes("Thiếu <giấy phép>"));
  for (const mail of [approved, rejected]) {
    assert.match(mail.text, /Hồ sơ FP-REG-00001/);
    assert.match(mail.html, /Hồ sơ FP-REG-00001/);
    assert.ok(!mail.text.includes(row.id));
    assert.ok(!mail.html.includes(row.id));
  }
});

void test("submission email confirms pending status with the public registration code and escaped applicant name", () => {
  const mail = submissionEmail(row, row.applicantUser);
  assert.equal(mail.recipientEmail, row.applicantUser.email);
  assert.match(mail.text, /FP-REG-00001/);
  assert.match(mail.text, /đang chờ xét duyệt/);
  assert.ok(!mail.text.includes(row.id));
  assert.ok(!mail.text.includes("đã được kích hoạt"));
  assert.match(mail.html, /Người &lt;đăng ký&gt;/);
  assert.ok(!mail.html.includes("<đăng ký>"));
});

void test("registration numbering leaves the prior review hash unchanged and never serializes bigint", () => {
  const before = reviewVersion(row);
  assert.equal(reviewVersion({ ...row, registrationNumber: 1n }), before);
  assert.equal(
    reviewVersion({ ...row, registrationNumber: 9007199254740993n }),
    before,
  );
});
