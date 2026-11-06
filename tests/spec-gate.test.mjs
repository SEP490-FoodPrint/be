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
    headRef: "feat/001-login",
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
    "feat/login",
    "chore/001-login",
    "docs/001-login",
    "feat/1-login",
  ]) {
    const result = run({
      headRef,
      changedFiles: ["src/app.ts"],
      headSpecs: { "001-login": completeSpec },
    });
    assert.equal(result.status, "failed", headRef);
  }
});

test("từ chối khi không có thư mục spec cùng số", () => {
  const result = run({
    changedFiles: ["src/app.ts"],
    headSpecs: { "002-menu": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /specs\/001-\*/);
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

test("từ chối khi hai thư mục spec trùng số", () => {
  const result = run({
    changedFiles: ["src/app.ts"],
    headSpecs: { "001-login": completeSpec, "001-menu": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /nhiều thư mục/);
});

test("từ chối khi PR sửa spec khác số với branch", () => {
  const result = run({
    changedFiles: ["src/app.ts", "specs/002-menu/plan.md"],
    headSpecs: { "001-login": completeSpec, "002-menu": completeSpec },
  });
  assert.equal(result.status, "failed");
  assert.match(result.errors.join("\n"), /specs\/002-menu/);
});

test("cho phép PR chỉ có spec trên branch docs và kiểm tra cấu trúc", () => {
  const passed = run({
    headRef: "docs/003-report",
    changedFiles: ["specs/003-report/spec.md"],
    headSpecs: { "003-report": completeSpec },
  });
  assert.equal(passed.status, "passed", passed.errors.join("\n"));

  const failed = run({
    headRef: "docs/report-spec",
    changedFiles: ["specs/003-report/spec.md"],
    headSpecs: { "003-report": completeSpec },
  });
  assert.equal(failed.status, "failed");
});
