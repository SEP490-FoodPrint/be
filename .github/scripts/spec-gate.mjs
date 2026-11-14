// Spec gate: PR thay đổi src/** hoặc prisma/** phải kèm specs/<feature-slug>/ hợp lệ; tên cũ có số vẫn được hỗ trợ.
// Quy tắc được mô tả trong contribute.md (mục Quy trình Spec-Driven) và
// .specify/memory/constitution.md (nguyên tắc VI).
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CODE_PATH_PREFIXES = ["src/", "prisma/"];
export const CODE_BRANCH_TYPES = ["feat", "fix", "refactor", "perf"];
export const SPEC_ONLY_BRANCH_TYPES = [...CODE_BRANCH_TYPES, "docs"];
export const REQUIRED_SPEC_FILES = ["spec.md", "plan.md", "tasks.md"];
export const CLARIFICATION_MARKER = "NEEDS CLARIFICATION";
// Chỉ kiểm tra dấu chưa rõ trong spec/plan; research.md hay checklists có thể
// nhắc tới cụm từ này khi ghi lại các câu hỏi đã được giải quyết.
export const CLARIFICATION_CHECKED_FILES = ["spec.md", "plan.md"];

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SPEC_DIR_PATTERN = new RegExp("^" + SLUG + "$");
const LEGACY_PREFIX = /^\d{3}-/;

function branchPattern(types) {
  return new RegExp("^(" + types.join("|") + ")/(" + SLUG + ")$");
}

function featureName(name) {
  return name.replace(LEGACY_PREFIX, "");
}

/** Prefer feature names; retain numeric lookup only for legacy branch names. */
function matchingSpecDirs(branchSlug, headSpecs) {
  const dirs = Object.keys(headSpecs).sort();
  if (dirs.includes(branchSlug)) return [branchSlug];

  const name = featureName(branchSlug);
  const exactNames = dirs.filter((dir) => featureName(dir) === name);
  if (exactNames.length) return exactNames;

  const descriptions = dirs.filter((dir) =>
    name.startsWith(featureName(dir) + "-"),
  );
  if (descriptions.length) {
    const longest = Math.max(
      ...descriptions.map((dir) => featureName(dir).length),
    );
    return descriptions.filter((dir) => featureName(dir).length === longest);
  }

  const legacy = LEGACY_PREFIX.exec(branchSlug);
  return legacy ? dirs.filter((dir) => dir.startsWith(legacy[0])) : [];
}

function specDirOf(filePath) {
  const match = /^specs\/([^/]+)\//.exec(filePath);
  return match ? match[1] : null;
}

/**
 * Đánh giá spec gate từ dữ liệu đã thu thập (hàm thuần, dùng cho unit test).
 *
 * @param {object} input
 * @param {string} input.headRef Tên branch nguồn của PR.
 * @param {string} input.baseRef Tên branch đích của PR.
 * @param {string[]} input.changedFiles Đường dẫn file thay đổi trong PR (so với merge base).
 * @param {Record<string, Record<string, string>>} input.headSpecs
 *   Nội dung `specs/` ở commit head: tên thư mục → (tên file .md → nội dung).
 * @returns {{ status: "skipped" | "passed" | "failed", reason: string, errors: string[] }}
 */
