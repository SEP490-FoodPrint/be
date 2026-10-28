import { defineConfig } from "prisma/config";
import { requireDatabaseUrl } from "./src/config/env";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: requireDatabaseUrl() },
});
