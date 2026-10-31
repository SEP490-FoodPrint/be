import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export class MigrationDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationDeploymentError";
  }
}

export interface MigrationFile {
  name: string;
  checksum: string;
}

export interface MigrationHistoryRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/** Check deployment configuration before opening a database connection. */
export function assertAzureMigrationTarget(
  databaseUrl: string | undefined,
  expectedHost: string | undefined,
): void {
  if (!databaseUrl || !expectedHost) {
    throw new MigrationDeploymentError(
      "Thiếu secret AZURE_DATABASE_URL hoặc variable AZURE_DATABASE_HOST trong environment azure-dev",
    );
  }
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new MigrationDeploymentError("URL triển khai Azure không hợp lệ");
  }
  const host = expectedHost.trim().toLowerCase();
  if (
    !/^[a-z0-9-]+\.postgres\.database\.azure\.com$/.test(host) ||
    target.hostname !== host ||
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["", "5432"].includes(target.port) ||
    !target.username ||
    !target.password ||
    target.pathname !== "/foodprint_db" ||
    target.searchParams.getAll("schema").length !== 1 ||
    target.searchParams.get("schema") !== "foodprint" ||
    target.searchParams.getAll("sslmode").length !== 1 ||
    !["require", "verify-ca", "verify-full"].includes(
      target.searchParams.get("sslmode") ?? "",
    ) ||
    ["host", "hostaddr", "service", "servicefile"].some((key) =>
      target.searchParams.has(key),
    )
  ) {
    throw new MigrationDeploymentError(
      "Đích triển khai phải khớp AZURE_DATABASE_HOST, database foodprint_db, schema foodprint và bật SSL",
    );
  }
}

export async function readMigrationFiles(): Promise<MigrationFile[]> {
  const directory = path.resolve(__dirname, "../../prisma/migrations");
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names[0] !== "0_init") {
    throw new MigrationDeploymentError("Thiếu baseline 0_init trong Git");
  }
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(path.join(directory, name, "migration.sql")))
        .digest("hex"),
    })),
  );
}

/** Applied migrations must be an unchanged, completed prefix of Git history. */
export function pendingDeploymentMigrations(
  files: readonly MigrationFile[],
  history: readonly MigrationHistoryRow[],
): string[] {
  const applied = history
    .filter((row) => row.rolled_back_at === null)
    .sort((a, b) =>
      a.migration_name < b.migration_name
        ? -1
        : a.migration_name > b.migration_name
          ? 1
          : 0,
    );
  if (applied.some((row) => row.finished_at === null)) {
    throw new MigrationDeploymentError(
      "Có migration lỗi/chưa hoàn tất; cần xử lý thủ công trước khi deploy tiếp",
    );
  }
  if (files[0]?.name !== "0_init" || applied[0]?.migration_name !== "0_init") {
    throw new MigrationDeploymentError(
      "Database chưa nhận baseline 0_init; CD không tự nhận baseline hoặc tạo database mới",
    );
  }
  for (let index = 0; index < applied.length; index++) {
    const file = files[index];
    const row = applied[index];
    if (!file || file.name !== row.migration_name) {
      throw new MigrationDeploymentError(
        "Lịch sử database khác thứ tự migration trong Git; có file bị xóa, thiếu hoặc database đã đi trước commit này",
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationDeploymentError(
        "SQL của migration đã applied bị thay đổi; giữ migration cũ bất biến và tạo migration mới",
      );
    }
  }
  return files.slice(applied.length).map((file) => file.name);
}