export function evaluateSpecGate({
  headRef,
  baseRef,
  changedFiles,
  headSpecs,
}) {
  if (headRef === "dev" && baseRef === "main") {
    return { status: "skipped", reason: "PR promote dev → main.", errors: [] };
  }
  if (headRef.startsWith("revert/")) {
    return {
      status: "skipped",
      reason: "Branch revert/* được miễn spec.",
      errors: [],
    };
  }

  const touchesCode = changedFiles.some((file) =>
    CODE_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
  const touchedSpecDirs = [
    ...new Set(changedFiles.map(specDirOf).filter((dir) => dir !== null)),
  ];

  if (!touchesCode && touchedSpecDirs.length === 0) {
    return {
      status: "skipped",
      reason: "PR không thay đổi src/**, prisma/** hay specs/**.",
      errors: [],
    };
  }

  const errors = [];
  const allowedTypes = touchesCode ? CODE_BRANCH_TYPES : SPEC_ONLY_BRANCH_TYPES;
  const branchMatch = branchPattern(allowedTypes).exec(headRef);

  if (!branchMatch) {
    const example = `${allowedTypes[0]}/ten-tinh-nang`;
    errors.push(
      touchesCode
        ? `PR thay đổi src/** hoặc prisma/** nên branch phải có dạng <${allowedTypes.join("|")}>/<feature-slug> (ví dụ ${example}); branch hiện tại: "${headRef}".`
        : `PR thay đổi specs/** nên branch phải có dạng <${allowedTypes.join("|")}>/<feature-slug>; branch hiện tại: "${headRef}".`,
    );
    return { status: "failed", reason: "Tên branch không hợp lệ.", errors };
  }

  const branchSlug = branchMatch[2];
  const matchingDirs = matchingSpecDirs(branchSlug, headSpecs);

  if (matchingDirs.length === 0) {
    errors.push(
      "Không tìm thấy thư mục spec tương ứng với nhánh " +
        headRef +
        ". Dùng specs/" +
        featureName(branchSlug) +
        "/ hoặc tên spec cũ có số; commit đủ spec.md, plan.md, tasks.md.",
    );
  } else if (matchingDirs.length > 1) {
    errors.push(
      "Nhánh " +
        headRef +
        " khớp nhiều thư mục: " +
        matchingDirs.map((dir) => "specs/" + dir + "/").join(", ") +
        ". Dùng tên nhánh khớp nguyên tên thư mục spec để phân biệt.",
    );
  }

  for (const dir of touchedSpecDirs) {
    if (!matchingDirs.includes(dir)) {
      errors.push(
        "PR chỉ được sửa spec của tính năng tương ứng với nhánh " +
          headRef +
          "; đang sửa specs/" +
          dir +
          "/.",
      );
    }
  }

  if (matchingDirs.length === 1) {
    const dir = matchingDirs[0];
    const files = headSpecs[dir];

    if (!SPEC_DIR_PATTERN.test(dir)) {
      errors.push(
        `Tên thư mục specs/${dir}/ phải là kebab-case (chữ thường a-z, số, dấu -); không bắt buộc số thứ tự.`,
      );
    }

    for (const required of REQUIRED_SPEC_FILES) {
      if (!(required in files)) {
        errors.push(
          `Thiếu specs/${dir}/${required}. Chạy đủ $speckit-specify → $speckit-plan → $speckit-tasks.`,
        );
      }
    }

    for (const name of CLARIFICATION_CHECKED_FILES) {
      if (files[name]?.includes(CLARIFICATION_MARKER)) {
        errors.push(
          `specs/${dir}/${name} còn mục "${CLARIFICATION_MARKER}". Giải quyết bằng $speckit-clarify (spec) hoặc chạy lại $speckit-plan trước khi merge.`,
        );
      }
    }
  }

  return errors.length > 0
    ? { status: "failed", reason: "Spec chưa đạt yêu cầu.", errors }
    : {
        status: "passed",
        reason: `Spec specs/${matchingDirs[0]}/ hợp lệ cho branch ${headRef}.`,
        errors,
      };
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function lines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Đọc toàn bộ file .md trong specs/ ở commit head. */
export function collectHeadSpecs(headSha) {
  const headSpecs = {};
  const files = lines(
    git(["ls-tree", "-r", "--name-only", headSha, "--", "specs/"]),
  );

  for (const file of files) {
    const match = /^specs\/([^/]+)\/(.+\.md)$/.exec(file);
    if (!match) continue;
    const [, dir, name] = match;
    headSpecs[dir] ??= {};
    headSpecs[dir][name] = git(["show", `${headSha}:${file}`]);
  }

  return headSpecs;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Thiếu biến môi trường ${name}.`);
  }
  return value;
}

function main() {
  const baseSha = requireEnv("SPEC_GATE_BASE_SHA");
  const headSha = requireEnv("SPEC_GATE_HEAD_SHA");
  const headRef = requireEnv("SPEC_GATE_HEAD_REF");
  const baseRef = requireEnv("SPEC_GATE_BASE_REF");

  const changedFiles = lines(
    git(["diff", "--name-only", "--no-renames", `${baseSha}...${headSha}`]),
  );
  const result = evaluateSpecGate({
    headRef,
    baseRef,
    changedFiles,
    headSpecs: collectHeadSpecs(headSha),
  });

  const report = [
    `Spec gate: ${result.status.toUpperCase()} — ${result.reason}`,
    ...result.errors.map((error) => `- ${error}`),
  ].join("\n");
  console.log(report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
