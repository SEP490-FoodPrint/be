BEGIN;

-- DropIndex
DROP INDEX "school_grades_school_id_code_key";

-- AlterTable
ALTER TABLE "school_grades" DROP COLUMN "code";

-- CreateIndex
CREATE UNIQUE INDEX "school_grades_school_id_name_key" ON "school_grades"("school_id", "name");

COMMIT;
