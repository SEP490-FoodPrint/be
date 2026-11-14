import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSpecGate } from "../.github/scripts/spec-gate.mjs";

const completeSpec = {
  "spec.md": "# Spec\n",
  "plan.md": "# Plan\n",
  "tasks.md": "- [ ] T001 Task\n",
};

function run(overrides) {
  return evaluateSpecGate({
    headRef: "feat/login",
    baseRef: "dev",
    changedFiles: [],
    headSpecs: {},
    ...overrides,
  });
}

test("bỏ qua PR không đụng tới src, prisma hay specs", () => {
  const result = run({
    headRef: "docs/readme-update",
    changedFiles: [
      "README.md",
      ".github/workflows/ci.yml",
      "tests/cache.test.ts",
    ],
  });
  assert.equal(result.status, "skipped");
});

test("bỏ qua PR promote dev sang main và branch revert", () => {
  const changedFiles = ["src/app.ts"];
  assert.equal(
    run({ headRef: "dev", baseRef: "main", changedFiles }).status,
    "skipped",
  );
  assert.equal(
    run({ headRef: "revert/001-login", changedFiles }).status,
    "skipped",
  );
});

test("chấp nhận PR code kèm spec mới đầy đủ", () => {
  const result = run({
    changedFiles: [
      "src/modules/auth/auth.service.ts",
      "specs/001-login/spec.md",
    ],
    headSpecs: { "001-login": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("chấp nhận PR code dùng spec đã có sẵn trên dev", () => {
  const result = run({
    headRef: "fix/001-login-token-expiry",
    changedFiles: ["prisma/schema.prisma"],
    headSpecs: { "001-login": completeSpec, "002-menu": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("từ chối branch sai định dạng khi PR đụng tới src", () => {
  for (const headRef of [
    "chore/001-login",
    "docs/001-login",
    "feat/Login",
    "feat/login_page",
    "feat/login/details",
    "feat/login--page",
  ]) {
    const result = run({
      headRef,
      changedFiles: ["src/app.ts"],
      headSpecs: { "001-login": completeSpec },
    });
    assert.equal(result.status, "failed", headRef);
  }
});

test("từ chối khi không có thư mục spec tương ứng", () => {
  const result = run({
    changedFiles: ["src/app.ts"],
    headSpecs: { "002-menu": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /login/);
});

test("từ chối khi thiếu file bắt buộc", () => {
  const result = run({
    changedFiles: ["src/app.ts", "specs/001-login/spec.md"],
    headSpecs: { "001-login": { "spec.md": "# Spec\n" } },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errors.length, 2);
});

test("từ chối khi spec hoặc plan còn NEEDS CLARIFICATION", () => {
  const result = run({
    changedFiles: ["src/app.ts"],
    headSpecs: {
      "001-login": {
        ...completeSpec,
        "spec.md": "- FR-001: [NEEDS CLARIFICATION: thời hạn token?]\n",
        "plan.md": "**Testing**: NEEDS CLARIFICATION\n",
      },
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /spec\.md/);
  assert.match(result.errors[1], /plan\.md/);
});

test("không chặn research.md nhắc tới câu hỏi đã giải quyết", () => {
  const result = run({
    changedFiles: ["src/app.ts"],
    headSpecs: {
      "001-login": {
        ...completeSpec,
        "research.md": "Đã giải quyết mọi mục NEEDS CLARIFICATION.\n",
      },
    },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("hai spec cũ trùng số vẫn được phân biệt bằng tên tính năng", () => {
  const result = run({
    changedFiles: ["src/app.ts"],
    headSpecs: { "001-login": completeSpec, "001-menu": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("từ chối khi PR sửa spec không thuộc tính năng đang làm", () => {
  const result = run({
    changedFiles: ["src/app.ts", "specs/002-menu/plan.md"],
    headSpecs: { "001-login": completeSpec, "002-menu": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /specs\/002-menu/);
});

test("chấp nhận nhánh và thư mục spec không có số thứ tự", () => {
  const result = run({
    changedFiles: ["src/app.ts", "specs/login/spec.md"],
    headSpecs: { login: completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("chấp nhận sửa spec không số đã có với hậu tố mô tả trên nhánh", () => {
  const result = run({
    headRef: "fix/login-token-expiry",
    changedFiles: ["src/app.ts"],
    headSpecs: { login: completeSpec, menu: completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("nhánh không số có thể tiếp tục dùng spec cũ có số", () => {
  const result = run({
    headRef: "fix/login",
    changedFiles: ["src/app.ts", "specs/001-login/plan.md"],
    headSpecs: { "001-login": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("nhánh có số vẫn có thể dùng spec mới không số", () => {
  const result = run({
    headRef: "feat/001-login",
    changedFiles: ["src/app.ts", "specs/login/plan.md"],
    headSpecs: { login: completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("giữ hỗ trợ nhánh cũ khác tên nhưng có số spec duy nhất", () => {
  const result = run({
    headRef: "feat/006-school-list",
    changedFiles: ["src/app.ts", "specs/006-school-supplier-admin/plan.md"],
    headSpecs: { "006-school-supplier-admin": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("fallback số lịch sử mơ hồ vẫn phải báo lỗi", () => {
  const result = run({
    headRef: "fix/001-other-name",
    changedFiles: ["src/app.ts"],
    headSpecs: { "001-login": completeSpec, "001-menu": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /nhiều thư mục/);
});

test("không chấp nhận tên thư mục spec không hợp lệ qua fallback cũ", () => {
  const result = run({
    headRef: "feat/001-other-name",
    changedFiles: ["src/app.ts"],
    headSpecs: { "001-invalid_name": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /kebab-case/);
});

test("từ chối ánh xạ tên tính năng mơ hồ thay vì chọn spec tùy ý", () => {
  const result = run({
    headRef: "fix/login-token-expiry",
    changedFiles: ["src/app.ts"],
    headSpecs: { "001-login": completeSpec, "002-login": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /nhiều thư mục/);
});

test("ưu tiên thư mục khớp nguyên tên nhánh trước tên chuẩn hóa", () => {
  const result = run({
    headRef: "feat/login",
    changedFiles: ["src/app.ts"],
    headSpecs: { login: completeSpec, "001-login": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("hậu tố mô tả chọn tên tính năng khớp dài nhất", () => {
  const result = run({
    headRef: "fix/login-session-timeout",
    changedFiles: ["src/app.ts"],
    headSpecs: { login: completeSpec, "login-session": completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
  assert.match(result.reason, /specs\/login-session\//);
});

test("hai spec 027 không buộc nhánh source facility đổi số lần nữa", () => {
  const result = run({
    headRef: "feat/027-source-facility-management",
    changedFiles: [
      "src/app.ts",
      "specs/027-source-facility-management/spec.md",
    ],
    headSpecs: {
      "027-grade-specific-menus": completeSpec,
      "027-source-facility-management": completeSpec,
    },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});

test("nhánh không số không được dùng spec không liên quan để vượt gate", () => {
  const result = run({
    changedFiles: ["src/app.ts", "specs/menu/spec.md"],
    headSpecs: { menu: completeSpec },
  });
  assert.equal(result.status, "failed");
});

test("spec không số vẫn bắt buộc đủ file và không còn điểm chưa làm rõ", () => {
  const result = run({
    changedFiles: ["src/app.ts", "specs/login/spec.md"],
    headSpecs: {
      login: {
        "spec.md": "NEEDS CLARIFICATION",
        "plan.md": "# Plan",
      },
    },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /tasks\.md/);
  assert.match(result.errors.join("\n"), /spec\.md/);
});

test("cho phép PR chỉ có spec trên branch docs và kiểm tra cấu trúc", () => {
  const passed = run({
    headRef: "docs/003-report",
    changedFiles: ["specs/003-report/spec.md"],
    headSpecs: { "003-report": completeSpec },
  });
  assert.equal(passed.status, "passed", passed.errors.join("\n"));

  const failed = run({
    headRef: "docs/unrelated-spec",
    changedFiles: ["specs/003-report/spec.md"],
    headSpecs: { "003-report": completeSpec },
  });
  assert.equal(failed.status, "failed");
});

test("chấp nhận PR chỉ có spec không số trên nhánh docs", () => {
  const result = run({
    headRef: "docs/report",
    changedFiles: ["specs/report/spec.md"],
    headSpecs: { report: completeSpec },
  });
  assert.equal(result.status, "passed", result.errors.join("\n"));
});
