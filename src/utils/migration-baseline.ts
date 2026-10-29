import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  catalogFingerprint,
  migrationCatalogQueries,
  type CatalogSection,
} from "./migration-catalog";

/** Verify catalog structure, including CHECKs that Prisma schema diff omits. */
export async function verifyBaseline(
  query: (sql: string) => Promise<unknown[]>,
): Promise<string> {
  const root = path.resolve(__dirname, "../..");
  const manifest: unknown = JSON.parse(
    await readFile(path.join(root, "prisma/baseline.manifest.json"), "utf8"),
  );
  assert(manifest !== null && typeof manifest === "object");
  assert("migration" in manifest && manifest.migration === "0_init");
  assert("sqlSha256" in manifest && typeof manifest.sqlSha256 === "string");
  assert(
    "fingerprints" in manifest &&
      manifest.fingerprints !== null &&
      typeof manifest.fingerprints === "object",
  );
  const sql = await readFile(
    path.join(root, "prisma/migrations/0_init/migration.sql"),
  );
  assert.equal(
    createHash("sha256").update(sql).digest("hex"),
    manifest.sqlSha256,
    "Baseline SQL đã đổi; cần review lại baseline và manifest trước khi tiếp tục",
  );
  const mismatches: CatalogSection[] = [];
  for (const section of Object.keys(
    migrationCatalogQueries,
  ) as CatalogSection[]) {
    const expected: unknown = Reflect.get(manifest.fingerprints, section);
    assert(typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected));
    if (
      catalogFingerprint(await query(migrationCatalogQueries[section])) !==
      expected
    ) {
      mismatches.push(section);
    }
  }
  assert.equal(
    mismatches.length,
    0,
    `Database khác baseline ở: ${mismatches.join(", ")}. Không đánh dấu baseline applied.`,
  );
  return manifest.sqlSha256;
}
