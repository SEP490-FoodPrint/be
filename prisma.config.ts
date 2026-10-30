import { defineConfig } from "prisma/config";
import { requireDatabaseUrl } from "./src/config/env";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: requireDatabaseUrl() },
});
