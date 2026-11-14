-- DropIndex
DROP INDEX "foodprint"."weekly_menus_school_id_week_start_date_key";

-- AlterTable
ALTER TABLE "foodprint"."weekly_menus" ADD COLUMN     "is_school_wide" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "foodprint"."weekly_menu_grades" (
    "weekly_menu_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "week_start_date" DATE NOT NULL,
    "grade_id" UUID NOT NULL,

    CONSTRAINT "weekly_menu_grades_pkey" PRIMARY KEY ("weekly_menu_id","grade_id")
);

-- CreateTable
CREATE TABLE "foodprint"."dish_grade_recipes" (
    "dish_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dish_grade_recipes_pkey" PRIMARY KEY ("dish_id","grade_id")
);

-- CreateTable
CREATE TABLE "foodprint"."dish_grade_recipe_lines" (
    "dish_id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "ingredient_entry_id" UUID NOT NULL,
    "ingredient_role" VARCHAR(12) NOT NULL,
    "required_quantity" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(30) NOT NULL,

    CONSTRAINT "dish_grade_recipe_lines_pkey" PRIMARY KEY ("dish_id","grade_id","ingredient_entry_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_menu_grades_school_id_week_start_date_grade_id_key" ON "foodprint"."weekly_menu_grades"("school_id", "week_start_date", "grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "dishes_id_school_id_key" ON "foodprint"."dishes"("id", "school_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_menus_id_school_id_week_start_date_key" ON "foodprint"."weekly_menus"("id", "school_id", "week_start_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_weekly_menu_school_wide" ON "foodprint"."weekly_menus"("school_id", "week_start_date") WHERE (is_school_wide = true);

-- AddForeignKey
ALTER TABLE "foodprint"."weekly_menu_grades" ADD CONSTRAINT "weekly_menu_grades_weekly_menu_id_school_id_week_start_dat_fkey" FOREIGN KEY ("weekly_menu_id", "school_id", "week_start_date") REFERENCES "foodprint"."weekly_menus"("id", "school_id", "week_start_date") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."weekly_menu_grades" ADD CONSTRAINT "weekly_menu_grades_school_id_grade_id_fkey" FOREIGN KEY ("school_id", "grade_id") REFERENCES "foodprint"."school_grades"("school_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."dish_grade_recipes" ADD CONSTRAINT "dish_grade_recipes_dish_id_school_id_fkey" FOREIGN KEY ("dish_id", "school_id") REFERENCES "foodprint"."dishes"("id", "school_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."dish_grade_recipes" ADD CONSTRAINT "dish_grade_recipes_school_id_grade_id_fkey" FOREIGN KEY ("school_id", "grade_id") REFERENCES "foodprint"."school_grades"("school_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."dish_grade_recipe_lines" ADD CONSTRAINT "dish_grade_recipe_lines_dish_id_grade_id_fkey" FOREIGN KEY ("dish_id", "grade_id") REFERENCES "foodprint"."dish_grade_recipes"("dish_id", "grade_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "foodprint"."dish_grade_recipe_lines" ADD CONSTRAINT "dish_grade_recipe_lines_ingredient_entry_id_fkey" FOREIGN KEY ("ingredient_entry_id") REFERENCES "foodprint"."ingredient_entries"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "foodprint"."dish_grade_recipe_lines"
  ADD CONSTRAINT "ck_grade_recipe_quantity" CHECK (required_quantity > 0),
  ADD CONSTRAINT "ck_grade_recipe_role" CHECK (ingredient_role IN ('MAIN', 'SEASONING')),
  ADD CONSTRAINT "ck_grade_recipe_unit" CHECK (length(btrim(unit)) > 0);
