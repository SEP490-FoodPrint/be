/** Development migrations and their shadow databases must remain local. */
export function assertLocalMigrationTarget(connectionString: string): URL {
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error("URL database cho migration không hợp lệ");
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.pathname.length <= 1 ||
    ["host", "hostaddr", "service"].some((key) => target.searchParams.has(key))
  ) {
    throw new Error(
      "Migration development chỉ được chạy trên PostgreSQL local. Đặt DATABASE_URL local cho riêng lệnh; không dùng Azure.",
    );
  }
  return target;
}
