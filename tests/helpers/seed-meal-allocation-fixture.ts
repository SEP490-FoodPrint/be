import { getPrisma } from "../../src/utils/database";
import { assertLocalMigrationTarget } from "../../src/utils/migration-target";
import {
  allocationFixtureStates,
  loadAllocationFixture,
} from "./meal-allocation-fixture";

async function main() {
  const [schoolId, kitchenId, teacherId, state] = process.argv.slice(2);
  if (
    !schoolId ||
    !kitchenId ||
    !teacherId ||
    !allocationFixtureStates.some((candidate) => candidate === state)
  )
    throw new Error(
      "Cách dùng: fixture:meal-allocation -- <schoolId> <kitchenId> <teacherId> <cooking|samples|ready>",
    );
  const url = process.env.MEAL_ALLOCATION_FIXTURE_DATABASE_URL;
  if (!url)
    throw new Error(
      "Đặt MEAL_ALLOCATION_FIXTURE_DATABASE_URL cho PostgreSQL test local.",
    );
  const target = assertLocalMigrationTarget(url);
  if (!/^\/foodprint_[a-z0-9_]*test[a-z0-9_]*$/.test(target.pathname))
    throw new Error(
      "Chọn database FoodPrint dành cho test có chữ test trong tên.",
    );
  process.env.DATABASE_URL = target.toString();
  const db = await getPrisma();
  try {
    const fixture = await loadAllocationFixture(
      db,
      schoolId,
      kitchenId,
      teacherId,
      allocationFixtureStates.find((candidate) => candidate === state)!,
    );
    console.log("Fixture 12/11/2026 đã sẵn sàng.", fixture);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
