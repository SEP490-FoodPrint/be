const path = require("node:path");
process.chdir(path.resolve(__dirname, "../.."));
require("dotenv").config({ quiet: true });
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const original = new URL(process.env.DATABASE_URL);
const name = "foodprint_units_test_" + randomUUID().replaceAll("-", "");
if (
  !original.hostname.endsWith(".postgres.database.azure.com") ||
  !/^foodprint_units_test_[a-f0-9]{32}$/.test(name)
)
  throw new Error("Unexpected test target");
const target = new URL(original);
target.pathname = "/" + name;
target.searchParams.set("schema", "foodprint");
const owner = new Client({
  connectionString: original.toString(),
  connectionTimeoutMillis: 10000,
});
fs.mkdirSync("node_modules/.cache/foodprint-prisma", { recursive: true });
let created = false;
const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  NODE_ENV: "test",
  JWT_SECRET: "material-integration-test-only",
  BLOCKCHAIN_ENABLED: "false",
  TEMP: path.resolve("node_modules/.cache/foodprint-prisma"),
  TMP: path.resolve("node_modules/.cache/foodprint-prisma"),
  FOODPRINT_OWNED_UNIT_DATABASE: name,
};
const redact = (text) => {
  const output = text
    .replaceAll(original.toString(), "[application database]")
    .replaceAll(target.toString(), "[isolated test database]");
  const password = decodeURIComponent(original.password);
  return password ? output.replaceAll(password, "[redacted]") : output;
};
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      fs.appendFileSync(
        "node_modules/.cache/cloud-units-results.log",
        redact(output),
      );
      console.log(redact(output).split("\n").slice(-28).join("\n"));
      code === 0
        ? resolve()
        : reject(new Error("Test subprocess exit " + code));
    });
  });
}
(async () => {
  try {
    await owner.connect();
    await owner.query('CREATE DATABASE "' + name + '"');
    created = true;
    fs.writeFileSync(
      "node_modules/.cache/cloud-units-manifest.json",
      JSON.stringify({ name, host: original.hostname, created: true }),
    );
    fs.writeFileSync("node_modules/.cache/cloud-units-results.log", "");
    console.log("Created isolated cloud test database", name);
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
    await run([
      "--import",
      "tsx",
      "--test",
      "tests/measurement-unit.integration.test.ts",
    ]);
    console.log("PASS cloud migration and measurement-unit integration");
  } catch (error) {
    console.error("Cloud test failed:", error.code || error.message);
    process.exitCode = 1;
  } finally {
    if (created) {
      const result = await owner.query(
        "SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=$1",
        [name],
      );
      if (result.rows[0]?.owned === true) {
        await owner.query('DROP DATABASE "' + name + '" WITH (FORCE)');
        console.log("Removed own isolated cloud test database");
        fs.writeFileSync(
          "node_modules/.cache/cloud-units-manifest.json",
          JSON.stringify({
            name,
            host: original.hostname,
            created: true,
            removed: true,
          }),
        );
      } else {
        console.error("Cleanup blocked: ownership changed");
        process.exitCode = 1;
      }
    }
    await owner.end();
  }
})();
