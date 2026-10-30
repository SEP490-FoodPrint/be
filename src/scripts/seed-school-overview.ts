import { requireDatabaseUrl } from "../config/env";
import { assertAzureMigrationTarget } from "../utils/migration-deployment";
import { assertLocalMigrationTarget } from "../utils/migration-target";
import { getPrisma } from "../utils/database";

const schoolId = "10000000-0000-4000-8000-000000000001";
const adminId = "20000000-0000-4000-8000-000000000003";
const boardId = "20000000-0000-4000-8000-000000000002";
const stableId = (namespace: number, index: number) =>
  `${namespace}000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

async function main() {
  if (process.argv.includes("--azure")) {
    assertAzureMigrationTarget(
      requireDatabaseUrl(),
      process.env.AZURE_DATABASE_HOST,
    );
  } else {
    assertLocalMigrationTarget(requireDatabaseUrl());
  }
  const db = await getPrisma();
  try {
    if (
      !(await db.school.findUnique({
        where: { id: schoolId },
        select: { id: true },
      }))
    ) {
      throw new Error(
        "Chạy db:seed:menu trước để tạo trường và tài khoản test.",
      );
    }
    await db.$transaction(
      async (tx) => {
        const templateDays = await tx.menuDay.findMany({
          where: { weeklyMenuId: "43000000-0000-4000-8000-000000000001" },
          orderBy: { menuDate: "asc" },
          include: { menuDayDishes: true },
        });
        // createMany/skipDuplicates makes repeat runs preserve reviews and edits.
        const weeks = [
          {
            status: "APPROVED",
            date: "2026-10-12",
            title: "[TEST] Thực đơn tuần 42",
          },
          {
            status: "REVISION_REQUIRED",
            date: "2026-10-19",
            title: "[TEST] Thực đơn tuần 43",
          },
          {
            status: "PENDING_APPROVAL",
            date: "2026-11-02",
            title: "[TEST] Thực đơn tuần 45",
          },
        ] as const;
        for (const [index, week] of weeks.entries()) {
          const menuId = stableId(71, index + 1);
          await tx.weeklyMenu.createMany({
            data: [
              {
                id: menuId,
                schoolId,
                createdByUserId: adminId,
                weekStartDate: new Date(week.date),
                title: week.title,
                status: week.status,
                submittedAt: new Date(`${week.date}T01:00:00Z`),
                approvedAt:
                  week.status === "APPROVED"
                    ? new Date(`${week.date}T02:00:00Z`)
                    : null,
              },
            ],
            skipDuplicates: true,
          });
          for (let day = 0; day < 5; day++) {
            const menuDate = new Date(week.date);
            menuDate.setUTCDate(menuDate.getUTCDate() + day);
            await tx.menuDay.createMany({
              data: [
                {
                  id: stableId(72, index * 5 + day + 1),
                  weeklyMenuId: menuId,
                  menuDate,
                  approvalStatus: week.status,
                },
              ],
              skipDuplicates: true,
            });
            const dishes = templateDays[day]?.menuDayDishes || [];
            await tx.menuDayDish.createMany({
              data: dishes.map((dish) => ({
                menuDayId: stableId(72, index * 5 + day + 1),
                dishId: dish.dishId,
                mealType: dish.mealType,
                portionSize: dish.portionSize,
                portionUnit: dish.portionUnit,
                displayOrder: dish.displayOrder,
              })),
              skipDuplicates: true,
            });
            if (week.status !== "PENDING_APPROVAL") {
              await tx.menuReviewRecord.createMany({
                data: [
                  {
                    id: stableId(78, index * 5 + day + 1),
                    weeklyMenuId: menuId,
                    menuDayId: stableId(72, index * 5 + day + 1),
                    reviewerUserId: boardId,
                    decision:
                      week.status === "APPROVED"
                        ? "APPROVED"
                        : "REVISION_REQUESTED",
                    feedback:
                      week.status === "APPROVED"
                        ? "[TEST] Đã phê duyệt thực đơn."
                        : "[TEST] Đề nghị cân đối lại khẩu phần.",
                    reviewedAt: new Date(`${week.date}T02:00:00Z`),
                  },
                ],
                skipDuplicates: true,
              });
            }
          }
        }
        await tx.class.createMany({
          data: [
            {
              id: stableId(73, 1),
              schoolId,
              name: "[TEST] Lớp 3A1",
              academicYear: "2026-2027",
              registeredMealPortions: 35,
            },
          ],
          skipDuplicates: true,
        });
        await tx.dailyMealPortion.createMany({
          data: [
            {
              id: stableId(74, 1),
              classId: stableId(73, 1),
              confirmedByUserId: adminId,
              mealDate: new Date("2026-10-28"),
              mealType: "LUNCH",
              totalPortions: 35,
              status: "FINALIZED",
              finalizedAt: new Date("2026-10-28T02:00:00Z"),
            },
          ],
          skipDuplicates: true,
        });
        await tx.mealAllocation.createMany({
          data: [
            {
              id: stableId(75, 1),
              dailyMealPortionId: stableId(74, 1),
              createdByUserId: adminId,
              status: "DISTRIBUTED",
              allocatedAt: new Date("2026-10-28T03:00:00Z"),
              distributedAt: new Date("2026-10-28T04:00:00Z"),
              distributedByUserId: adminId,
              note: "[TEST] Suất ăn phục vụ kiểm thử Tổng quan",
            },
          ],
          skipDuplicates: true,
        });
        const complaints = [
          {
            complaintType: "MEAL_QUALITY",
            status: "SUBMITTED",
            description: "[TEST] Cần kiểm tra độ mềm của cơm.",
          },
          {
            complaintType: "FOOD_HYGIENE",
            status: "IN_REVIEW",
            description: "[TEST] Kiểm tra khâu vệ sinh khay ăn.",
          },
          {
            complaintType: "OTHER",
            status: "RESOLVED",
            description: "[TEST] Đề nghị điều chỉnh thời gian phát suất ăn.",
          },
        ] as const;
        for (const [index, complaint] of complaints.entries()) {
          await tx.mealComplaint.createMany({
            data: [
              {
                id: stableId(76, index + 1),
                mealAllocationId: stableId(75, 1),
                submittedByUserId: adminId,
                ...complaint,
                submittedAt: new Date("2026-10-28T05:00:00Z"),
                ...(complaint.status === "RESOLVED"
                  ? {
                      handledByUserId: boardId,
                      resolution: "[TEST] Đã điều chỉnh lịch phục vụ.",
                      resolvedAt: new Date("2026-10-29T05:00:00Z"),
                    }
                  : {}),
              },
            ],
            skipDuplicates: true,
          });
        }
        await tx.foodSafetyIncident.createMany({
          data: [
            {
              id: stableId(77, 1),
              schoolId,
              reportedByUserId: boardId,
              title: "[TEST] Kiểm tra điều kiện bảo quản",
              description: "Tình huống giả lập phục vụ kiểm thử.",
              status: "INVESTIGATING",
              occurredAt: new Date("2026-10-28T03:00:00Z"),
            },
            {
              id: stableId(77, 2),
              schoolId,
              reportedByUserId: boardId,
              title: "[TEST] Kiểm tra khu vực chia suất",
              description: "Tình huống giả lập đã xử lý.",
              status: "RESOLVED",
              occurredAt: new Date("2026-09-15T03:00:00Z"),
              resolvedAt: new Date("2026-09-16T03:00:00Z"),
            },
          ],
          skipDuplicates: true,
        });
      },
      { maxWait: 5_000, timeout: 60_000 },
    );
    console.log(
      "Đã bổ sung dữ liệu test Tổng quan; giữ nguyên bản ghi đã tồn tại.",
    );
  } finally {
    await db.$disconnect();
  }
}

void main().catch(() => {
  console.error(
    "Seed Tổng quan chưa hoàn tất. Kiểm tra đích DB, migration và dữ liệu phụ thuộc.",
  );
  process.exitCode = 1;
});
