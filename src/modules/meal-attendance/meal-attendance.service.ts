import type { AuthPrincipal } from "../../types/auth";
import { listScopes } from "../../utils/resource-access";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  assertPermission,
  withSchoolTransaction,
} from "../../utils/authorization";
import { HttpError } from "../../utils/http-error";
import type {
  MealSummaryQuery,
  DailyPortionGroupsInput,
  DailyMealPortionInput,
} from "./meal-attendance.validation";
import { assertPortionGroupSafety } from "../kitchen/kitchen.service";
import {
  allergyCountsFromGroups,
  splitPortionsIntoGroups,
} from "../../utils/allergy-match";
import { getPrisma } from "../../utils/database";
import {
  listWindow,
  readListPage,
  type ListQuery,
} from "../../utils/list-query";
import { currentAcademicYear } from "../class/academic-year";
import { expandMenuHolidays } from "../../utils/menu-week";
import {
  mealAttendanceRepository,
  type MealAttendanceRepository,
} from "./meal-attendance.repository";

const select = {
  id: true,
  classId: true,
  confirmedByUserId: true,
  mealDate: true,
  mealType: true,
  totalPortions: true,
  status: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
  Class: { select: { name: true, academicYear: true } },
  dailyAllergyPortions: {
    select: { ingredientEntryId: true, portionCount: true },
  },
} as const satisfies Prisma.DailyMealPortionSelect;

type ListRow = Prisma.DailyMealPortionGetPayload<{ select: typeof select }>;
type ListArguments = Pick<
  Prisma.DailyMealPortionFindManyArgs,
  "skip" | "take" | "orderBy" | "where"
> & {
  select: typeof select;
};
type ListReader = (args: ListArguments) => Promise<ListRow[]>;

const readFromDatabase: ListReader = async (args) => {
  const prisma = await getPrisma();
  return prisma.dailyMealPortion.findMany(args);
};

/**
 * Sau khi GVCN chốt sĩ số: nếu thực đơn của bữa đã duyệt và có nhóm suất, tự ghi phần chia nhóm
 * (suất dị ứng GVCN khai lúc điểm danh -> nhóm suất riêng; còn lại -> nhóm thường) để bếp chế biến được.
 * Thực đơn chưa duyệt / chưa có nhóm suất / đã chia rồi thì bỏ qua.
 */
