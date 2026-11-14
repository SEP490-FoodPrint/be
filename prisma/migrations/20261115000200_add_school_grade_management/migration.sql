-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "grade_id" UUID;

-- CreateTable
CREATE TABLE "school_grades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_grades_school_id_code_key" ON "school_grades"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "school_grades_school_id_id_key" ON "school_grades"("school_id", "id");

-- CreateIndex
CREATE INDEX "idx_classes_school_grade" ON "classes"("school_id", "grade_id");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_grade_id_fkey" FOREIGN KEY ("school_id", "grade_id") REFERENCES "school_grades"("school_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "school_grades" ADD CONSTRAINT "school_grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