export async function autoSplitPortionGroups(
  tx: Prisma.TransactionClient,
  dailyMealPortionId: string,
  userId: string,
  schoolId: string,
) {
  const demand = await tx.dailyMealPortion.findUniqueOrThrow({
    where: { id: dailyMealPortionId },
    select: {
      classId: true,
      mealDate: true,
      mealType: true,
      totalPortions: true,
      status: true,
      _count: { select: { portionGroups: true } },
      dailyAllergyPortions: {
        select: {
          ingredientEntryId: true,
          portionCount: true,
          ClassAllergy: {
            select: {
              IngredientEntry: {
                select: { Ingredient: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (demand.status !== "FINALIZED" || demand._count.portionGroups) return;
  const day = await tx.menuDay.findFirst({
    where: {
      menuDate: demand.mealDate,
      approvalStatus: "APPROVED",
      WeeklyMenu: {
        schoolId,
        OR: [
          { isSchoolWide: true },
          {
            grades: {
              some: { grade: { classes: { some: { id: demand.classId } } } },
            },
          },
        ],
      },
    },
    select: { id: true },
  });
  if (!day) return;
  const groups = await assertPortionGroupSafety(
    tx,
    { menuDayId: day.id, mealType: demand.mealType },
    schoolId,
  );
  if (!groups.length) return;
  const counts = splitPortionsIntoGroups(
    groups,
    demand.totalPortions,
    demand.dailyAllergyPortions.map((a) => ({
      ingredientEntryId: a.ingredientEntryId,
      allergenName: a.ClassAllergy.IngredientEntry.Ingredient.name,
      portionCount: a.portionCount,
    })),
  );
  if (!counts)
    throw new HttpError(
      422,
      "Số suất dị ứng đã khai vượt sĩ số đã chốt của lớp",
    );
  for (const [portionGroupId, portionCount] of counts)
    await tx.dailyMealPortionGroup.create({
      data: {
        dailyMealPortionId,
        portionGroupId,
        portionCount,
        confirmedByUserId: userId,
      },
    });
}

export function createMealAttendanceService(
  read: ListReader = readFromDatabase,
  connect: () => Promise<PrismaClient> = getPrisma,
  repository: MealAttendanceRepository = mealAttendanceRepository,
  clock: () => Date = () => new Date(),
) {
  /** Ngày hôm nay theo giờ Việt Nam (UTC+7), dạng YYYY-MM-DD. */
  const vietnamToday = () =>
    new Date(clock().getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const dmy = (iso: string) => iso.split("-").reverse().join("/");

  /** GVCN chỉ khai/chốt cho hôm nay, đúng ngày học có thực đơn bữa đó cho lớp. */
  async function assertDeclarableDay(
    db: Prisma.TransactionClient,
    key: {
      schoolId: string;
      classId: string;
      date: Date;
      mealType: "LUNCH" | "AFTERNOON";
    },
  ) {
    const iso = key.date.toISOString().slice(0, 10);
    const today = vietnamToday();
    if (iso !== today)
      throw new HttpError(
        422,
        `Chỉ được khai và chốt suất ăn cho hôm nay (${dmy(today)})`,
      );
    const weekday = key.date.getUTCDay();
    if (weekday === 0 || weekday === 6)
      throw new HttpError(422, "Thứ Bảy, Chủ nhật không có bữa bán trú");
    const year = await repository.findAcademicYearOn(
      db,
      key.schoolId,
      key.date,
    );
    if (!year)
      throw new HttpError(422, "Hôm nay nằm ngoài năm học đã cấu hình");
    const holiday = expandMenuHolidays(year.holidays, iso, iso)[0];
    if (holiday)
      throw new HttpError(
        422,
        `Hôm nay là ngày nghỉ${holiday.reason ? ` (${holiday.reason})` : ""}, không khai suất ăn`,
      );
    if (!(await repository.findClassMenuDay(db, key)))
      throw new HttpError(
        422,
        `Hôm nay chưa có thực đơn ${key.mealType === "LUNCH" ? "bữa trưa" : "bữa xế"} cho khối của lớp`,
      );
  }

  async function assignedClass(
    db: Prisma.TransactionClient,
    principal: AuthPrincipal,
    date: Date,
  ) {
    if (
      principal.role !== "HOMEROOM_TEACHER" ||
      principal.orgType !== "SCHOOL" ||
      !principal.schoolId
    )
      throw new HttpError(403, "Chỉ GVCN được khai báo suất ăn của lớp");
    const assignment = await repository.findAssignedClass(
      db,
      principal.id,
      principal.schoolId,
      currentAcademicYear(date),
    );
    if (!assignment)
      throw new HttpError(
        404,
        "GVCN chưa được phân công lớp trong niên khóa của ngày đã chọn",
      );
    return assignment.Class;
  }

  async function owned(
    db: Prisma.TransactionClient,
    id: string,
    principal: AuthPrincipal,
  ) {
    if (principal.orgType !== "SCHOOL" || !principal.schoolId)
      throw new HttpError(403, "C岷 ph岷 vi tr瓢峄漬g");
    const demand = await db.dailyMealPortion.findFirst({
      where: { id, Class: { schoolId: principal.schoolId } },
      include: { portionGroups: true, dailyAllergyPortions: true },
    });
    if (!demand)
      throw new HttpError(404, "Kh么ng t矛m th岷 su岷 膬n c峄 l峄沺");
    if (principal.role === "HOMEROOM_TEACHER") {
      const assignment = await db.classHomeroomAssignment.findFirst({
        where: {
          classId: demand.classId,
          teacherUserId: principal.id,
          endedAt: null,
        },
        select: { id: true },
      });
      if (!assignment)
        throw new HttpError(403, "GVCN chỉ thao tác lớp đang được phân công");
    }
    return demand;
  }
  return {
    async getMyClass(query: MealSummaryQuery, principal: AuthPrincipal) {
      assertPermission(principal, "daily_meal_portion.view");
      const db = await connect();
      const assigned = await assignedClass(db, principal, query.date);
      const submission = await repository.findSubmission(db, {
        classId: assigned.id,
        mealDate: query.date,
        mealType: query.mealType,
      });
      return { class: assigned, submission };
    },

    async saveDraft(input: DailyMealPortionInput, principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "daily_meal_portion.update",
        async (tx, actor) => {
          const assigned = await assignedClass(tx, actor, input.date);
          if (input.totalPortions > assigned.registeredMealPortions)
            throw new HttpError(
              422,
              `Số suất (${input.totalPortions}) vượt số suất đăng ký của lớp (${assigned.registeredMealPortions})`,
            );
          await assertDeclarableDay(tx, {
            schoolId: actor.schoolId!,
            classId: assigned.id,
            date: input.date,
            mealType: input.mealType,
          });
          for (const allergy of input.allergies) {
            const master = assigned.classAllergies.find(
              (item) => item.ingredientEntryId === allergy.ingredientEntryId,
            );
            if (!master || allergy.portionCount > master.affectedCount)
              throw new HttpError(
                422,
                "Số suất dị ứng vượt thông tin dị ứng tổng hợp của lớp",
              );
          }
          const key = {
            classId: assigned.id,
            mealDate: input.date,
            mealType: input.mealType,
          };
          const existing = await repository.findSubmissionState(tx, key);
          if (existing?.status === "FINALIZED")
            throw new HttpError(
              409,
              "Suất ăn đã chốt, không thể sửa trực tiếp",
            );
          const data = {
            confirmedByUserId: actor.id,
            totalPortions: input.totalPortions,
            allergyNotes: input.allergyNotes,
          };
          const demand = await repository.saveDraft(
            tx,
            existing?.id ?? null,
            key,
            data,
          );
          await repository.replaceAllergies(
            tx,
            demand.id,
            assigned.id,
            input.allergies,
          );
          return repository.getSubmissionById(tx, demand.id);
        },
      );
    },

    async finalize(id: string, principal: AuthPrincipal) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "daily_meal_portion.update",
        async (tx, actor) => {
          if (actor.role !== "HOMEROOM_TEACHER")
            throw new HttpError(403, "Chỉ GVCN được chốt suất ăn của lớp");
          const demand = await owned(tx, id, actor);
          if (demand.status === "FINALIZED") return demand;
          await assertDeclarableDay(tx, {
            schoolId: actor.schoolId!,
            classId: demand.classId,
            date: demand.mealDate,
            mealType: demand.mealType,
          });
          const finalized = await repository.finalizeSubmission(
            tx,
            id,
            actor.id,
            new Date(),
          );
          await autoSplitPortionGroups(tx, id, actor.id, actor.schoolId!);
          return finalized;
        },
      );
    },

    async getPortionGroups(id: string, principal: AuthPrincipal) {
      assertPermission(principal, "daily_meal_portion.view");
      const db = await connect(),
        demand = await owned(db, id, principal);
      const groups = await db.menuMealPortionGroup.findMany({
        where: {
          menuDay: {
            menuDate: demand.mealDate,
            WeeklyMenu: {
              schoolId: principal.schoolId!,
              OR: [
                { isSchoolWide: true },
                {
                  grades: {
                    some: {
                      grade: { classes: { some: { id: demand.classId } } },
                    },
                  },
                },
              ],
            },
          },
          mealType: demand.mealType,
        },
        include: {
          dishes: { select: { dishId: true } },
          avoidances: { select: { ingredientEntryId: true } },
        },
        orderBy: { id: "asc" },
      });
      return {
        dailyMealPortionId: id,
        totalPortions: demand.totalPortions,
        groups,
        counts: demand.portionGroups,
        dailyAllergyPortions: demand.dailyAllergyPortions,
      };
    },
    async savePortionGroups(
      id: string,
      input: DailyPortionGroupsInput,
      principal: AuthPrincipal,
    ) {
      return withSchoolTransaction(
        await connect(),
        principal,
        "daily_meal_portion.update",
        async (tx, actor, schoolId) => {
          if (actor.role !== "HOMEROOM_TEACHER")
            throw new HttpError(
              403,
              "Ch峄?GVCN ch峄憈 s峄?su岷 nh贸m c峄 l峄沺",
            );
          const demand = await owned(tx, id, actor);
          if (demand.status !== "FINALIZED")
            throw new HttpError(
              409,
              "C岷 ch峄憈 t峄昻g s峄?su岷 c峄 l峄沺 tr瓢峄沜",
            );
          const meal = {
            menuDayId: input.menuDayId,
            mealType: demand.mealType,
          };
          const day = await tx.menuDay.findFirst({
            where: {
              id: input.menuDayId,
              menuDate: demand.mealDate,
              WeeklyMenu: {
                schoolId,
                OR: [
                  { isSchoolWide: true },
                  {
                    grades: {
                      some: {
                        grade: { classes: { some: { id: demand.classId } } },
                      },
                    },
                  },
                ],
              },
            },
            select: { approvalStatus: true },
          });
          if (!day)
            throw new HttpError(
              404,
              "Ng脿y th峄眂 膽啤n kh么ng kh峄沺 su岷 膬n c峄 l峄沺",
            );
          if (day.approvalStatus !== "APPROVED")
            throw new HttpError(
              409,
              "Ch峄?ch峄憈 nh贸m su岷 cho ng脿y th峄眂 膽啤n 膽茫 duy峄噒",
            );
          const groups = await assertPortionGroupSafety(tx, meal, schoolId);
          if (
            groups.length !== input.groups.length ||
            groups.some(
              (g) => !input.groups.some((i) => i.portionGroupId === g.id),
            ) ||
            input.groups.reduce((n, g) => n + g.portionCount, 0) !==
              demand.totalPortions
          )
            throw new HttpError(
              422,
              "C谩c nh贸m ph岷 膽岷 膽峄? kh么ng tr霉ng v脿 c峄檔g 膽煤ng t峄昻g s峄?su岷 l峄沺",
            );
          if (
            demand.portionGroups.some(
              (g) => !groups.some((i) => i.id === g.portionGroupId),
            )
          )
            throw new HttpError(
              409,
              "Su岷 膬n 膽茫 膽瓢峄 ch峄憈 cho th峄眂 膽啤n kh谩c; kh么ng ghi 膽猫",
            );
          // Quy suất nhóm riêng về dị ứng khai báo của lớp theo mã hoặc tên.
          const master = await tx.classAllergy.findMany({
            where: { classId: demand.classId },
            select: {
              ingredientEntryId: true,
              affectedCount: true,
              IngredientEntry: {
                select: { Ingredient: { select: { name: true } } },
              },
            },
          });
          const {
            byAllergy: avoidedCounts,
            uncovered,
            relevant,
          } = allergyCountsFromGroups(
            groups,
            (groupId) =>
              input.groups.find((g) => g.portionGroupId === groupId)!
                .portionCount,
            master.map((m) => ({
              ingredientEntryId: m.ingredientEntryId,
              allergenName: m.IngredientEntry.Ingredient.name,
            })),
          );
          if (
            demand.dailyAllergyPortions.some(
              (a) =>
                relevant.has(a.ingredientEntryId) &&
                (avoidedCounts.get(a.ingredientEntryId) ?? 0) !==
                  a.portionCount,
            )
          )
            throw new HttpError(
              422,
              "Nh贸m su岷 kh谩c s峄?su岷 d峄?峄﹏g 膽茫 ch峄憈; c岷 膽峄慽 chi岷縰, kh么ng t峄?ghi 膽猫",
            );
          if (
            uncovered ||
            [...avoidedCounts].some(
              ([entryId, count]) =>
                count >
                (master.find((m) => m.ingredientEntryId === entryId)
                  ?.affectedCount ?? 0),
            )
          )
            throw new HttpError(
              422,
              "S峄?su岷 nh贸m v瓢峄 th么ng tin d峄?峄﹏g c峄 l峄沺; c岷 y t岷?膽峄慽 chi岷縰",
            );
          const unchanged =
            demand.portionGroups.length === groups.length &&
            input.groups.every((g) =>
              demand.portionGroups.some(
                (p) =>
                  p.portionGroupId === g.portionGroupId &&
                  p.portionCount === g.portionCount,
              ),
            );
          if (unchanged)
            return {
              dailyMealPortionId: id,
              groups: demand.portionGroups,
              unchanged: true,
            };
          if (
            (await tx.cookingBatch.count({ where: meal })) ||
            (await tx.menuMealSeasoningLot.count({ where: meal })) ||
            (await tx.mealAllocation.count({
              where: { dailyMealPortionId: id },
            }))
          )
            throw new HttpError(
              409,
              "膼茫 l岷璸 m岷?ho岷穋 ph芒n ph峄慽; kh么ng thay 膽峄昳 nh贸m su岷",
            );
          for (const [entryId, count] of avoidedCounts)
            if (
              count > 0 &&
              !demand.dailyAllergyPortions.some(
                (a) => a.ingredientEntryId === entryId,
              )
            )
              await tx.dailyAllergyPortion.create({
                data: {
                  dailyMealPortionId: id,
                  classId: demand.classId,
                  ingredientEntryId: entryId,
                  portionCount: count,
                },
              });
          const now = new Date();
          for (const group of input.groups)
            await tx.dailyMealPortionGroup.upsert({
              where: {
                dailyMealPortionId_portionGroupId: {
                  dailyMealPortionId: id,
                  portionGroupId: group.portionGroupId,
                },
              },
              create: {
                dailyMealPortionId: id,
                ...group,
                confirmedByUserId: actor.id,
                confirmedAt: now,
              },
              update: {
                portionCount: group.portionCount,
                confirmedByUserId: actor.id,
                confirmedAt: now,
              },
            });
          return {
            dailyMealPortionId: id,
            groups: await tx.dailyMealPortionGroup.findMany({
              where: { dailyMealPortionId: id },
              orderBy: { portionGroupId: "asc" },
            }),
            unchanged: false,
          };
        },
      );
    },
    async summary(query: MealSummaryQuery, principal: AuthPrincipal) {
      assertPermission(
        principal,
        "daily_meal_portion.view",
        "cooking_batch.view",
        "menu.view",
        "supply_request.create",
      );
      if (principal.orgType !== "SCHOOL" || !principal.schoolId)
        throw new HttpError(403, "C岷 ph岷 vi tr瓢峄漬g");
      const db = await connect();
      return db.$transaction(
        async (tx) => {
          const where: Prisma.DailyMealPortionWhereInput = {
            mealDate: query.date,
            mealType: query.mealType,
            Class: {
              schoolId: principal.schoolId!,
              ...(principal.role === "HOMEROOM_TEACHER" && {
                homeroomAssignments: {
                  some: { teacherUserId: principal.id, endedAt: null },
                },
              }),
            },
          };
          const demand = await tx.dailyMealPortion.aggregate({
            where: { ...where, status: "FINALIZED" },
            _sum: { totalPortions: true },
            _count: true,
          });
          const pending = await tx.dailyMealPortion.count({
            where: { ...where, status: "DRAFT" },
          });

          const schoolClasses = await tx.class.findMany({
            where: {
              schoolId: principal.schoolId!,
              status: "ACTIVE",
              ...(principal.role === "HOMEROOM_TEACHER" && {
                homeroomAssignments: {
                  some: { teacherUserId: principal.id, endedAt: null },
                },
              }),
            },
            select: {
              id: true,
              name: true,
              gradeId: true,
              grade: { select: { id: true, name: true } },
              registeredMealPortions: true,
              homeroomAssignments: {
                where: { endedAt: null },
                select: {
                  Teacher: { select: { fullName: true } },
                },
              },
            },
            orderBy: { name: "asc" },
          });

          const portions = await tx.dailyMealPortion.findMany({
            where,
            select: {
              id: true,
              classId: true,
              totalPortions: true,
              status: true,
              finalizedAt: true,
              allergyNotes: true,
              User: { select: { fullName: true } },
            },
          });

          const portionMap = new Map(portions.map((p) => [p.classId, p]));

          const classes = schoolClasses.map((cls) => {
            const p = portionMap.get(cls.id);
            const teacherName =
              cls.homeroomAssignments[0]?.Teacher?.fullName ||
              p?.User?.fullName ||
              null;
            return {
              classId: cls.id,
              className: cls.name,
              gradeId: cls.gradeId,
              gradeName: cls.grade?.name || null,
              registeredPortions: cls.registeredMealPortions,
              actualPortions: p ? p.totalPortions : 0,
              status: p ? p.status : "NOT_REPORTED",
              teacherName,
              finalizedAt: p?.finalizedAt ? p.finalizedAt.toISOString() : null,
              allergyNotes: p?.allergyNotes || null,
            };
          });

          return {
            date: query.date.toISOString().slice(0, 10),
            mealType: query.mealType,
            totalPortions: demand._sum.totalPortions ?? 0,
            finalizedClasses: demand._count,
            pendingClasses: pending,
            classes,
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    },
    getAll(query: ListQuery, principal: AuthPrincipal) {
      const where = listScopes["meal-attendance"](principal);
      return readListPage(
        () =>
          read({
            ...listWindow(query),
            where,
            select,
            orderBy: [
              { mealDate: "desc" },
              { mealType: "asc" },
              { id: "desc" },
            ],
          }),
        query,
      );
    },
  };
}

export const mealAttendanceService = createMealAttendanceService();
export type MealAttendanceService = ReturnType<
  typeof createMealAttendanceService
>;
